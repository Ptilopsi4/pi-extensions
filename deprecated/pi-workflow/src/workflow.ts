import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { safeTerminalText } from "./goal/errors.js";
import goal from "./goal/goal.js";
import type { ActiveGoal } from "./goal/persistence.js";
import { buildGoalPrompt } from "./goal/prompts.js";
import type { WorkflowMenuController } from "./menu.js";
import planMode, { type PlanModeHandle } from "./plan/plan-mode.js";
import { restorePlanModeState } from "./plan/state.js";
import {
	type PlanHandoffBehavior,
	readWorkflowGoalSettings,
	readWorkflowPlanSettings,
	readWorkflowSettings,
	saveWorkflowGoalSettings,
	updateWorkflowPlanHandoff,
	updateWorkflowPlanSettings,
	type WorkflowSettingsLoadResult,
	workflowSettingsPath,
} from "./settings.js";
import { WORKFLOW_GOAL_OBJECTIVE } from "./workflow-contract.js";

type WorkflowMenuModule = Pick<typeof import("./menu.js"), "showWorkflowMenu">;
type FreshHandoffModule = Pick<typeof import("./handoff.js"), "startFreshWorkflowImplementation">;

export interface WorkflowDependencies {
	settingsPath?: string;
	readSettings?: () => WorkflowSettingsLoadResult;
	loadWorkflowMenu?: () => Promise<WorkflowMenuModule>;
	loadFreshHandoff?: () => Promise<FreshHandoffModule>;
}

export default function workflow(pi: ExtensionAPI, dependencies: WorkflowDependencies = {}) {
	const settingsPath = dependencies.settingsPath ?? workflowSettingsPath();
	const readSettings = dependencies.readSettings ?? (() => readWorkflowSettings(settingsPath));
	const loadWorkflowMenu = cachedModuleLoader(
		dependencies.loadWorkflowMenu ?? (() => import("./menu.js")),
	);
	const loadFreshHandoff = cachedModuleLoader(
		dependencies.loadFreshHandoff ?? (() => import("./handoff.js")),
	);
	let planHandoff: PlanHandoffBehavior = "review";
	let settingsIssue: string | undefined;
	let workflowGeneration = 0;
	let workflowController = new AbortController();
	let currentSessionManager: unknown;
	const readPlanSettings = () => {
		if (!dependencies.readSettings) return readWorkflowPlanSettings(settingsPath);
		const loaded = readSettings();
		return loaded.kind === "loaded"
			? { kind: "loaded" as const, settings: loaded.settings.plan }
			: loaded;
	};
	const readGoalSettings = () => {
		if (!dependencies.readSettings) return readWorkflowGoalSettings(settingsPath);
		const loaded = readSettings();
		return loaded.kind === "loaded"
			? { kind: "loaded" as const, settings: loaded.settings.goal }
			: loaded;
	};
	let restoredPlanEntryIndex = -1;
	let restoredGoalEntryIndex = -1;
	pi.on("session_start", (_event, ctx) => {
		const branch = ctx.sessionManager.getBranch();
		restoredPlanEntryIndex = latestCustomEntryIndex(branch, "plan-mode-state");
		restoredGoalEntryIndex = latestCustomEntryIndex(branch, "goal-state");
	});
	let planHandle: PlanModeHandle | undefined;
	const goalHandle = goal(pi, {
		settingsPath,
		readSettings: readGoalSettings,
		reportSettingsIssues: false,
		saveSettings: saveWorkflowGoalSettings,
		canStartGoal: () => {
			const planState = planHandle?.getState();
			return planState?.enabled || planState?.activeImplementation
				? "Finish or exit Plan mode before starting another Goal."
				: undefined;
		},
		onGoalSuperseded: (previousGoal, nextGoal) => {
			if (nextGoal && planHandle?.clearLinkedGoal(nextGoal.id)) return;
			planHandle?.clearLinkedGoal(previousGoal.id);
		},
		activateRestoredGoal: (ctx, restoredGoal) => {
			const planState = restorePlanModeState(ctx.sessionManager.getBranch(), "plan-mode-state");
			return planState.activeImplementation?.goalId === restoredGoal.id;
		},
	});
	planHandle = planMode(pi, {
		settingsPath,
		readSettings: async () => readPlanSettings(),
		reportSettingsIssues: false,
		shouldAutoHandoff: () => planHandoff === "automatic",
		implementationPlanRetention: "keep",
		implementationOutcome: () =>
			"Goal execution keeps the exact Plan linked until Goal completes, is cleared, or is superseded.",
		showImplementationPlanRetentionSetting: false,
		manageLinkedGoal: (ctx) => goalHandle.ui.showManager(ctx),
		canStartPlan: () =>
			goalHandle.runtime.activeGoal
				? "Clear the current Goal before starting Plan mode."
				: undefined,
		startFreshImplementation: async (ctx, request) => {
			const ownership = captureWorkflowOwnership(ctx, request.isCurrent);
			if (!ownership.isCurrent()) return { kind: "stale" };
			let handoffModule: FreshHandoffModule;
			try {
				handoffModule = await loadFreshHandoff();
			} catch (error) {
				if (!ownership.isCurrent()) return { kind: "stale" };
				throw error;
			}
			if (!ownership.isCurrent()) return { kind: "stale" };
			return handoffModule.startFreshWorkflowImplementation(ctx, {
				...request,
				isCurrent: ownership.isCurrent,
			});
		},
		updateSettings: (patch, options) =>
			updateWorkflowPlanSettings(patch, {
				settingsPath,
				signal: options?.signal,
			}),
		startImplementation: async (request, ctx) => {
			if (goalHandle.runtime.activeGoal) {
				ctx.ui.notify(
					"Cannot hand off the Plan while another Goal exists. Clear the Goal and retry.",
					"warning",
				);
				return false;
			}
			const started = await goalHandle.commands.startGoal(
				WORKFLOW_GOAL_OBJECTIVE,
				undefined,
				ctx,
				(goal) => {
					planHandle?.linkImplementationToGoal(request.implementationId, goal.id);
				},
				(goal) =>
					request.isCurrent() && planHandle?.getState().activeImplementation?.goalId === goal.id,
				request.isCurrent,
				(goal: ActiveGoal) => `${request.handoffPrompt}\n\n${buildGoalPrompt(goal)}`,
				true,
			);
			return started !== undefined;
		},
	});
	goalHandle.runtime.addGoalStateSink((snapshot) => {
		planHandle?.handleGoalState(snapshot);
	});
	pi.on("session_start", (_event, ctx) => {
		workflowGeneration += 1;
		currentSessionManager = ctx.sessionManager;
		let restoredGoal = goalHandle.runtime.activeGoal;
		const restoredPlanState = planHandle?.getState();
		const unlinkedImplementation =
			restoredPlanState?.activeImplementation !== undefined &&
			restoredPlanState.activeImplementation.goalId === undefined;
		if (restoredGoal && (restoredPlanState?.enabled || unlinkedImplementation)) {
			if (restoredPlanEntryIndex > restoredGoalEntryIndex) {
				goalHandle.commands.clearGoal(ctx);
				restoredGoal = goalHandle.runtime.activeGoal;
			} else {
				planHandle?.clearForGoalConflict(ctx);
			}
		}
		if (!restoredGoal) planHandle?.recoverUnlinkedImplementation(ctx);
		const restoredPlan = planHandle?.getState().activeImplementation;
		if (restoredGoal && restoredGoal.text !== WORKFLOW_GOAL_OBJECTIVE && restoredPlan?.goalId) {
			planHandle?.clearLinkedGoal(restoredPlan.goalId);
		} else {
			planHandle?.reconcileGoalState(restoredGoal);
		}
		workflowController.abort(new DOMException("Workflow session replaced", "AbortError"));
		workflowController = new AbortController();
		const loaded = readSettings();
		planHandoff = loaded.kind === "loaded" ? loaded.settings.planHandoff : "review";
		settingsIssue = loaded.kind === "invalid" ? loaded.reason : undefined;
		if (settingsIssue) {
			ctx.ui.notify(`pi-workflow settings ignored: ${safeTerminalText(settingsIssue)}`, "warning");
		}
	});
	pi.on("session_shutdown", (_event, ctx) => {
		workflowGeneration += 1;
		if (currentSessionManager === ctx.sessionManager) currentSessionManager = undefined;
		workflowController.abort(new DOMException("Workflow session shut down", "AbortError"));
	});

	const menuController: WorkflowMenuController = {
		getState: () => {
			const planState = planHandle?.getState();
			const goalState = goalHandle.runtime.activeGoal;
			return {
				plan: planState?.enabled
					? planState.latestPlan
						? "ready"
						: "planning"
					: planState?.savedPlan
						? "saved"
						: planState?.activeImplementation
							? "implementing"
							: "off",
				...(goalState ? { goal: { status: goalState.status, objective: goalState.text } } : {}),
				planHandoff,
				settingsPath,
				...(settingsIssue ? { settingsIssue } : {}),
			};
		},
		setPlanHandoff: (value) => {
			const saved = updateWorkflowPlanHandoff(value, settingsPath);
			planHandoff = saved.planHandoff;
			settingsIssue = undefined;
		},
		showPlan: (ctx) => planHandle?.showManager(ctx) ?? Promise.resolve(),
		showGoal: (ctx) => goalHandle.ui.showManager(ctx),
		showPlanSettings: (ctx) => planHandle?.showSettings(ctx) ?? Promise.resolve(),
		showGoalSettings: (ctx) => goalHandle.ui.showSettings(ctx),
	};

	pi.registerCommand("workflow", {
		description: "Manage the Plan-to-Goal workflow",
		handler: async (args, ctx) => {
			if (args.trim()) {
				reportWorkflowError("/workflow does not accept arguments.", ctx);
				return;
			}
			if (ctx.mode === "print" || ctx.mode === "json") {
				throw new Error("The /workflow manager requires TUI or RPC mode.");
			}
			const ownership = captureWorkflowOwnership(ctx);
			if (!ownership.isCurrent()) return;
			let menuModule: WorkflowMenuModule;
			try {
				menuModule = await loadWorkflowMenu();
			} catch (error) {
				if (!ownership.isCurrent()) return;
				throw error;
			}
			if (!ownership.isCurrent()) return;
			await menuModule.showWorkflowMenu(ctx, menuController, {
				signal: ownership.signal,
				isCurrent: ownership.isCurrent,
			});
		},
	});

	function captureWorkflowOwnership(
		ctx: { sessionManager: unknown },
		additionalCheck: () => boolean = () => true,
	) {
		const generation = workflowGeneration;
		const controller = workflowController;
		const sessionManager = ctx.sessionManager;
		return {
			signal: controller.signal,
			isCurrent: () =>
				generation === workflowGeneration &&
				controller === workflowController &&
				!controller.signal.aborted &&
				currentSessionManager === sessionManager &&
				additionalCheck(),
		};
	}
}

function latestCustomEntryIndex(entries: unknown[], customType: string) {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (
			entry &&
			typeof entry === "object" &&
			"customType" in entry &&
			(entry as { customType?: unknown }).customType === customType
		) {
			return index;
		}
	}
	return -1;
}

function reportWorkflowError(message: string, ctx: ExtensionCommandContext) {
	if (ctx.mode === "print" || ctx.mode === "json") throw new Error(message);
	ctx.ui.notify(message, "warning");
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
