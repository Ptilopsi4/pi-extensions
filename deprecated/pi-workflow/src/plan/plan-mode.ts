import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { completePlanArguments } from "./command.js";
import {
	normalizePlanModeCompletion,
	PLAN_MODE_COMPLETE_PARAMS,
	PLAN_MODE_COMPLETE_TOOL_NAME,
	planModeCompleted,
	renderPlanModeCompletion,
} from "./completion-tool.js";
import {
	isStaleExtensionContextError,
	onAgentSettled,
	setPlanThinkingLevel,
} from "./extension-runtime.js";
import type { FreshImplementationFromStateOptions } from "./fresh-implementation.js";
import {
	createImplementationRetentionCoordinator,
	implementationRetentionPreview,
} from "./implementation-retention.js";
import { invalidPlanMessage, latestAssistantText, parseProposedPlan } from "./message-transform.js";
import { createPlanActionController } from "./plan-action-controller.js";
import { planExportDestination } from "./plan-export-path.js";
import {
	clearPlanModeUi,
	planModeStatusText as formatPlanModeStatusText,
	showStoredPlan,
	updatePlanModeUi,
} from "./presentation.js";
import { buildPlanModePrompt, formatImplementationHandoff } from "./prompt.js";
import {
	answerPlanModeQuestions,
	normalizePlanModeQuestionParams,
	PLAN_MODE_QUESTION_PARAMS,
	PLAN_MODE_QUESTION_TOOL_NAME,
	planModeQuestionCancelled,
} from "./question-tool.js";
import { withoutRequiredPlanModeTools, withRequiredPlanModeTools } from "./required-tools.js";
import {
	awaitPlanModeSettingsWrites,
	configuredImplementationPlanRetention,
	configuredPlanExportPath,
	configuredPlanModeToggleShortcut,
	configuredThinkingLevel,
	type ImplementationPlanRetention,
	type PlanModeSettings,
	readPlanModeSettings,
	type updatePlanModeSettings,
} from "./settings.js";
import { type PlanCompletionSource, type PlanModeState, restorePlanModeState } from "./state.js";
import {
	canSelectToolInPlanMode,
	classifyPlanModeTool,
	findBlockedCommandSegment,
	readCommand,
} from "./tool-policy.js";
import {
	compareTools,
	filterAvailableSelectedToolNames,
	snapshotPlanModeSelectedNames,
	snapshotPlanModeToolNames,
	toolPolicyLabel,
} from "./tool-selection.js";

const STATE_ENTRY_TYPE = "plan-mode-state";
const PROPOSED_PLAN_MESSAGE_TYPE = "proposed-plan";
const BLOCKED_BUILTIN_TOOLS = new Set(["edit", "write"]);
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
interface ReadyPresentationIntent {
	nonce: number;
	plan: string;
	source: PlanCompletionSource;
}
type InteractiveUi = typeof import("./interactive-ui.js");
type FreshImplementationModule = Pick<
	typeof import("./fresh-implementation.js"),
	"startFreshImplementationFromState"
>;
type PlanExportModule = Pick<typeof import("./plan-export.js"), "exportStoredPlan">;
type SavedPlanPreflightModule = Pick<
	typeof import("./saved-plan-preflight.js"),
	"preflightSavedPlanImplementation"
>;

export interface PlanImplementationHandoffRequest {
	implementationId: string;
	plan: string;
	isCurrent(): boolean;
	source: PlanCompletionSource;
	retention: ReturnType<typeof configuredImplementationPlanRetention>;
	handoffPrompt: string;
}

export interface PlanModeDependencies {
	readSettings?(): ReturnType<typeof readPlanModeSettings>;
	settingsPath?: string;
	reportSettingsIssues?: boolean;
	loadInteractiveUi?(): Promise<InteractiveUi>;
	loadFreshImplementation?(): Promise<FreshImplementationModule>;
	loadPlanExport?(): Promise<PlanExportModule>;
	loadSavedPlanPreflight?(): Promise<SavedPlanPreflightModule>;
	updateSettings?: typeof updatePlanModeSettings;
	shouldAutoHandoff?(): boolean;
	canStartPlan?(): string | undefined;
	implementationPlanRetention?: ImplementationPlanRetention;
	implementationOutcome?(): string;
	showImplementationPlanRetentionSetting?: boolean;
	manageLinkedGoal?(ctx: ExtensionCommandContext): Promise<void>;
	startFreshImplementation?: FreshImplementationFromStateOptions["startSession"];
	startImplementation?(
		request: PlanImplementationHandoffRequest,
		ctx: ExtensionContext,
	): Promise<boolean>;
}

export interface PlanModeHandle {
	getState(): PlanModeState;
	showManager(ctx: ExtensionCommandContext): Promise<void>;
	showSettings(ctx: ExtensionCommandContext): Promise<void>;
	linkImplementationToGoal(implementationId: string, goalId: string): boolean;
	clearLinkedGoal(goalId: string): boolean;
	clearForGoalConflict(ctx: ExtensionContext): boolean;
	recoverUnlinkedImplementation(ctx: ExtensionContext): boolean;
	handleGoalState(snapshot: { goalId: string; status: string }): void;
	reconcileGoalState(goal: { id: string; status: string } | undefined): void;
}

// Cohesion justification: Plan transitions, tool ownership, accepted-plan persistence,
// implementation retention, and command/UI handoff share one generation-guarded runtime.
// Splitting the factory state across owners would duplicate rollback and stale-session invariants.
export default function planMode(
	pi: ExtensionAPI,
	dependencies: PlanModeDependencies = {},
): PlanModeHandle {
	let interactiveUiPromise: Promise<InteractiveUi> | undefined;
	const loadInteractiveUi = () => {
		if (dependencies.loadInteractiveUi) return dependencies.loadInteractiveUi();
		if (!interactiveUiPromise) {
			interactiveUiPromise = import("./interactive-ui.js").catch((error) => {
				interactiveUiPromise = undefined;
				throw error;
			});
		}
		return interactiveUiPromise;
	};
	const loadFreshImplementation = cachedModuleLoader(
		dependencies.loadFreshImplementation ?? (() => import("./fresh-implementation.js")),
	);
	const loadPlanExport = cachedModuleLoader(
		dependencies.loadPlanExport ?? (() => import("./plan-export.js")),
	);
	const loadSavedPlanPreflight = cachedModuleLoader(
		dependencies.loadSavedPlanPreflight ?? (() => import("./saved-plan-preflight.js")),
	);
	let state: PlanModeState = { enabled: false, awaitingAction: false };
	let settings: PlanModeSettings = { thinkingLevel: "inherit" };
	let toggleShortcut: ReturnType<typeof configuredPlanModeToggleShortcut>;
	const clearPlanModeShortcutHandler = () => {};
	let currentContext: ExtensionContext | undefined;
	let sessionReady = true;
	let handoffInFlightImplementationId: string | undefined;
	let previousTools: string[] | undefined;
	let readyPresentationIntent: ReadyPresentationIntent | undefined;
	let latestCommandContext: ExtensionCommandContext | undefined;
	let nextReadyPresentationNonce = 0;
	let menuGeneration = 0;
	let workflowGeneration = 0;
	let refreshStateBeforeFirstAgentStart = false;
	let menuController = new AbortController();
	const implementationRetention = createImplementationRetentionCoordinator();
	const persistState = () => pi.appendEntry<PlanModeState>(STATE_ENTRY_TYPE, state);
	const planActions = createPlanActionController({
		loadInteractiveUi,
		getState: () => state,
		captureLifecycle: captureMenuLifecycle,
		statusText: planStatusText,
		implementationOutcome,
		getExportDestination: (ctx) =>
			planExportDestination(configuredPlanExportPath(settings), ctx.cwd),
		show: (ctx) => showStoredPlan(pi, ctx, state),
		finalize: requestFinalPlan,
		implementHere: startImplementation,
		implementFresh: startFreshImplementation,
		exportPlan: (ctx, path, signal, isCurrent) => exportPlan(path, ctx, signal, isCurrent),
		settings: showSettings,
		save: savePlanForLater,
		stay: updateUi,
		exitReady: (ctx) => {
			exitPlanMode(ctx);
			ctx.ui.notify("Plan mode disabled. Proposed plan discarded.", "info");
		},
		clearSaved: (ctx) => {
			exitPlanMode(ctx);
			ctx.ui.notify("Saved plan cleared.", "info");
		},
	});

	pi.registerFlag("plan", {
		description: "Start in Codex-like Plan mode",
		type: "boolean",
		default: false,
	});

	pi.registerTool({
		name: PLAN_MODE_QUESTION_TOOL_NAME,
		label: "Plan question",
		description:
			"Ask the user one to three Plan-mode clarification questions with meaningful options, then wait for the answer. Only available while Plan mode is active.",
		promptSnippet: "Ask user decision questions while Plan mode is active",
		promptGuidelines: [
			"In Plan mode, use plan_mode_question for important preferences, tradeoffs, or assumptions that cannot be discovered from read-only exploration.",
		],
		parameters: PLAN_MODE_QUESTION_PARAMS,
		async execute(_toolCallId, params: unknown, _signal, _onUpdate, ctx) {
			if (!state.enabled) {
				return planModeQuestionCancelled(
					[],
					"plan_mode_inactive",
					"Error: plan_mode_question is only available while Plan mode is active.",
				);
			}

			const parsed = normalizePlanModeQuestionParams(params);
			if (!parsed.ok) {
				return planModeQuestionCancelled([], "invalid_input", `Error: ${parsed.error}`);
			}

			if (!ctx.hasUI) {
				return planModeQuestionCancelled(
					parsed.questions,
					"ui_unavailable",
					"Unable to ask Plan-mode questions because interactive UI is not available.",
				);
			}

			const sessionGeneration = menuGeneration;
			const questionWorkflowGeneration = workflowGeneration;
			return answerPlanModeQuestions(parsed.questions, ctx, {
				isCurrent: () =>
					sessionGeneration === menuGeneration && questionWorkflowGeneration === workflowGeneration,
				isEnabled: () => state.enabled,
			});
		},
	});

	pi.registerTool({
		name: PLAN_MODE_COMPLETE_TOOL_NAME,
		label: "Complete plan",
		description:
			"Submit the complete decision-ready implementation plan for user review. Only available while Plan mode is active, and must be the final standalone action.",
		promptSnippet: "Submit the final Plan-mode implementation plan",
		promptGuidelines: [
			"Call plan_mode_complete alone as the final action only after the implementation plan is decision-complete.",
		],
		parameters: PLAN_MODE_COMPLETE_PARAMS,
		renderResult: renderPlanModeCompletion,
		async execute(_toolCallId, params: unknown, _signal, _onUpdate, ctx) {
			if (!state.enabled) {
				throw new Error("plan_mode_complete is only available while Plan mode is active");
			}
			const parsed = normalizePlanModeCompletion(params);
			if (!parsed.ok) throw new Error(parsed.error);

			acceptCompletedPlan(parsed.plan, PLAN_MODE_COMPLETE_TOOL_NAME, ctx);
			return planModeCompleted(parsed.plan);
		},
	});

	pi.registerCommand("plan", {
		description: "Enter or manage Codex-like Plan mode",
		getArgumentCompletions: completePlanArguments,
		handler: async (args, ctx) => {
			latestCommandContext = ctx;
			const prompt = args.trim();
			const command = prompt.toLowerCase();
			if (command === "start") {
				if (planStartBlocked(ctx)) return;
				if (savedPlanBlocksNewWorkflow(ctx, state.savedPlan !== undefined && !state.enabled))
					return;
				if (state.enabled) {
					ctx.ui.notify("Plan mode is already active.", "info");
					return;
				}
				enterPlanMode(ctx);
				ctx.ui.notify("Plan mode enabled. I will explore and plan, but not modify files.", "info");
				return;
			}
			if (command === "show") {
				showStoredPlan(pi, ctx, state);
				return;
			}
			if (command === "finalize") {
				requestFinalPlan(ctx);
				return;
			}
			if (command === "implement") {
				if (!(state.enabled && state.latestPlan?.trim()) && !state.savedPlan?.plan.trim()) {
					ctx.ui.notify("No completed plan is available to implement.", "warning");
					return;
				}
				await startImplementation(ctx);
				return;
			}
			if (command === "save") {
				savePlanForLater(ctx);
				return;
			}
			const exportMatch = /^export(?:\s+([\s\S]+))?$/iu.exec(prompt);
			if (exportMatch) {
				const lifecycle = captureMenuLifecycle();
				await exportPlan(exportMatch[1], ctx, lifecycle.signal, lifecycle.isCurrent);
				return;
			}
			if (command === "exit" || command === "off") {
				if (linkedPlanExitBlocked(ctx)) return;
				const notification = planModeDisableNotification();
				exitPlanMode(ctx);
				ctx.ui.notify(notification, "info");
				return;
			}
			if (command === "tools") {
				if (planStartBlocked(ctx)) return;
				if (savedPlanBlocksNewWorkflow(ctx, state.savedPlan !== undefined && !state.enabled))
					return;
				if (state.enabled) {
					const message =
						"Plan-mode tools are locked while Planning is active. Exit Plan mode and choose tools before starting again.";
					if (!ctx.hasUI) throw new Error(message);
					ctx.ui.notify(message, "warning");
					return;
				}
				if (!ctx.hasUI) {
					throw new Error("/plan tools requires TUI or RPC mode and is unavailable here.");
				}
				await showLaunchMenu(ctx, "tools");
				return;
			}
			if (prompt) {
				if (planStartBlocked(ctx)) return;
				if (savedPlanBlocksNewWorkflow(ctx, state.savedPlan !== undefined && !state.enabled))
					return;
				enterPlanModeWithPrompt(prompt, ctx);
				return;
			}
			await showManager(ctx);
		},
	});

	const applyPlanModeShortcut = (
		nextShortcut: ReturnType<typeof configuredPlanModeToggleShortcut>,
	) => {
		if (toggleShortcut && toggleShortcut !== nextShortcut) {
			pi.registerShortcut(toggleShortcut, {
				handler: clearPlanModeShortcutHandler,
			});
		}
		if (!nextShortcut) {
			toggleShortcut = undefined;
			return;
		}
		if (toggleShortcut === nextShortcut) return;
		pi.registerShortcut(nextShortcut, {
			description: "Toggle Plan mode",
			handler: (ctx) => {
				togglePlanMode(ctx);
			},
		});
		toggleShortcut = nextShortcut;
	};

	pi.on("session_start", async (event, ctx) => {
		const generation = ++menuGeneration;
		sessionReady = false;
		currentContext = ctx;
		refreshStateBeforeFirstAgentStart = event.reason === "new";
		menuController.abort(new DOMException("Plan-mode session replaced", "AbortError"));
		menuController = new AbortController();
		readyPresentationIntent = undefined;
		latestCommandContext = undefined;
		handoffInFlightImplementationId = undefined;
		implementationRetention.reset();
		settings = { thinkingLevel: "inherit" };
		restoreState(ctx);
		implementationRetention.restore(state.activeImplementation);
		const loadedSettings = await (dependencies.readSettings?.() ?? readPlanModeSettings());
		if (generation !== menuGeneration || menuController.signal.aborted) return;
		if (loadedSettings.kind === "loaded") settings = loadedSettings.settings;
		else if (loadedSettings.kind === "invalid" && dependencies.reportSettingsIssues !== false) {
			ctx.ui.notify(`pi-workflow Plan settings ignored: ${loadedSettings.reason}`, "warning");
		}
		if (loadedSettings.notice && dependencies.reportSettingsIssues !== false) {
			ctx.ui.notify(loadedSettings.notice, "warning");
		}
		applyPlanModeShortcut(configuredPlanModeToggleShortcut(settings));
		const requestedFlagActivation = pi.getFlag("plan") === true && !state.enabled;
		const flagBlocker = requestedFlagActivation ? dependencies.canStartPlan?.() : undefined;
		if (flagBlocker) ctx.ui.notify(flagBlocker, "warning");
		const persistFlagActivation = requestedFlagActivation && !flagBlocker;
		if (persistFlagActivation) {
			state = state.savedPlan
				? {
						...state,
						enabled: true,
						latestPlan: state.savedPlan.plan,
						latestPlanSource: state.savedPlan.source,
						awaitingAction: true,
						savedPlan: undefined,
						activeImplementation: undefined,
					}
				: { ...state, enabled: true, activeImplementation: undefined };
		}
		if (state.enabled) {
			activatePlanModeTools();
			applyPlanThinkingLevel();
		} else deactivatePlanModeQuestionTool();
		if (persistFlagActivation) persistState();
		updateUi(ctx);
		sessionReady = true;
	});

	pi.on("thinking_level_select", (event) => {
		if (!state.enabled || !state.appliedThinkingLevel) return;
		if (event.level !== state.appliedThinkingLevel) {
			state = {
				...state,
				manualThinkingLevel: event.level,
				previousThinkingLevel: undefined,
				appliedThinkingLevel: undefined,
			};
			persistState();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		menuGeneration += 1;
		sessionReady = false;
		menuController.abort(new DOMException("Plan-mode session shut down", "AbortError"));
		readyPresentationIntent = undefined;
		latestCommandContext = undefined;
		handoffInFlightImplementationId = undefined;
		refreshStateBeforeFirstAgentStart = false;
		implementationRetention.reset();
		await awaitPlanModeSettingsWrites(dependencies.settingsPath);
		captureManualThinkingLevel();
		persistState();
		if (state.enabled) {
			restoreTools();
			restoreThinkingLevel();
		}
		clearUi(ctx);
		if (currentContext === ctx) currentContext = undefined;
	});

	pi.on("tool_call", async (event) => {
		if (!state.enabled) return;
		if (event.toolName === "update_plan") {
			return {
				block: true,
				reason:
					"Plan mode blocks update_plan because it tracks execution progress rather than conversational planning.",
			};
		}
		const calledTool = toolByName(event.toolName);
		if (calledTool && classifyPlanModeTool(calledTool) === "blocked") {
			return {
				block: true,
				reason: `Plan mode blocks built-in tool '${event.toolName}' because its policy class is blocked.`,
			};
		}
		if (!calledTool && BLOCKED_BUILTIN_TOOLS.has(event.toolName)) {
			return {
				block: true,
				reason: `Plan mode blocks built-in tool '${event.toolName}' because its metadata is unavailable.`,
			};
		}
		// Built-in-compatible overrides retain the canonical name but replace its source metadata.
		if (event.toolName !== "bash") return;

		const blocked = findBlockedCommandSegment(readCommand(event.input), settings.safeSubcommands);
		if (blocked !== undefined) {
			return {
				block: true,
				reason: `Plan mode blocks bash commands outside its reviewed inspection policy or containing explicitly unsafe arguments.\nBlocked command: ${blocked}`,
			};
		}
	});

	pi.on("context", async (event, ctx) => {
		const result = implementationRetention.transformContext(event.messages, state);
		if (result.clearActiveImplementationId) {
			clearActiveImplementation(result.clearActiveImplementationId, ctx);
		}
		return { messages: result.messages as typeof event.messages };
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (refreshStateBeforeFirstAgentStart) {
			refreshStateBeforeFirstAgentStart = false;
			restoreState(ctx);
			implementationRetention.reset();
			implementationRetention.restore(state.activeImplementation);
			if (state.enabled) {
				activatePlanModeTools();
				applyPlanThinkingLevel();
			} else deactivatePlanModeQuestionTool();
			updateUi(ctx);
		}
		if (!state.enabled) return;
		if (state.latestPlan || state.awaitingAction) {
			readyPresentationIntent = undefined;
			state = {
				...state,
				latestPlan: undefined,
				latestPlanSource: undefined,
				awaitingAction: false,
			};
			persistState();
			updateUi(ctx);
		}
		applyPlanModeTools();
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildPlanModePrompt()}`,
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!state.enabled) return;

		const text = latestAssistantText(event.messages);
		const parsedPlan = parseProposedPlan(text);
		if (parsedPlan.kind !== "valid") {
			if (parsedPlan.kind !== "absent") {
				ctx.ui.notify(invalidPlanMessage(parsedPlan.kind), "warning");
			}
			persistState();
			updateUi(ctx);
			return;
		}
		acceptCompletedPlan(parsedPlan.plan, "legacy_proposed_plan", ctx);
	});

	onAgentSettled(pi, async (_event, ctx) => {
		const settledImplementationId = implementationRetention.implementationSettled(
			state.activeImplementation,
		);
		if (settledImplementationId) clearActiveImplementation(settledImplementationId, ctx);

		const intent = readyPresentationIntent;
		if (!intent || !readyPresentationIsCurrent(intent)) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

		readyPresentationIntent = undefined;
		try {
			if (dependencies.shouldAutoHandoff?.() && completedPlanIsCurrent(intent)) {
				await startImplementation(ctx);
				return;
			}
			if (intent.source === "legacy_proposed_plan") {
				pi.sendMessage(
					{
						customType: PROPOSED_PLAN_MESSAGE_TYPE,
						content: `**Proposed Plan**\n\n${intent.plan}`,
						display: true,
					},
					{ triggerTurn: false },
				);
			}
			if (ctx.hasUI && completedPlanIsCurrent(intent)) {
				await planActions.showReady(latestCommandContext ?? ctx);
			}
		} catch (error: unknown) {
			if (!isStaleExtensionContextError(error)) throw error;
		}
	});

	function enterPlanMode(ctx: ExtensionContext) {
		workflowGeneration += 1;
		if (!state.enabled) previousTools = withoutRequiredPlanModeTools(safeGetActiveTools());
		state = {
			...state,
			enabled: true,
			awaitingAction: false,
			savedPlan: undefined,
			activeImplementation: undefined,
		};
		activatePlanModeTools();
		applyPlanThinkingLevel();
		persistState();
		updateUi(ctx);
	}

	function enterPlanModeWithPrompt(prompt: string, ctx: ExtensionContext) {
		const previousState = state;
		const wasEnabled = state.enabled;
		enterPlanMode(ctx);
		if (!wasEnabled) {
			ctx.ui.notify("Plan mode enabled. I will explore and plan, but not modify files.", "info");
		}
		if (sendPlanModeUserMessage(prompt, ctx)) return;
		if (!previousState.enabled) {
			restoreTools();
			restoreThinkingLevel();
		}
		state = previousState;
		persistState();
		updateUi(ctx);
	}

	function exitPlanMode(ctx: ExtensionContext) {
		workflowGeneration += 1;
		const wasEnabled = state.enabled;
		readyPresentationIntent = undefined;
		state = {
			...state,
			enabled: false,
			latestPlan: undefined,
			latestPlanSource: undefined,
			awaitingAction: false,
			savedPlan: undefined,
			activeImplementation: undefined,
			manualThinkingLevel: undefined,
		};
		if (wasEnabled) {
			restoreTools();
			restoreThinkingLevel();
			state = { ...state, manualThinkingLevel: undefined };
		}
		persistState();
		updateUi(ctx);
	}

	function sendPlanModeUserMessage(message: string, ctx: ExtensionContext) {
		try {
			if (ctx.isIdle()) pi.sendUserMessage(message);
			else pi.sendUserMessage(message, { deliverAs: "followUp" });
			return true;
		} catch (error: unknown) {
			const detail = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Unable to send Plan-mode message: ${detail}`, "error");
			return false;
		}
	}

	function acceptCompletedPlan(plan: string, source: PlanCompletionSource, ctx: ExtensionContext) {
		const normalized = normalizePlanModeCompletion({ plan });
		if (!normalized.ok) {
			ctx.ui.notify(`Proposed plan is not ready: ${normalized.error}.`, "warning");
			persistState();
			updateUi(ctx);
			return;
		}
		if (
			state.enabled &&
			state.awaitingAction &&
			state.latestPlan === normalized.plan &&
			state.latestPlanSource === source
		) {
			return;
		}
		state = {
			...state,
			latestPlan: normalized.plan,
			latestPlanSource: source,
			awaitingAction: true,
		};
		readyPresentationIntent = {
			nonce: ++nextReadyPresentationNonce,
			plan: normalized.plan,
			source,
		};
		persistState();
		updateUi(ctx);
	}

	function completedPlanIsCurrent(intent: ReadyPresentationIntent) {
		return (
			state.enabled &&
			state.awaitingAction &&
			state.latestPlan === intent.plan &&
			state.latestPlanSource === intent.source
		);
	}

	function readyPresentationIsCurrent(intent: ReadyPresentationIntent) {
		return completedPlanIsCurrent(intent) && readyPresentationIntent?.nonce === intent.nonce;
	}

	function togglePlanMode(ctx: ExtensionContext) {
		// Pi keeps a registered shortcut across sessions, so the handler stays inert while a session
		// is starting, replaced, or shut down instead of mutating state the session does not own.
		if (!sessionReady) return;
		if (state.enabled) {
			if (linkedPlanExitBlocked(ctx)) return;
			const notification = planModeDisableNotification();
			exitPlanMode(ctx);
			ctx.ui.notify(notification, "info");
			return;
		}
		if (planStartBlocked(ctx)) return;
		if (savedPlanBlocksNewWorkflow(ctx, state.savedPlan !== undefined)) return;
		enterPlanMode(ctx);
		ctx.ui.notify("Plan mode enabled. I will explore and plan, but not modify files.", "info");
	}

	function planModeDisableNotification() {
		return state.activeImplementation
			? "Active implementation plan cleared."
			: state.savedPlan
				? "Saved plan cleared."
				: state.latestPlan
					? "Plan mode disabled. Proposed plan discarded."
					: "Plan mode disabled.";
	}

	function requestFinalPlan(ctx: ExtensionContext) {
		if (!state.enabled) {
			ctx.ui.notify("Plan mode is not active. Use /plan first.", "warning");
			return;
		}
		sendPlanModeUserMessage(
			"Finalize the current implementation plan now. If any material decision remains, use plan_mode_question instead. Otherwise call plan_mode_complete alone as your final action with the complete decision-ready plan.",
			ctx,
		);
	}

	function savePlanForLater(ctx: ExtensionContext) {
		const plan = state.enabled ? state.latestPlan?.trim() : undefined;
		if (!plan) {
			const message = "No completed plan is available to save.";
			if (!ctx.hasUI) throw new Error(message);
			ctx.ui.notify(message, "warning");
			return;
		}
		const source = state.latestPlanSource ?? "legacy_proposed_plan";

		workflowGeneration += 1;
		readyPresentationIntent = undefined;
		state = {
			...state,
			enabled: false,
			latestPlan: undefined,
			latestPlanSource: undefined,
			awaitingAction: false,
			savedPlan: { plan, source },
			activeImplementation: undefined,
			manualThinkingLevel: undefined,
		};
		restoreTools();
		restoreThinkingLevel();
		state = { ...state, manualThinkingLevel: undefined };
		persistState();
		updateUi(ctx);
		ctx.ui.notify("Plan saved for later. Plan mode disabled.", "info");
	}

	async function exportPlan(
		path: string | undefined,
		ctx: ExtensionContext,
		signal: AbortSignal,
		isCurrent: () => boolean,
	) {
		const exportedState = state;
		const defaultPath = configuredPlanExportPath(settings);
		if (signal.aborted || !isCurrent()) return false;
		let module: PlanExportModule;
		try {
			module = await loadPlanExport();
		} catch (error) {
			if (signal.aborted || !isCurrent() || state !== exportedState) return false;
			throw error;
		}
		if (signal.aborted || !isCurrent() || state !== exportedState) return false;
		return module.exportStoredPlan(
			exportedState,
			path,
			ctx,
			{
				signal,
				isCurrent,
				getState: () => state,
				finishReady: () => exitPlanMode(ctx),
			},
			defaultPath,
		);
	}

	async function startFreshImplementation(ctx: ExtensionContext, menuIsCurrent: () => boolean) {
		const retention = effectiveImplementationPlanRetention();
		if (!menuIsCurrent()) return;
		let module: FreshImplementationModule;
		try {
			module = await loadFreshImplementation();
		} catch (error) {
			if (!menuIsCurrent()) return;
			throw error;
		}
		if (!menuIsCurrent()) return;
		await module.startFreshImplementationFromState(ctx, {
			getState: () => state,
			menuIsCurrent,
			retention,
			stateEntryType: STATE_ENTRY_TYPE,
			...(dependencies.startFreshImplementation
				? { startSession: dependencies.startFreshImplementation }
				: {}),
		});
	}

	async function startImplementation(ctx: ExtensionContext) {
		const savedPlan = state.enabled ? undefined : state.savedPlan;
		if (savedPlan) {
			const lifecycle = captureMenuLifecycle();
			const isCurrent = () =>
				lifecycle.isCurrent() && !state.enabled && state.savedPlan === savedPlan;
			let module: SavedPlanPreflightModule;
			try {
				module = await loadSavedPlanPreflight();
			} catch (error) {
				if (!isCurrent()) return;
				throw error;
			}
			if (!isCurrent()) return;
			if (!(await module.preflightSavedPlanImplementation(ctx, isCurrent))) return;
		}
		const plan = (state.enabled ? state.latestPlan : savedPlan?.plan)?.trim();
		const source =
			(state.enabled ? state.latestPlanSource : savedPlan?.source) ?? "legacy_proposed_plan";
		if (!plan) {
			ctx.ui.notify("Plan mode disabled. No proposed plan is available to implement.", "warning");
			return;
		}

		workflowGeneration += 1;
		const handoffWorkflowGeneration = workflowGeneration;
		const handoffSessionGeneration = menuGeneration;
		const previousState = state;
		const wasEnabled = state.enabled;
		readyPresentationIntent = undefined;
		const activeImplementation = {
			id: randomUUID(),
			plan,
			source,
			startedAt: Date.now(),
			retention: effectiveImplementationPlanRetention(),
		};
		state = {
			...state,
			enabled: false,
			latestPlan: undefined,
			latestPlanSource: undefined,
			awaitingAction: false,
			savedPlan: undefined,
			activeImplementation,
			manualThinkingLevel: undefined,
		};
		if (wasEnabled) {
			restoreTools();
			restoreThinkingLevel();
			state = { ...state, manualThinkingLevel: undefined };
		}
		persistState();
		updateUi(ctx);
		const isHandoffCurrent = () =>
			handoffWorkflowGeneration === workflowGeneration &&
			handoffSessionGeneration === menuGeneration &&
			sessionReady &&
			state.activeImplementation?.id === activeImplementation.id;

		const handoffPrompt = formatImplementationHandoff(plan);
		handoffInFlightImplementationId = activeImplementation.id;
		let sent: boolean;
		try {
			sent = dependencies.startImplementation
				? await dependencies.startImplementation(
						{
							implementationId: activeImplementation.id,
							plan,
							isCurrent: isHandoffCurrent,
							source,
							retention: activeImplementation.retention,
							handoffPrompt,
						},
						ctx,
					)
				: sendPlanModeUserMessage(handoffPrompt, ctx);
		} catch (error: unknown) {
			if (!isHandoffCurrent()) return;
			const detail = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Unable to start implementation: ${detail}`, "error");
			sent = false;
		}
		if (!isHandoffCurrent()) return;
		handoffInFlightImplementationId = undefined;
		if (!sent) {
			if (savedPlan) {
				state = previousState;
			} else {
				enterPlanMode(ctx);
				state = previousState;
				applyPlanThinkingLevel();
			}
			persistState();
			updateUi(ctx);
		}
	}

	function clearActiveImplementation(id: string, ctx?: ExtensionContext) {
		if (state.activeImplementation?.id !== id) return false;
		workflowGeneration += 1;
		state = { ...state, activeImplementation: undefined };
		persistState();
		if (ctx) updateUi(ctx);
		return true;
	}

	function linkImplementationToGoal(implementationId: string, goalId: string) {
		const activeImplementation = state.activeImplementation;
		if (activeImplementation?.id !== implementationId) return false;
		state = {
			...state,
			activeImplementation: {
				...activeImplementation,
				goalId,
				retention: effectiveImplementationPlanRetention(),
			},
		};
		persistState();
		if (currentContext) updateUi(currentContext);
		return true;
	}

	function clearLinkedGoal(goalId: string) {
		const activeImplementation = state.activeImplementation;
		if (activeImplementation?.goalId !== goalId) return false;
		return clearActiveImplementation(activeImplementation.id, currentContext);
	}

	function clearForGoalConflict(ctx: ExtensionContext) {
		if (!state.enabled && !state.activeImplementation) return false;
		exitPlanMode(ctx);
		return true;
	}

	function recoverUnlinkedImplementation(ctx: ExtensionContext) {
		const activeImplementation = state.activeImplementation;
		if (!activeImplementation || activeImplementation.goalId) return false;
		workflowGeneration += 1;
		state = {
			...state,
			enabled: true,
			latestPlan: activeImplementation.plan,
			latestPlanSource: activeImplementation.source,
			awaitingAction: true,
			activeImplementation: undefined,
		};
		implementationRetention.reset();
		activatePlanModeTools();
		applyPlanThinkingLevel();
		persistState();
		updateUi(ctx);
		return true;
	}

	function handleGoalState(snapshot: { goalId: string; status: string }) {
		if (!sessionReady) return;
		const activeImplementation = state.activeImplementation;
		const linkedGoalId = activeImplementation?.goalId;
		if (!activeImplementation || !linkedGoalId) return;
		const terminalStatus = snapshot.status === "complete" || snapshot.status === "cleared";
		const linkedTerminal = linkedGoalId === snapshot.goalId && terminalStatus;
		const linkedChanged = linkedGoalId !== snapshot.goalId;
		if (linkedChanged) {
			if (terminalStatus) {
				if (handoffInFlightImplementationId !== activeImplementation.id) {
					clearActiveImplementation(activeImplementation.id, currentContext);
				}
				return;
			}
			// Goal rotates stale-turn IDs for resume, edit, and priority transitions.
			// Relink every persisted nonterminal replacement first; committed supersession
			// is cleared explicitly after delivery, so failed transitions can relink on rollback.
			linkImplementationToGoal(activeImplementation.id, snapshot.goalId);
			return;
		}
		if (
			!linkedTerminal &&
			activeImplementation.retention !== effectiveImplementationPlanRetention()
		) {
			state = {
				...state,
				activeImplementation: {
					...activeImplementation,
					retention: effectiveImplementationPlanRetention(),
				},
			};
			persistState();
			if (currentContext) updateUi(currentContext);
		}
		if (linkedTerminal && handoffInFlightImplementationId !== activeImplementation.id) {
			clearActiveImplementation(activeImplementation.id, currentContext);
		}
	}

	function reconcileGoalState(goal: { id: string; status: string } | undefined) {
		if (!sessionReady) return;
		const activeImplementation = state.activeImplementation;
		if (!activeImplementation?.goalId) return;
		if (!goal) {
			clearActiveImplementation(activeImplementation.id, currentContext);
			return;
		}
		handleGoalState({ goalId: goal.id, status: goal.status });
	}

	async function showLaunchMenu(ctx: ExtensionContext, initialScreen: "main" | "tools" = "main") {
		const lifecycle = captureMenuLifecycle();
		if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
		const ui = await loadInteractiveUi();
		if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
		const tools = selectableTools();
		await ui.showPlanLaunchMenu(ctx, {
			statusText: "Status: Off — normal tools are active.",
			initialScreen,
			getSelectedNames: () => snapshotPlanModeSelectedNames(tools, toolSelectionSnapshot()),
			toolSummary: (selectedNames) =>
				`When started: ${snapshotPlanModeToolNames(tools, selectedNames, toolSelectionSnapshot()).join(", ")}`,
			tools: tools.map((tool) => {
				const selectable = canSelectToolInPlanMode(tool);
				const policy = toolPolicyLabel(tool);
				const description = tool.description ?? "No description available";
				return {
					name: tool.name,
					description: `${policy} · ${description}`,
					searchText: [policy, description].join(" "),
					disabled: !selectable,
					disabledReason: selectable ? undefined : "Blocked by Plan-mode policy",
				};
			}),
			...lifecycle,
			start: (signal) => {
				if (signal.aborted || !lifecycle.isCurrent() || planStartBlocked(ctx)) return;
				enterPlanMode(ctx);
				ctx.ui.notify("Plan mode enabled. I will explore and plan, but not modify files.", "info");
			},
			startWithTools: (names, signal) => {
				if (signal.aborted || !lifecycle.isCurrent() || planStartBlocked(ctx)) return;
				state = {
					...state,
					selectedToolNames: filterAvailableSelectedToolNames(names, tools),
					selectedToolKeys: undefined,
				};
				enterPlanMode(ctx);
				ctx.ui.notify("Plan mode enabled with the selected tools.", "info");
			},
			settings: (signal) => showSettings(ctx, signal, lifecycle.isCurrent),
		});
	}

	async function showActivePlanMenu(ctx: ExtensionCommandContext) {
		if (!ctx.hasUI) {
			ctx.ui.notify(planStatusText(), "info");
			return;
		}
		const lifecycle = captureMenuLifecycle();
		if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
		const ui = await loadInteractiveUi();
		if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
		await ui.showActiveImplementationMenu(ctx, {
			statusText: planStatusText(),
			getExportDestination: () =>
				planExportDestination(configuredPlanExportPath(settings), ctx.cwd),
			signal: lifecycle.signal,
			isCurrent: lifecycle.isCurrent,
			show: () => showStoredPlan(pi, ctx, state),
			exportPlan: (path, signal) => exportPlan(path, ctx, signal, lifecycle.isCurrent),
			settings: (signal) => showSettings(ctx, signal, lifecycle.isCurrent),
			...(state.activeImplementation?.goalId
				? {
						manageGoal: dependencies.manageLinkedGoal
							? () => dependencies.manageLinkedGoal?.(ctx)
							: undefined,
					}
				: {
						startNew: () => {
							if (planStartBlocked(ctx)) return;
							enterPlanMode(ctx);
							ctx.ui.notify(
								"Plan mode enabled. I will explore and plan, but not modify files.",
								"info",
							);
						},
						clear: () => {
							exitPlanMode(ctx);
							ctx.ui.notify("Active implementation plan cleared.", "info");
						},
					}),
		});
	}

	async function showSettings(
		ctx: ExtensionContext,
		signal: AbortSignal,
		isCurrent: () => boolean,
	) {
		if (!isCurrent() || signal.aborted) return false;
		const ui = await loadInteractiveUi();
		if (!isCurrent() || signal.aborted) return false;
		const result = await ui.showPlanModeSettings(ctx, {
			tools: selectableTools(),
			showImplementationPlanRetention:
				dependencies.showImplementationPlanRetentionSetting !== false,
			signal,
			isCurrent,
			settingsPath: dependencies.settingsPath,
			...(dependencies.updateSettings ? { updateSettings: dependencies.updateSettings } : {}),
			onSaved: (saved) => {
				if (!isCurrent()) return;
				settings = saved;
				applyPlanModeShortcut(configuredPlanModeToggleShortcut(saved));
			},
			...(dependencies.readSettings
				? { readSettings: async () => dependencies.readSettings?.() ?? { kind: "missing" } }
				: {}),
		});
		return result.kind === "closed" && "reason" in result && result.reason === "close";
	}

	function captureMenuLifecycle() {
		const sessionGeneration = menuGeneration;
		const planWorkflowGeneration = workflowGeneration;
		const controller = menuController;
		const sessionManager = currentContext?.sessionManager;
		return {
			signal: controller.signal,
			isCurrent: () =>
				sessionGeneration === menuGeneration &&
				planWorkflowGeneration === workflowGeneration &&
				controller === menuController &&
				!controller.signal.aborted &&
				currentContext?.sessionManager === sessionManager,
		};
	}

	function activatePlanModeTools() {
		previousTools ??= withoutRequiredPlanModeTools(safeGetActiveTools());
		applyPlanModeTools();
	}

	function applyPlanModeTools() {
		pi.setActiveTools(planModeToolNames());
	}

	function planModeToolNames() {
		const tools = selectableTools();
		if (
			tools.length === 0 &&
			state.selectedToolNames === undefined &&
			state.selectedToolKeys === undefined &&
			settings.defaultPlanTools === undefined
		) {
			return ["read", "bash", PLAN_MODE_QUESTION_TOOL_NAME, PLAN_MODE_COMPLETE_TOOL_NAME];
		}

		const selectedNames = snapshotPlanModeSelectedNames(tools, toolSelectionSnapshot());
		return withRequiredPlanModeTools(
			tools
				.filter((tool) => selectedNames.has(tool.name) && canSelectToolInPlanMode(tool))
				.map((tool) => tool.name),
		);
	}

	function toolSelectionSnapshot() {
		return {
			selectedToolNames: state.selectedToolNames,
			selectedToolKeys: state.selectedToolKeys,
			defaultPlanTools: settings.defaultPlanTools,
		};
	}

	function selectableTools() {
		return safeGetAllTools()
			.filter(
				(tool) =>
					tool.name !== PLAN_MODE_QUESTION_TOOL_NAME && tool.name !== PLAN_MODE_COMPLETE_TOOL_NAME,
			)
			.sort(compareTools);
	}

	function safeGetAllTools() {
		try {
			return pi.getAllTools();
		} catch {
			return [];
		}
	}

	function restoreTools() {
		const restoredTools = previousTools ?? DEFAULT_TOOLS;
		pi.setActiveTools(withoutRequiredPlanModeTools(restoredTools));
		previousTools = undefined;
	}

	function applyPlanThinkingLevel() {
		if (state.manualThinkingLevel) {
			if (pi.getThinkingLevel() !== state.manualThinkingLevel) {
				setPlanThinkingLevel(pi, state.manualThinkingLevel);
			}
			return;
		}
		const configured = configuredThinkingLevel(settings);
		if (!configured) {
			state = {
				...state,
				previousThinkingLevel: undefined,
				appliedThinkingLevel: undefined,
			};
			return;
		}
		const current = pi.getThinkingLevel();
		if (!state.appliedThinkingLevel) state.previousThinkingLevel = current;
		if (current !== configured) setPlanThinkingLevel(pi, configured);
		state.appliedThinkingLevel = pi.getThinkingLevel();
	}

	function captureManualThinkingLevel() {
		if (!state.appliedThinkingLevel) return;
		const current = pi.getThinkingLevel();
		if (current === state.appliedThinkingLevel) return;
		state = {
			...state,
			manualThinkingLevel: current,
			previousThinkingLevel: undefined,
			appliedThinkingLevel: undefined,
		};
	}

	function restoreThinkingLevel() {
		captureManualThinkingLevel();
		const { appliedThinkingLevel, previousThinkingLevel } = state;
		if (
			appliedThinkingLevel &&
			previousThinkingLevel &&
			pi.getThinkingLevel() === appliedThinkingLevel
		) {
			setPlanThinkingLevel(pi, previousThinkingLevel);
		}
		state = { ...state, appliedThinkingLevel: undefined, previousThinkingLevel: undefined };
	}

	function deactivatePlanModeQuestionTool() {
		const activeTools = safeGetActiveTools();
		const filteredTools = withoutRequiredPlanModeTools(activeTools);
		if (filteredTools.length !== activeTools.length) {
			pi.setActiveTools(filteredTools);
		}
	}

	function safeGetActiveTools() {
		try {
			return pi.getActiveTools();
		} catch {
			return DEFAULT_TOOLS;
		}
	}

	function restoreState(ctx: ExtensionContext) {
		state = restorePlanModeState(ctx.sessionManager.getBranch(), STATE_ENTRY_TYPE);
	}

	function linkedPlanExitBlocked(ctx: ExtensionContext) {
		if (!state.activeImplementation?.goalId) return false;
		const message =
			"The linked Goal must retain its active Plan until Goal ends. Use /goal to manage execution or /goal clear to stop it and clear the Plan.";
		if (ctx.mode === "print" || ctx.mode === "json") throw new Error(message);
		ctx.ui.notify(message, "warning");
		return true;
	}

	function updateUi(ctx: ExtensionContext) {
		updatePlanModeUi(ctx, state, formatToolSummary);
	}

	function clearUi(ctx: ExtensionContext) {
		clearPlanModeUi(ctx);
	}

	function planStatusText() {
		return formatPlanModeStatusText(state, formatToolSummary);
	}

	function effectiveImplementationPlanRetention() {
		return (
			dependencies.implementationPlanRetention ?? configuredImplementationPlanRetention(settings)
		);
	}

	function implementationOutcome() {
		return (
			dependencies.implementationOutcome?.() ??
			implementationRetentionPreview(effectiveImplementationPlanRetention())
		);
	}

	function formatToolSummary() {
		const names = planModeToolNames();
		return `Tools: ${names.length > 0 ? names.join(", ") : "none"}`;
	}

	function toolByName(toolName: string) {
		return safeGetAllTools().find((candidate) => candidate.name === toolName);
	}

	async function showManager(ctx: ExtensionCommandContext) {
		latestCommandContext = ctx;
		if (!ctx.hasUI) {
			throw new Error(
				"The interactive /plan menu is unavailable in print and JSON modes. Use /plan start or /plan <prompt>.",
			);
		}
		if (!state.enabled) {
			if (state.activeImplementation) {
				await showActivePlanMenu(ctx);
				return;
			}
			if (state.savedPlan) {
				await planActions.showSaved(ctx);
				return;
			}
			if (planStartBlocked(ctx)) return;
			await showLaunchMenu(ctx);
			return;
		}
		await planActions.showCurrent(ctx);
	}

	async function showSettingsManager(ctx: ExtensionCommandContext) {
		if (state.enabled) {
			ctx.ui.notify(
				"Plan settings are locked while Planning is active. Exit Plan mode before changing them.",
				"warning",
			);
			return;
		}
		const lifecycle = captureMenuLifecycle();
		await showSettings(ctx, lifecycle.signal, lifecycle.isCurrent);
	}

	function planStartBlocked(ctx: ExtensionContext) {
		const message = dependencies.canStartPlan?.();
		if (!message) return false;
		if (ctx.mode === "print" || ctx.mode === "json") throw new Error(message);
		ctx.ui.notify(message, "warning");
		return true;
	}

	return {
		getState: () => state,
		showManager,
		showSettings: showSettingsManager,
		linkImplementationToGoal,
		clearLinkedGoal,
		clearForGoalConflict,
		recoverUnlinkedImplementation,
		handleGoalState,
		reconcileGoalState,
	};
}

function savedPlanBlocksNewWorkflow(ctx: ExtensionContext, hasSavedPlan: boolean) {
	if (!hasSavedPlan) return false;
	const message =
		"A plan is saved for later. Implement or clear it before starting another Plan-mode workflow.";
	if (!ctx.hasUI) throw new Error(message);
	ctx.ui.notify(message, "warning");
	return true;
}

function cachedModuleLoader<Module>(load: () => Promise<Module>): () => Promise<Module> {
	let pending: Promise<Module> | undefined;
	return () => {
		if (!pending) {
			pending = Promise.resolve()
				.then(load)
				.catch((error) => {
					pending = undefined;
					throw error;
				});
		}
		return pending;
	};
}

export { completePlanArguments } from "./command.js";
export {
	extractProposedPlan,
	latestAssistantText,
	parseProposedPlan,
	stripProposedPlanBlocks,
	stripProposedPlanBlocksFromMessage,
} from "./message-transform.js";
export { buildPlanModePrompt } from "./prompt.js";
export { normalizePlanModeQuestionParams } from "./question-tool.js";
export { withoutPlanModeQuestionTool, withRequiredPlanModeTools } from "./required-tools.js";
export { normalizePlanModeSettings, readPlanModeSettings } from "./settings.js";
export { canSelectToolInPlanMode, classifyPlanModeTool, isSafeCommand } from "./tool-policy.js";
