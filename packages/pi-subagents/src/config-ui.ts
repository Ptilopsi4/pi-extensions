import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents/discovery.js";
import type {
	CompletionDelivery,
	ConsultationCwdPolicy,
	ConsultResourcePolicy,
	DelegationCwdPolicy,
} from "./agents/types.js";
import {
	completionLabel,
	consultationCwdLabel,
	consultResourceLabel,
	currentWorkflow,
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
import {
	applyBlockingParallelLimitSetting,
	blockingParallelLimitScreen,
} from "./parallel-limit-ui.js";
import type { ManagedAgent } from "./registry.js";
import { safeTerminalLine as safeTerminalText } from "./safe-text.js";
import type { DelegationWorkflow } from "./settings/inspection.js";
import {
	hasOwn,
	inspectBlockingParallelLimitSettings,
	inspectCompletionDeliverySettings,
	inspectConsultResourceSettings,
	inspectCwdPolicySettings,
	inspectDelegationWorkflowSettings,
	inspectUsageRecordingSettings,
	readSubagentSettings,
	sameToolSet,
	uniqueToolNames,
	updateAgentToolsSetting,
	updateCompletionDeliverySetting,
	updateConsultResourceSetting,
	updateCwdPolicySetting,
	updateDelegationWorkflowSetting,
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
import { showWorkflowPreview, workflowLabel } from "./workflow-ui.js";

const SUBCOMMANDS = [
	{ value: "settings", label: "settings", description: "Open grouped subagent settings" },
	{ value: "status", label: "status", description: "Show detailed subagent diagnostics" },
	{ value: "help", label: "help", description: "Show subagent first steps and safety help" },
];
const TOOL_VIEWPORT_SIZE = 10;

export interface SubagentSettingsRuntime {
	getBlockingEnabled(): boolean;
	getMaxParallelTasks(): number;
	getCompletionDelivery(): CompletionDelivery;
	getConsultResourcePolicy(): ConsultResourcePolicy;
	getConsultationCwdPolicy(): ConsultationCwdPolicy;
	getDelegationCwdPolicy(): DelegationCwdPolicy;
	getUsageRecordingEnabled?(): boolean;
	getUsageRecordingStatus?(): UsageRecordingStatus;
	setUsageRecordingEnabled?(value: boolean): Promise<void>;
	setMaxParallelTasks(value: number): void;
	setCompletionDelivery(value: CompletionDelivery): void;
	setConsultResourcePolicy(value: ConsultResourcePolicy): void;
	setConsultationCwdPolicy(value: ConsultationCwdPolicy): void;
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
		| "workflow"
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
		| "parallel-limit"
		| "stateful-limits"
		| "stateful-limit-input"
		| "status"
		| "help"
		| "agent-picker"
		| "tool-draft";
	type Action =
		| "set-workflow"
		| "clear-agents"
		| "set-transport"
		| "pick-execution-agent"
		| "set-agent-thinking"
		| "set-agent-model"
		| "set-agent-timeout"
		| "reset-agent-execution"
		| "set-parallel-limit"
		| "pick-stateful-limit"
		| "set-stateful-limit"
		| "set-completion"
		| "set-consult-resources"
		| "set-consultation-cwd"
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
				const workflow = inspectDelegationWorkflowSettings();
				return {
					kind: "actions",
					title: "Subagents",
					lines: formatManagerSummary(runtime, status, workflow).split("\n"),
					items: [
						{
							id: "workflow",
							label: "How subagents run",
							description: "Choose whether Pi stays available while subagents work",
							to: "workflow",
						},
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
			workflow: () => {
				const snapshot = inspectDelegationWorkflowSettings();
				const active = currentWorkflow(runtime, runtime.getRuntimeStatus());
				return {
					kind: "actions",
					title: "How Subagents Run",
					lines: [
						`Current: ${workflowLabel(active)}`,
						"Recommended: Keep Pi available (async) while subagents work in the background.",
						"The blocking subagent tool is deprecated and remains available only for compatibility.",
						"subagent_consult and subagent_await remain supported blocking helpers.",
						"For results needed in the current answer, enable automatic continuation in Settings.",
						...(snapshot.value !== active
							? [`Configured after reload: ${workflowLabel(snapshot.value)}`]
							: []),
						...(snapshot.error
							? [
									`Settings cannot be edited: ${safeTerminalText(snapshot.error)}`,
									`Repair ${safeTerminalText(snapshot.path)} and retry.`,
								]
							: []),
					],
					items: snapshot.error
						? []
						: [
								{
									id: "async-only",
									label: `${workflowLabel("async-only")} · Recommended`,
									description: "Subagents work in the background while you continue using Pi",
									action: "set-workflow" as const,
								},
								{
									id: "all",
									label: workflowLabel("all"),
									description:
										"Background agents plus deprecated subagent and supported blocking helpers",
									action: "set-workflow" as const,
								},
								{
									id: "blocking-only",
									label: workflowLabel("blocking-only"),
									description:
										"No background agents; deprecated subagent plus read-only consultation",
									action: "set-workflow" as const,
								},
							],
					hint: "back",
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
						description: "Where subagents can start and what trusted consultations can load",
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
				const limit = inspectBlockingParallelLimitSettings();
				return {
					kind: "actions",
					title: "Advanced Runtime Settings",
					lines: ["Most users can leave these settings unchanged."],
					items: [
						{
							id: "transport",
							label: "Transport",
							description: `How Pi hosts background subagents · Current: ${transportLabel(runtime.getRuntimeStatus().transport)}`,
							to: "transport",
						},
						{
							id: "parallel-limit",
							label: "Blocking worker limit",
							description: `Maximum subagents per blocking request · Current: ${runtime.getMaxParallelTasks()}`,
							to: "parallel-limit",
							disabled: limit.error !== undefined,
							disabledReason: limit.error
								? `Repair ${safeTerminalText(limit.path)} before editing this setting`
								: undefined,
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
			"parallel-limit": () => blockingParallelLimitScreen(runtime),
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
			"set-workflow": async ({ itemId, signal }) => {
				if (!isWorkflow(itemId)) return { kind: "rejected" };
				const snapshot = inspectDelegationWorkflowSettings();
				if (snapshot.error) return { kind: "rejected" };
				const active = currentWorkflow(runtime, runtime.getRuntimeStatus());
				if (itemId === active && itemId === snapshot.value) {
					ctx.ui.notify(`Subagents already use ${workflowLabel(itemId)}.`, "info");
					return { kind: "stay" };
				}
				const requiresReload = itemId !== active;
				if (requiresReload && blockReloadWithRetainedAgents(ctx, runtime)) {
					return { kind: "rejected" };
				}
				if (!(await showWorkflowPreview(ctx, active, itemId, requiresReload, signal))) {
					return signal.aborted || !isCurrent() ? { kind: "close" } : { kind: "rejected" };
				}
				if (signal.aborted || !isCurrent()) return { kind: "close" };
				if (requiresReload && blockReloadWithRetainedAgents(ctx, runtime)) {
					return { kind: "rejected" };
				}
				try {
					updateDelegationWorkflowSetting(itemId);
				} catch (error) {
					ctx.ui.notify(
						`How subagents run was not saved: ${formatError(error)}. The current choice is unchanged.`,
						"error",
					);
					return { kind: "rejected" };
				}
				if (!requiresReload) {
					ctx.ui.notify(
						`Saved ${workflowLabel(itemId)}. The current tool surface already matches.`,
						"info",
					);
					return { kind: "stay" };
				}
				ctx.ui.notify(
					`Saved ${workflowLabel(itemId)}. Reloading subagent tools… If the tool surface does not refresh, run /reload.`,
					"info",
				);
				await ctx.reload();
				return { kind: "close" };
			},
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
			"set-parallel-limit": async ({ value }) =>
				applyBlockingParallelLimitSetting(value, ctx, runtime),
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
			"set-consult-resources": async ({ value }) =>
				applyConsultResourceSetting(value, ctx, runtime),
			"set-consultation-cwd": async ({ value }) => applyConsultationCwdSetting(value, ctx, runtime),
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
	const snapshot = inspectConsultResourceSettings();
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
	const consult = inspectConsultResourceSettings();
	const cwdPolicy = inspectCwdPolicySettings();
	const error = consult.error ?? cwdPolicy.error;
	return {
		kind: "settings" as const,
		title: error ? "Folders and Trusted Resources · Read only" : "Folders and Trusted Resources",
		lines: [
			"Choose where subagents may start and what read-only consultations may load.",
			"These settings do not restrict files, shell commands, network access, or OS permissions.",
			"Manage saved folder trust with Pi /trust, then restart Pi.",
			safeTerminalText(consult.path),
			...(error ? [`Settings cannot be edited: ${safeTerminalText(error)}`] : []),
		],
		items: error
			? []
			: [
					{
						id: "consultationCwd",
						label: "Where read-only consultations can start",
						description:
							"Use only this workspace, or allow other folders without loading untrusted project resources.",
						currentValue: consultationCwdLabel(runtime.getConsultationCwdPolicy()),
						values: ["Any folder · no project resources when untrusted", "This workspace only"],
						action: "set-consultation-cwd" as const,
					},
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
					{
						id: "consultResources",
						label: "Resources for trusted read-only consultations",
						description:
							"Choose how much project context, skills, and prompt guidance a trusted consultation may load.",
						currentValue: consultResourceLabel(runtime.getConsultResourcePolicy()),
						values: ["Project context only", "No project resources", "All trusted resources"],
						action: "set-consult-resources" as const,
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
							"Wait for your next message, or let Pi continue automatically so it can use the result.",
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

function applyConsultResourceSetting(
	value: string | undefined,
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
) {
	const previous = runtime.getConsultResourcePolicy();
	const next: ConsultResourcePolicy =
		value === "No project resources"
			? "none"
			: value === "All trusted resources"
				? "all"
				: "project-context";
	if (next === previous) return { kind: "stay" as const };
	try {
		updateConsultResourceSetting(next);
		runtime.setConsultResourcePolicy(next);
		ctx.ui.notify(`Saved and applied: ${consultResourceLabel(next)}.`, "info");
		return { kind: "stay" as const };
	} catch (error) {
		ctx.ui.notify(`Subagent settings were not saved: ${formatError(error)}`, "error");
		return { kind: "rejected" as const };
	}
}

function applyConsultationCwdSetting(
	value: string | undefined,
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
) {
	const previous = runtime.getConsultationCwdPolicy();
	const next: ConsultationCwdPolicy =
		value === "This workspace only" ? "current-workspace" : "anywhere";
	if (next === previous) return { kind: "stay" as const };
	try {
		updateCwdPolicySetting("consultation", next);
		runtime.setConsultationCwdPolicy(next);
		ctx.ui.notify(`Saved and applied: ${consultationCwdLabel(next)}.`, "info");
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

function blockReloadWithRetainedAgents(
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
): boolean {
	const status = runtime.getRuntimeStatus();
	if (status.retainedAgents === 0) return false;
	ctx.ui.notify(
		`Cannot reload while ${status.retainedAgents} subagent${status.retainedAgents === 1 ? " is" : "s are"} saved for follow-up (${status.activeAgents} working). Open Current subagents and clear them after their work is safe to discard, then change how subagents run.`,
		"warning",
	);
	return true;
}

function isWorkflow(value: string): value is Exclude<DelegationWorkflow, "disabled"> {
	return value === "all" || value === "async-only" || value === "blocking-only";
}

function formatError(error: unknown): string {
	return safeTerminalText(error instanceof Error ? error.message : String(error));
}
