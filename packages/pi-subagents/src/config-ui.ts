import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents/discovery.js";
import type { CompletionDelivery, DelegationCwdPolicy } from "./agents/types.js";
import {
	completionLabel,
	delegationCwdLabel,
	formatManagerSummary,
	helpLines,
	showSubagentHelp,
	showSubagentStatus,
	statusLines,
} from "./config-status.js";
import {
	applyAgentModel,
	applyAgentThinking,
	applyAgentTimeout,
	executionAgentPickerScreen,
	executionAgentScreen,
	executionModelInputScreen,
	executionModelScreen,
	executionThinkingScreen,
	executionTimeoutInputScreen,
	resetAgentExecution,
} from "./execution-ui.js";
import type { ManagedAgent } from "./registry.js";
import { safeTerminalLine as safeTerminalText } from "./safe-text.js";
import {
	hasOwn,
	inspectCompletionDeliverySettings,
	inspectCwdPolicySettings,
	inspectStatefulEnabledSettings,
	inspectUsageRecordingSettings,
	readSubagentSettings,
	sameToolSet,
	uniqueToolNames,
	updateAgentToolsSetting,
	updateCompletionDeliverySetting,
	updateCwdPolicySetting,
	updateStatefulEnabledSetting,
	updateUsageRecordingSetting,
} from "./settings.js";
import { formatStatefulAgentLine, type StatefulSubagentRuntimeStatus } from "./stateful.js";
import {
	applyStatefulLimitSetting,
	formatDetachedLimitSummary,
	formatEmptyStatefulRuntime,
	statefulLimitInputScreen,
	statefulLimitListScreen,
} from "./stateful-limit-ui.js";
import { isStatefulLimitField, type StatefulLimitField } from "./stateful-limits.js";
import { applyTransportSetting, transportLabel, transportSettingsScreen } from "./transport-ui.js";
import type { UsageRecordingStatus } from "./usage-recording.js";
import { USAGE_RECORDING_RETENTION_DAYS } from "./usage-recording-config.js";

const SUBCOMMANDS = [
	{ value: "settings", label: "settings", description: "Open grouped subagent settings" },
	{ value: "status", label: "status", description: "Show detailed subagent diagnostics" },
	{ value: "help", label: "help", description: "Show subagent first steps and safety help" },
];
const TOOL_VIEWPORT_SIZE = 10;

export interface SubagentSettingsRuntime {
	getCompletionDelivery(): CompletionDelivery;
	getDelegationCwdPolicy(): DelegationCwdPolicy;
	getUsageRecordingEnabled?(): boolean;
	getUsageRecordingStatus?(): UsageRecordingStatus;
	setUsageRecordingEnabled?(value: boolean): Promise<void>;
	setCompletionDelivery(value: CompletionDelivery): void;
	setDelegationCwdPolicy(value: DelegationCwdPolicy): void;
	getRuntimeStatus(): StatefulSubagentRuntimeStatus;
	listAgents(includeClosed?: boolean): ManagedAgent[];
	clearAgents(): Promise<number>;
}

export interface SubagentMenuOwner {
	generation: number;
	controller: AbortController;
}

interface ToolDraft {
	agentName: string;
	agentSource: string;
	allTools: string[];
	defaultTools?: string[];
	orderedTools: string[];
	selected: Set<string>;
}

export function registerSubagentConfigLifecycle(pi: ExtensionAPI): SubagentMenuOwner {
	const owner: SubagentMenuOwner = { generation: 0, controller: new AbortController() };
	pi.on("session_start", () => {
		owner.generation += 1;
		owner.controller.abort(new DOMException("Subagent session replaced", "AbortError"));
		owner.controller = new AbortController();
	});
	pi.on("session_shutdown", () => {
		owner.generation += 1;
		owner.controller.abort(new DOMException("Subagent session shut down", "AbortError"));
	});
	return owner;
}

export function registerSubagentConfigCommand(
	pi: ExtensionAPI,
	runtime: SubagentSettingsRuntime,
	owner = registerSubagentConfigLifecycle(pi),
) {
	registerSubagentPrimaryCommand(pi, runtime, owner);
}

function registerSubagentPrimaryCommand(
	pi: ExtensionAPI,
	runtime: SubagentSettingsRuntime,
	owner: SubagentMenuOwner,
) {
	pi.registerCommand("subagents", {
		description: "Manage subagents, settings, diagnostics, and help",
		getArgumentCompletions(prefix: string) {
			const normalized = prefix.trim().toLowerCase();
			const matches = SUBCOMMANDS.filter((item) => item.value.startsWith(normalized));
			return matches.length > 0 ? matches : null;
		},
		async handler(args, ctx) {
			const subcommand = args.trim().toLowerCase();
			if (!subcommand) {
				await showSubagentManager(pi, ctx, runtime, owner);
				return;
			}
			switch (subcommand) {
				case "settings":
					await showSubagentSettings(pi, ctx, runtime, owner);
					return;
				case "status":
					showSubagentStatus(ctx, runtime);
					return;
				case "help":
					showSubagentHelp(ctx, runtime);
					return;
				default:
					if (ctx.mode === "tui" || ctx.hasUI) {
						ctx.ui.notify(`Unknown /subagents subcommand: ${subcommand}`, "warning");
					}
			}
		},
	});
}

export async function showSubagentManager(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
	owner: SubagentMenuOwner,
	start: "main" | "settings-hub" = "main",
) {
	if (ctx.mode !== "tui") {
		showSubagentStatus(ctx, runtime);
		return;
	}
	const generation = owner.generation;
	const isCurrent = () => generation === owner.generation && !owner.controller.signal.aborted;
	const { defineMenu, runMenu } = await import("@narumitw/pi-tui-kit");
	if (!isCurrent()) return;
	let availableAgents = discoverAgents(ctx.cwd, "user", readSubagentSettings() ?? {}).agents;
	let toolDraft: ToolDraft | undefined;
	let selectedExecutionAgent: (typeof availableAgents)[number] | undefined;
	let selectedStatefulLimit: StatefulLimitField = "maxAgents";
	type Screen =
		| "main"
		| "agents"
		| "settings-hub"
		| "access-settings"
		| "behavior-settings"
		| "agent-settings"
		| "runtime-settings"
		| "transport"
		| "execution-agent-picker"
		| "execution-agent"
		| "execution-thinking"
		| "execution-model"
		| "execution-model-input"
		| "execution-timeout"
		| "stateful-limits"
		| "stateful-limit-input"
		| "status"
		| "help"
		| "agent-picker"
		| "tool-draft";
	type Action =
		| "clear-agents"
		| "set-enabled"
		| "set-transport"
		| "pick-execution-agent"
		| "set-agent-thinking"
		| "set-agent-model"
		| "set-agent-timeout"
		| "reset-agent-execution"
		| "pick-stateful-limit"
		| "set-stateful-limit"
		| "set-completion"
		| "set-delegation-cwd"
		| "set-usage-recording"
		| "load-agent-picker"
		| "pick-agent"
		| "toggle-tool"
		| "save-tools"
		| "discard-tools"
		| "back";
	const menu = defineMenu<undefined, Screen, Action, ExtensionCommandContext>({
		start,
		screens: {
			main: () => {
				const status = runtime.getRuntimeStatus();
				return {
					kind: "actions",
					title: "Subagents",
					lines: formatManagerSummary(status).split("\n"),
					items: [
						{
							id: "agents",
							label: "Current subagents",
							description: `${status.activeAgents} working · ${status.retainedAgents} saved for follow-up`,
							to: "agents",
						},
						{
							id: "settings",
							label: "Settings",
							description: "Folders, completion, privacy, agent defaults, and advanced options",
							to: "settings-hub",
						},
						{
							id: "status",
							label: "Diagnostics",
							description: "Detailed runtime values, setting sources, and file paths",
							to: "status",
						},
						{
							id: "help",
							label: "Help",
							description: "First steps, settings behavior, commands, and safety",
							to: "help",
						},
					],
					hint: "close",
				};
			},
			agents: () => {
				const agents = runtime.listAgents();
				const status = runtime.getRuntimeStatus();
				return {
					kind: "actions",
					title: "Current Subagents",
					lines: agents.length
						? [
								"Working subagents and subagents saved for follow-up in this session.",
								...agents.map(formatStatefulAgentLine),
							]
						: [formatEmptyStatefulRuntime(status)],
					items: [
						...(agents.length > 0
							? [
									{
										id: "clear",
										label: "Clear current subagents",
										description: "Stop running work and remove subagents saved for follow-up",
										action: "clear-agents" as const,
									},
								]
							: []),
						{ id: "back", label: "Back", action: "back" },
					],
					hint: "back",
				};
			},
			"settings-hub": () => ({
				kind: "actions",
				title: "Subagent Settings",
				lines: [
					"Changes are saved immediately.",
					"Transport and background-agent limits take effect after /reload.",
				],
				items: [
					{
						id: "access",
						label: "Folders and trusted resources",
						description: "Where retained subagents can start",
						to: "access-settings",
					},
					{
						id: "behavior",
						label: "Completion and privacy",
						description: "What Pi does when work finishes and optional local recording",
						to: "behavior-settings",
					},
					{
						id: "agents",
						label: "Agent defaults",
						description: "Tools, model, thinking effort, and time limit for each subagent",
						to: "agent-settings",
					},
					{
						id: "runtime",
						label: "Advanced runtime settings",
						description: "Transport and capacity controls that most users can leave unchanged",
						to: "runtime-settings",
					},
					{ id: "back", label: "Back", action: "back" },
				],
				hint: "back",
			}),
			"access-settings": () => subagentAccessSettingsScreen(runtime),
			"behavior-settings": () => subagentBehaviorSettingsScreen(runtime),
			"agent-settings": () => ({
				kind: "actions",
				title: "Agent Defaults",
				lines: ["Choose the starting settings for each subagent."],
				items: [
					{
						id: "agent-tools",
						label: "Tool permissions",
						description: "Choose which tools each subagent may use",
						action: "load-agent-picker",
					},
					{
						id: "execution",
						label: "Model, thinking, and time limit",
						description: "Choose how each subagent starts unless a request overrides it",
						to: "execution-agent-picker",
					},
					{ id: "back", label: "Back", action: "back" },
				],
				hint: "back",
			}),
			"runtime-settings": () => {
				const enabled = inspectStatefulEnabledSettings();
				return {
					kind: "actions",
					title: "Advanced Runtime Settings",
					lines: ["Most users can leave these settings unchanged."],
					items: [
						{
							id: "toggle-retained",
							label: "Retained delegation",
							description: `${enabled.value ? "Enabled" : "Disabled"} · change after reload`,
							action: "set-enabled",
							disabled: enabled.error !== undefined,
							disabledReason: enabled.error
								? `Repair ${safeTerminalText(enabled.path)} before editing this setting`
								: undefined,
						},
						{
							id: "transport",
							label: "Transport",
							description: `How Pi hosts background subagents · Current: ${transportLabel(runtime.getRuntimeStatus().transport)}`,
							to: "transport",
						},
						{
							id: "stateful-limits",
							label: "Background agent limits",
							description: formatDetachedLimitSummary(runtime.getRuntimeStatus()),
							to: "stateful-limits",
						},
						{ id: "back", label: "Back", action: "back" },
					],
					hint: "back",
				};
			},
			transport: () => transportSettingsScreen(runtime),
			"execution-agent-picker": () => executionAgentPickerScreen(availableAgents),
			"execution-agent": () => executionAgentScreen(selectedExecutionAgent),
			"execution-thinking": () => executionThinkingScreen(selectedExecutionAgent),
			"execution-model": () => executionModelScreen(selectedExecutionAgent, ctx),
			"execution-model-input": () => executionModelInputScreen(selectedExecutionAgent),
			"execution-timeout": () => executionTimeoutInputScreen(selectedExecutionAgent),
			"stateful-limits": () => statefulLimitListScreen(runtime),
			"stateful-limit-input": () => statefulLimitInputScreen(selectedStatefulLimit, runtime),
			status: () => ({
				kind: "detail",
				title: "Subagent Diagnostics",
				lines: statusLines(runtime),
				hint: "back",
			}),
			help: () => ({
				kind: "detail",
				title: "Subagents Help",
				lines: helpLines(runtime),
				hint: "back",
			}),
			"agent-picker": () => {
				const settings = readSubagentSettings() ?? {};
				const configured = settings.agents ?? {};
				return {
					kind: "actions",
					title: "Tool Permissions",
					lines: ["Choose a subagent to change which tools it may use."],
					items: availableAgents.map((agent) => {
						const override = configured[agent.name];
						const hasOverride = override ? hasOwn(override, "tools") : false;
						const summary = hasOverride
							? override?.tools && override.tools.length > 0
								? override.tools.join(", ")
								: "none"
							: "defaults";
						return {
							id: agent.name,
							label: safeTerminalText(agent.name),
							description: safeTerminalText(`${agent.source} · tools: ${summary}`),
							action: "pick-agent" as const,
						};
					}),
					hint: "back",
				};
			},
			"tool-draft": () => ({
				kind: "multiSelect",
				title: toolDraft ? `${safeTerminalText(toolDraft.agentName)} tools` : "Agent tools",
				enableSearch: true,
				lines: toolDraft
					? [
							`Source: ${safeTerminalText(toolDraft.agentSource)}`,
							"Toggle a draft, then Save changes.",
						]
					: ["No agent selected."],
				viewportSize: TOOL_VIEWPORT_SIZE,
				items:
					toolDraft?.orderedTools.map((name) => {
						const available = toolDraft?.allTools.includes(name) ?? false;
						return {
							id: name,
							label: safeTerminalText(name),
							description: available ? "Available tool" : "Configured tool is not currently loaded",
							searchText: available ? "available tool" : "configured unavailable preserved",
							selected: toolDraft?.selected.has(name) ?? false,
							disabled: !available,
							disabledReason: available
								? undefined
								: "Unavailable; preserved until explicitly changed in JSON",
						};
					}) ?? [],
				action: "toggle-tool",
				actions: [
					{ id: "save", label: "Save changes", action: "save-tools" },
					{ id: "discard", label: "Discard draft", action: "discard-tools" },
				],
				hint: "back",
				doneLabel: "Close without saving",
			}),
		},
		actions: {
			"clear-agents": async ({ signal }) => {
				const agents = runtime.listAgents();
				if (agents.length === 0) return { kind: "stay" };
				const confirmed = await ctx.ui.confirm(
					"Clear current subagents?",
					`Stop work and remove ${agents.length} subagent${agents.length === 1 ? "" : "s"} saved for follow-up?`,
					{ signal },
				);
				if (signal.aborted || !isCurrent()) return { kind: "close" };
				if (!confirmed) return { kind: "rejected" };
				if (
					runtime
						.listAgents()
						.map((agent) => agent.id)
						.join("\0") !== agents.map((agent) => agent.id).join("\0")
				) {
					ctx.ui.notify(
						"Current subagents changed while confirming; review the list again.",
						"warning",
					);
					return { kind: "rejected" };
				}
				const cleared = await runtime.clearAgents();
				if (signal.aborted || !isCurrent()) return { kind: "close" };
				ctx.ui.notify(`Cleared ${cleared} current subagent${cleared === 1 ? "" : "s"}.`, "info");
				return { kind: "stay" };
			},
			"set-enabled": async ({ signal }) =>
				applyRetainedEnabledSetting(ctx, runtime, signal, isCurrent),
			"set-transport": async ({ itemId, signal }) =>
				applyTransportSetting(itemId, ctx, runtime, signal, isCurrent),
			"pick-execution-agent": async ({ itemId }) => {
				selectedExecutionAgent = availableAgents.find((agent) => agent.name === itemId);
				return selectedExecutionAgent
					? { kind: "to", screen: "execution-agent" as const }
					: { kind: "rejected" as const };
			},
			"set-agent-thinking": async ({ value }) =>
				applyAgentThinking(selectedExecutionAgent, value, ctx),
			"set-agent-model": async ({ itemId, value }) => {
				const selected = value ?? (itemId.startsWith("model:") ? itemId.slice(6) : undefined);
				return applyAgentModel(
					selectedExecutionAgent,
					selected === "__inherited__" ? undefined : selected,
					ctx,
				);
			},
			"set-agent-timeout": async ({ value }) =>
				applyAgentTimeout(selectedExecutionAgent, value, ctx),
			"reset-agent-execution": async () => resetAgentExecution(selectedExecutionAgent, ctx),
			"pick-stateful-limit": async ({ itemId }) => {
				if (!isStatefulLimitField(itemId)) return { kind: "rejected" };
				selectedStatefulLimit = itemId;
				return { kind: "to", screen: "stateful-limit-input" };
			},
			"set-stateful-limit": async ({ value, signal }) =>
				applyStatefulLimitSetting(selectedStatefulLimit, value, ctx, runtime, {
					signal,
					isCurrent,
				}),
			"set-completion": async ({ value }) => applyCompletionSetting(value, ctx, runtime),
			"set-delegation-cwd": async ({ value }) => applyDelegationCwdSetting(value, ctx, runtime),
			"set-usage-recording": async ({ value, signal }) =>
				applyUsageRecordingSetting(value, ctx, runtime, { signal, isCurrent }),
			"load-agent-picker": async () => {
				availableAgents = discoverAgents(ctx.cwd, "user", readSubagentSettings() ?? {}).agents;
				if (availableAgents.length === 0) {
					ctx.ui.notify("No agents found", "warning");
					return { kind: "rejected" };
				}
				return { kind: "to", screen: "agent-picker" };
			},
			"pick-agent": async ({ itemId }) => {
				const agent = availableAgents.find((candidate) => candidate.name === itemId);
				if (!agent) return { kind: "rejected" };
				const settings = readSubagentSettings() ?? {};
				const configured = settings.agents?.[agent.name];
				const configuredTools =
					configured && hasOwn(configured, "tools") ? (configured.tools ?? []) : undefined;
				const defaults = discoverAgents(ctx.cwd, "user").agents.find(
					(candidate) => candidate.name === agent.name,
				)?.tools;
				const allTools = uniqueToolNames(pi.getAllTools().map((tool) => tool.name)).sort((a, b) =>
					a.localeCompare(b),
				);
				const selected = uniqueToolNames(configuredTools ?? defaults ?? allTools);
				const selectedSet = new Set(selected);
				toolDraft = {
					agentName: agent.name,
					agentSource: agent.source,
					allTools,
					defaultTools: defaults,
					orderedTools: [...selected, ...allTools.filter((name) => !selectedSet.has(name))],
					selected: selectedSet,
				};
				return { kind: "to", screen: "tool-draft" };
			},
			"toggle-tool": async ({ itemId, selected }) => {
				if (!toolDraft?.allTools.includes(itemId)) return { kind: "rejected" };
				if (selected) toolDraft.selected.add(itemId);
				else toolDraft.selected.delete(itemId);
				return { kind: "stay" };
			},
			"save-tools": async () => {
				if (!toolDraft) return { kind: "rejected" };
				const selected = toolDraft.orderedTools.filter((name) => toolDraft?.selected.has(name));
				const restoredDefaults =
					toolDraft.defaultTools === undefined
						? sameToolSet(selected, toolDraft.allTools)
						: sameToolSet(selected, toolDraft.defaultTools);
				try {
					updateAgentToolsSetting(toolDraft.agentName, restoredDefaults ? undefined : selected);
				} catch (error) {
					ctx.ui.notify(`Agent tool settings were not saved: ${formatError(error)}`, "error");
					return { kind: "rejected" };
				}
				ctx.ui.notify(
					restoredDefaults
						? `${safeTerminalText(toolDraft.agentName)}: defaults restored`
						: `${safeTerminalText(toolDraft.agentName)}: ${selected.length} tool${selected.length === 1 ? "" : "s"} configured`,
					"info",
				);
				toolDraft = undefined;
				return { kind: "back" };
			},
			"discard-tools": async () => {
				toolDraft = undefined;
				return { kind: "back" };
			},
			back: async () => ({ kind: "back" }),
		},
	});
	await runMenu(ctx, menu, {
		getState: () => undefined,
		signal: owner.controller.signal,
		isCurrent,
	});
}

export async function showSubagentSettings(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
	owner: SubagentMenuOwner,
) {
	const snapshot = inspectCompletionDeliverySettings();
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) {
			ctx.ui.notify(
				`User settings apply to this and future sessions. Edit settings manually: ${safeTerminalText(snapshot.path)}`,
				"info",
			);
		}
		return;
	}
	await showSubagentManager(pi, ctx, runtime, owner, "settings-hub");
}

function subagentAccessSettingsScreen(runtime: SubagentSettingsRuntime) {
	const cwdPolicy = inspectCwdPolicySettings();
	return {
		kind: "settings" as const,
		title: cwdPolicy.error ? "Folders and Trust · Read only" : "Folders and Trust",
		lines: [
			"Choose where retained subagents may start.",
			"This setting does not restrict files, shell commands, network access, or OS permissions.",
			"Manage saved folder trust with Pi /trust, then restart Pi.",
			safeTerminalText(cwdPolicy.path),
			...(cwdPolicy.error
				? [`Settings cannot be edited: ${safeTerminalText(cwdPolicy.error)}`]
				: []),
		],
		items: cwdPolicy.error
			? []
			: [
					{
						id: "delegationCwd",
						label: "Where subagents can start",
						description:
							"Limit subagents to this workspace, saved-trusted folders, or any folder Pi can access.",
						currentValue: delegationCwdLabel(runtime.getDelegationCwdPolicy()),
						values: [
							"This workspace or saved-trusted folders",
							"This workspace only",
							"Any folder Pi can access",
						],
						action: "set-delegation-cwd" as const,
					},
				],
	};
}

function subagentBehaviorSettingsScreen(runtime: SubagentSettingsRuntime) {
	const completion = inspectCompletionDeliverySettings();
	const usageRecording = inspectUsageRecordingSettings();
	const error = completion.error ?? usageRecording.error;
	return {
		kind: "settings" as const,
		title: error ? "Completion and Privacy · Read only" : "Completion and Privacy",
		lines: [
			"These changes apply immediately and to future sessions.",
			safeTerminalText(completion.path),
			...(error ? [`Settings cannot be edited: ${safeTerminalText(error)}`] : []),
		],
		items: error
			? []
			: [
					{
						id: "completionDelivery",
						label: "When background work finishes",
						description:
							"Wait for your next message, or steer results into active work and continue automatically from idle.",
						currentValue: completionLabel(runtime.getCompletionDelivery()),
						values: ["Wait for my next message", "Continue automatically when work finishes"],
						action: "set-completion" as const,
					},
					{
						id: "usageRecording",
						label: "Local usage recording",
						description: `Optionally keep content-free timing and lifecycle events on this device for ${USAGE_RECORDING_RETENTION_DAYS} days.`,
						currentValue: runtime.getUsageRecordingEnabled?.() ? "On · local only" : "Off",
						values: ["Off", "On · local only"],
						action: "set-usage-recording" as const,
					},
				],
	};
}

async function applyRetainedEnabledSetting(
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
	signal: AbortSignal,
	isCurrent: () => boolean,
) {
	const snapshot = inspectStatefulEnabledSettings();
	if (snapshot.error || signal.aborted || !isCurrent()) return { kind: "rejected" as const };
	const next = !snapshot.value;
	const currentStatus = runtime.getRuntimeStatus();
	if (!next && currentStatus.retainedAgents > 0) {
		ctx.ui.notify(
			`Cannot disable retained delegation while ${currentStatus.retainedAgents} subagent${currentStatus.retainedAgents === 1 ? " is" : "s are"} saved for follow-up. Clear Current subagents first.`,
			"warning",
		);
		return { kind: "rejected" as const };
	}
	const confirmed = await ctx.ui.confirm(
		`${next ? "Enable" : "Disable"} retained delegation?`,
		next
			? "Save the enabled tool surface and reload Pi?"
			: "Remove retained lifecycle tools after reload and keep metadata-only inspection?",
		{ signal },
	);
	if (signal.aborted || !isCurrent()) return { kind: "close" as const };
	if (!confirmed) return { kind: "rejected" as const };
	const refreshed = inspectStatefulEnabledSettings();
	if (refreshed.error || refreshed.value !== snapshot.value) {
		ctx.ui.notify(
			"Retained delegation settings changed while confirming; reopen settings.",
			"warning",
		);
		return { kind: "rejected" as const };
	}
	if (!next && runtime.getRuntimeStatus().retainedAgents > 0) {
		ctx.ui.notify(
			"Current subagents changed while confirming; review them before disabling.",
			"warning",
		);
		return { kind: "rejected" as const };
	}
	try {
		updateStatefulEnabledSetting(next);
	} catch (error) {
		ctx.ui.notify(`Retained delegation was not saved: ${formatError(error)}.`, "error");
		return { kind: "rejected" as const };
	}
	ctx.ui.notify(
		`Saved retained delegation ${next ? "enabled" : "disabled"}. Reloading tools… If the tool surface does not refresh, run /reload.`,
		"info",
	);
	await ctx.reload();
	return { kind: "close" as const };
}

async function applyUsageRecordingSetting(
	value: string | undefined,
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
	options: { signal: AbortSignal; isCurrent: () => boolean },
) {
	if (options.signal.aborted || !options.isCurrent()) return { kind: "close" as const };
	const previous = runtime.getUsageRecordingEnabled?.() ?? false;
	const next = value === "On · local only";
	if (next === previous) return { kind: "stay" as const };
	if (!runtime.setUsageRecordingEnabled) {
		ctx.ui.notify("Usage recording is unavailable in this session.", "error");
		return { kind: "rejected" as const };
	}
	try {
		updateUsageRecordingSetting(next);
	} catch (error) {
		ctx.ui.notify(`Subagent settings were not saved: ${formatError(error)}`, "error");
		return { kind: "rejected" as const };
	}
	try {
		await runtime.setUsageRecordingEnabled(next);
		if (options.signal.aborted || !options.isCurrent()) return { kind: "close" as const };
		ctx.ui.notify(
			next
				? `Local content-free usage recording enabled. Records stay on this device for ${USAGE_RECORDING_RETENTION_DAYS} days.`
				: "Local usage recording disabled. Existing records expire under the retention policy.",
			"info",
		);
		return { kind: "stay" as const };
	} catch (error) {
		if (options.signal.aborted || !options.isCurrent()) return { kind: "close" as const };
		try {
			updateUsageRecordingSetting(previous);
			await runtime.setUsageRecordingEnabled(previous);
			if (options.signal.aborted || !options.isCurrent()) return { kind: "close" as const };
		} catch (rollbackError) {
			if (options.signal.aborted || !options.isCurrent()) return { kind: "close" as const };
			ctx.ui.notify(
				`Usage recording could not be applied or rolled back: ${formatError(new AggregateError([error, rollbackError]))}`,
				"error",
			);
			return { kind: "rejected" as const };
		}
		ctx.ui.notify(`Subagent settings were not applied: ${formatError(error)}`, "error");
		return { kind: "rejected" as const };
	}
}

function applyCompletionSetting(
	value: string | undefined,
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
) {
	const previous = runtime.getCompletionDelivery();
	const next: CompletionDelivery =
		value === "Continue automatically when work finishes" ? "auto-resume" : "next-turn";
	if (next === previous) return { kind: "stay" as const };
	try {
		updateCompletionDeliverySetting(next);
		runtime.setCompletionDelivery(next);
		ctx.ui.notify(`Saved and applied: ${completionLabel(next)}.`, "info");
		return { kind: "stay" as const };
	} catch (error) {
		ctx.ui.notify(`Subagent settings were not saved: ${formatError(error)}`, "error");
		return { kind: "rejected" as const };
	}
}

function applyDelegationCwdSetting(
	value: string | undefined,
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
) {
	const previous = runtime.getDelegationCwdPolicy();
	const next: DelegationCwdPolicy =
		value === "This workspace only"
			? "current-workspace"
			: value === "Any folder Pi can access"
				? "anywhere"
				: "trusted-targets";
	if (next === previous) return { kind: "stay" as const };
	try {
		updateCwdPolicySetting("delegation", next);
		runtime.setDelegationCwdPolicy(next);
		ctx.ui.notify(`Saved and applied: ${delegationCwdLabel(next)}.`, "info");
		return { kind: "stay" as const };
	} catch (error) {
		ctx.ui.notify(`Subagent settings were not saved: ${formatError(error)}`, "error");
		return { kind: "rejected" as const };
	}
}

function formatError(error: unknown): string {
	return safeTerminalText(error instanceof Error ? error.message : String(error));
}
