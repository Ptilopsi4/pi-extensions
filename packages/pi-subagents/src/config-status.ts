import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CompletionDelivery, DelegationCwdPolicy } from "./agents/types.js";
import type { SubagentSettingsRuntime } from "./config-ui.js";
import { safeTerminalLine as safeTerminalText } from "./safe-text.js";
import {
	inspectCompletionDeliverySettings,
	inspectCwdPolicySettings,
	inspectStatefulEnabledSettings,
	inspectStatefulLimitSettings,
	inspectStatefulTransportSettings,
	inspectUsageRecordingSettings,
} from "./settings.js";
import type { StatefulSubagentRuntimeStatus } from "./stateful.js";
import {
	formatConfiguredDetachedLimitDivergence,
	formatDetachedLimitSummary,
} from "./stateful-limit-ui.js";
import { STATEFUL_LIMIT_DEFINITIONS } from "./stateful-limits.js";
import { USAGE_RECORDING_RETENTION_DAYS } from "./usage-recording-config.js";

export function showSubagentStatus(
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
): void {
	if (ctx.mode !== "tui" && !ctx.hasUI) return;
	const snapshot = inspectCompletionDeliverySettings();
	ctx.ui.notify(
		formatStatus(runtime.getRuntimeStatus(), snapshot, runtime),
		snapshot.error ? "warning" : "info",
	);
}

export function showSubagentHelp(
	ctx: ExtensionCommandContext,
	runtime: SubagentSettingsRuntime,
): void {
	if (ctx.mode !== "tui" && !ctx.hasUI) return;
	ctx.ui.notify(helpLines(runtime).join("\n"), "info");
}

export function statusLines(runtime: SubagentSettingsRuntime): string[] {
	const snapshot = inspectCompletionDeliverySettings();
	return formatStatus(runtime.getRuntimeStatus(), snapshot, runtime).split("\n");
}

export function helpLines(_runtime: SubagentSettingsRuntime): string[] {
	return [
		"Start here",
		"  1. Use subagent_spawn for bounded work that can run beside useful main-agent work.",
		"  2. Use subagent_await only when a retained result is required and useful overlap is complete.",
		"  3. Open Completion and privacy if Pi must continue automatically when work finishes.",
		"Current subagents shows work in progress and subagents saved for follow-up.",
		"Settings",
		"  Folders and trust — choose where retained subagents may start.",
		"  Completion and privacy — choose what Pi does when work finishes and whether usage is recorded.",
		"  Agent defaults — choose tools, model, thinking effort, and time limit for each subagent.",
		"  Advanced runtime settings — optional transport and capacity controls.",
		"Changes are saved immediately.",
		"Transport and background-agent limits apply after /reload.",
		"Commands",
		"  /subagents — open the manager",
		"  /subagents settings — open Settings",
		"  /subagents status — show detailed diagnostics",
		"  /subagents help — show this help",
		"Safety",
		"Folder choices control starting locations and loaded resources; they do not sandbox files, commands, or network access.",
		"Manage saved folder trust with Pi /trust, then restart Pi.",
	];
}

export function formatManagerSummary(status: StatefulSubagentRuntimeStatus): string {
	const enabled = inspectStatefulEnabledSettings();
	const detachedLimits = inspectStatefulLimitSettings();
	const detachedDivergence = detachedLimits.values
		? formatConfiguredDetachedLimitDivergence(status, detachedLimits.values)
		: undefined;
	return [
		`Retained delegation: ${status.enabled ? "enabled" : "disabled"}`,
		`Subagents: ${status.activeAgents} working · ${status.retainedAgents} saved for follow-up`,
		`When work finishes: ${completionLabel(status.completionDelivery)}`,
		...(enabled.value !== status.enabled
			? [`Configured after reload: retained delegation ${enabled.value ? "enabled" : "disabled"}`]
			: []),
		...(detachedDivergence ? [detachedDivergence] : []),
		...(enabled.error || detachedLimits.error
			? ["Action needed: Repair user settings. Open Diagnostics for details."]
			: []),
	].join("\n");
}

function formatStatus(
	status: StatefulSubagentRuntimeStatus,
	snapshot: ReturnType<typeof inspectCompletionDeliverySettings>,
	runtime?: SubagentSettingsRuntime,
): string {
	const cwdPolicy = inspectCwdPolicySettings();
	const enabled = inspectStatefulEnabledSettings();
	const detachedLimits = inspectStatefulLimitSettings();
	const transport = inspectStatefulTransportSettings();
	const usageRecording = inspectUsageRecordingSettings();
	const usageStatus = runtime?.getUsageRecordingStatus?.();
	return [
		"Current Session",
		`  Retained delegation: ${status.enabled ? "enabled" : "disabled"}`,
		`  Background runtime: ${status.initialized ? "initialized" : status.enabled ? "not initialized" : "disabled"}`,
		`  Transport: ${status.transport}`,
		`  Configured transport: ${transport.value} (${transport.source})`,
		`  When work finishes: ${completionLabel(status.completionDelivery)}`,
		`  Subagent folders: ${delegationCwdLabel(runtime?.getDelegationCwdPolicy() ?? cwdPolicy.delegation.value)}`,
		`  Background-agent limits: ${formatDetachedLimitSummary(status)}`,
		`  Subagents: ${status.activeAgents} working, ${status.retainedAgents} saved for follow-up`,
		`  Local usage recording: ${usageStatus?.enabled ? "enabled" : "disabled"}`,
		`  Recorded events this session: ${usageStatus?.recordedEvents ?? 0}`,
		`  Usage retention: ${usageStatus?.retentionDays ?? USAGE_RECORDING_RETENTION_DAYS} days`,
		`  Usage path: ${safeTerminalText(usageStatus?.path ?? "unavailable")}`,
		"User Settings",
		`  Configured retained delegation: ${enabled.value ? "enabled" : "disabled"}`,
		`  Retained delegation source: ${enabled.source}`,
		`  Completion source: ${snapshot.source}`,
		`  Configured completion: ${completionLabel(snapshot.value)}`,
		...(detachedLimits.values
			? STATEFUL_LIMIT_DEFINITIONS.map((definition) => {
					const configured = detachedLimits.values?.[definition.field];
					return `  Configured ${definition.label.toLowerCase()}: ${configured?.value} (${configured?.source})`;
				})
			: ["  Configured detached limits: unavailable"]),
		`  Configured delegation target: ${delegationCwdLabel(cwdPolicy.delegation.value)}`,
		`  Delegation target source: ${cwdPolicy.delegation.source}`,
		`  Configured usage recording: ${usageRecording.enabled ? "enabled" : "disabled"}`,
		`  Usage recording source: ${usageRecording.source}`,
		`  Path: ${safeTerminalText(snapshot.path)}`,
		cwdPolicy.error ||
		enabled.error ||
		snapshot.error ||
		detachedLimits.error ||
		transport.error ||
		usageRecording.error
			? `  Warning: ${safeTerminalText(cwdPolicy.error ?? enabled.error ?? snapshot.error ?? detachedLimits.error ?? transport.error ?? usageRecording.error ?? "invalid settings")}`
			: "  Warning: none",
		"Manual file changes require /reload.",
	].join("\n");
}

export function completionLabel(value: CompletionDelivery): string {
	return value === "auto-resume"
		? "Continue automatically when work finishes"
		: "Wait for my next message";
}

export function delegationCwdLabel(value: DelegationCwdPolicy): string {
	switch (value) {
		case "trusted-targets":
			return "This workspace or saved-trusted folders";
		case "current-workspace":
			return "This workspace only";
		case "anywhere":
			return "Any folder Pi can access";
	}
}
