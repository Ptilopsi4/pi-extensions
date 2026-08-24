import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type {
	CompletionDelivery,
	ConsultationCwdPolicy,
	ConsultResourcePolicy,
	DelegationCwdPolicy,
} from "./agents/types.js";
import type { SubagentSettingsRuntime } from "./config-ui.js";
import { safeTerminalLine as safeTerminalText } from "./safe-text.js";
import type { DelegationWorkflow } from "./settings/inspection.js";
import {
	inspectBlockingParallelLimitSettings,
	inspectCompletionDeliverySettings,
	inspectConsultResourceSettings,
	inspectCwdPolicySettings,
	inspectDelegationWorkflowSettings,
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
import { workflowLabel } from "./workflow-ui.js";

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
		"  1. Open How subagents run.",
		"  2. Choose Keep Pi available (async) · Recommended.",
		"  3. Open Completion and privacy if Pi must use background results in the current answer.",
		"The blocking subagent tool is deprecated and remains available only in compatibility workflows.",
		"subagent_consult and subagent_await remain supported.",
		"Current subagents shows work in progress and subagents saved for follow-up.",
		"Settings",
		"  Folders and trusted resources — choose where subagents start and what consultations load.",
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

export function formatManagerSummary(
	runtime: SubagentSettingsRuntime,
	status: StatefulSubagentRuntimeStatus,
	configured: ReturnType<typeof inspectDelegationWorkflowSettings>,
): string {
	const current = currentWorkflow(runtime, status);
	const detachedLimits = inspectStatefulLimitSettings();
	const detachedDivergence = detachedLimits.values
		? formatConfiguredDetachedLimitDivergence(status, detachedLimits.values)
		: undefined;
	return [
		`How subagents run: ${workflowLabel(current)}`,
		`Subagents: ${status.activeAgents} working · ${status.retainedAgents} saved for follow-up`,
		`When work finishes: ${completionLabel(status.completionDelivery)}`,
		...(configured.value !== current
			? [`Configured after reload: ${workflowLabel(configured.value)}`]
			: []),
		...(detachedDivergence ? [detachedDivergence] : []),
		...(configured.error || detachedLimits.error
			? ["Action needed: Repair user settings. Open Diagnostics for details."]
			: []),
	].join("\n");
}

function formatStatus(
	status: StatefulSubagentRuntimeStatus,
	snapshot: ReturnType<typeof inspectCompletionDeliverySettings>,
	runtime?: SubagentSettingsRuntime,
): string {
	const configuredWorkflow = inspectDelegationWorkflowSettings();
	const consult = inspectConsultResourceSettings();
	const cwdPolicy = inspectCwdPolicySettings();
	const parallelLimit = inspectBlockingParallelLimitSettings();
	const detachedLimits = inspectStatefulLimitSettings();
	const transport = inspectStatefulTransportSettings();
	const usageRecording = inspectUsageRecordingSettings();
	const current = runtime ? currentWorkflow(runtime, status) : configuredWorkflow.value;
	const usageStatus = runtime?.getUsageRecordingStatus?.();
	return [
		"Current Session",
		`  How subagents run: ${workflowLabel(current)}`,
		`  Background runtime: ${status.initialized ? "initialized" : status.enabled ? "not initialized" : "disabled"}`,
		`  Transport: ${status.transport}`,
		`  Configured transport: ${transport.value} (${transport.source})`,
		`  When work finishes: ${completionLabel(status.completionDelivery)}`,
		`  Read-only consultation folders: ${consultationCwdLabel(runtime?.getConsultationCwdPolicy() ?? cwdPolicy.consultation.value)}`,
		`  Subagent folders: ${delegationCwdLabel(runtime?.getDelegationCwdPolicy() ?? cwdPolicy.delegation.value)}`,
		`  Read-only consultation resources: ${consultResourceLabel(runtime?.getConsultResourcePolicy() ?? consult.value)}`,
		`  Blocking worker limit: ${runtime?.getMaxParallelTasks() ?? parallelLimit.value} per request`,
		`  Background-agent limits: ${formatDetachedLimitSummary(status)}`,
		`  Subagents: ${status.activeAgents} working, ${status.retainedAgents} saved for follow-up`,
		`  Local usage recording: ${usageStatus?.enabled ? "enabled" : "disabled"}`,
		`  Recorded events this session: ${usageStatus?.recordedEvents ?? 0}`,
		`  Usage retention: ${usageStatus?.retentionDays ?? USAGE_RECORDING_RETENTION_DAYS} days`,
		`  Usage path: ${safeTerminalText(usageStatus?.path ?? "unavailable")}`,
		"User Settings",
		`  Workflow source: ${configuredWorkflow.source}`,
		`  Configured workflow: ${workflowLabel(configuredWorkflow.value)}`,
		`  Completion source: ${snapshot.source}`,
		`  Configured completion: ${completionLabel(snapshot.value)}`,
		`  Configured blocking worker limit: ${parallelLimit.value}`,
		`  Blocking worker limit source: ${parallelLimit.source}`,
		...(detachedLimits.values
			? STATEFUL_LIMIT_DEFINITIONS.map((definition) => {
					const configured = detachedLimits.values?.[definition.field];
					return `  Configured ${definition.label.toLowerCase()}: ${configured?.value} (${configured?.source})`;
				})
			: ["  Configured detached limits: unavailable"]),
		`  Configured consultation target: ${consultationCwdLabel(cwdPolicy.consultation.value)}`,
		`  Consultation target source: ${cwdPolicy.consultation.source}`,
		`  Configured delegation target: ${delegationCwdLabel(cwdPolicy.delegation.value)}`,
		`  Delegation target source: ${cwdPolicy.delegation.source}`,
		`  Configured consultation resources: ${consultResourceLabel(consult.value)}`,
		`  Consultation resource source: ${consult.source}`,
		`  Configured usage recording: ${usageRecording.enabled ? "enabled" : "disabled"}`,
		`  Usage recording source: ${usageRecording.source}`,
		`  Path: ${safeTerminalText(snapshot.path)}`,
		configuredWorkflow.error ||
		snapshot.error ||
		cwdPolicy.error ||
		parallelLimit.error ||
		detachedLimits.error ||
		transport.error ||
		usageRecording.error
			? `  Warning: ${safeTerminalText(configuredWorkflow.error ?? snapshot.error ?? cwdPolicy.error ?? parallelLimit.error ?? detachedLimits.error ?? transport.error ?? usageRecording.error ?? "invalid settings")}`
			: "  Warning: none",
		configuredWorkflow.value !== current
			? "The configured workflow differs from this session. Run /reload to apply it."
			: "Manual file changes require /reload.",
	].join("\n");
}

export function currentWorkflow(
	runtime: SubagentSettingsRuntime,
	status: StatefulSubagentRuntimeStatus,
): DelegationWorkflow {
	const blocking = runtime.getBlockingEnabled();
	if (blocking && status.enabled) return "all";
	if (status.enabled) return "async-only";
	if (blocking) return "blocking-only";
	return "disabled";
}

export function completionLabel(value: CompletionDelivery): string {
	return value === "auto-resume"
		? "Continue automatically when work finishes"
		: "Wait for my next message";
}

export function consultationCwdLabel(value: ConsultationCwdPolicy): string {
	return value === "current-workspace"
		? "This workspace only"
		: "Any folder · no project resources when untrusted";
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

export function consultResourceLabel(value: ConsultResourcePolicy): string {
	switch (value) {
		case "project-context":
			return "Project context only";
		case "none":
			return "No project resources";
		case "all":
			return "All trusted resources";
	}
}
