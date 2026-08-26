import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgentCatalog, formatAgentCatalog } from "./agents/catalog.js";
import type { DelegationCwdPolicy, SubagentSettings } from "./agents/types.js";
import { renderCompletionMessage, SUBAGENT_COMPLETION_MESSAGE_TYPE } from "./completion-render.js";
import {
	type ConfigRegistrationDependencies,
	registerSubagentConfigCommand,
	registerSubagentConfigLifecycle,
} from "./config-registration.js";
import {
	type InspectRegistrationDependencies,
	registerSubagentInspect,
} from "./inspect-registration.js";
import {
	registerSubagentSessionGuidance,
	type SubagentSessionGuidanceSnapshot,
} from "./session-guidance-contract.js";
import {
	consumeSubagentSettingsNotice,
	DEFAULT_DELEGATION_CWD_POLICY,
	inspectSubagentSettings,
	readSubagentSettings,
} from "./settings-reader.js";
import { registerStatefulSubagents } from "./stateful-registration.js";
import type { SubagentTransport } from "./transport.js";
import {
	registerUsageRecording,
	type UsageRecordingDependencies,
	type UsageSurfaceArm,
} from "./usage-recording.js";
import { resolveUsageRecordingEnabled } from "./usage-recording-config.js";

export interface SubagentsDependencies {
	loadStatefulTransport?: () => Promise<SubagentTransport>;
	config?: ConfigRegistrationDependencies;
	inspect?: InspectRegistrationDependencies;
	usageRecording?: Partial<UsageRecordingDependencies>;
}

export default function (pi: ExtensionAPI, dependencies: SubagentsDependencies = {}) {
	pi.registerMessageRenderer(SUBAGENT_COMPLETION_MESSAGE_TYPE, renderCompletionMessage);
	const configOwner = registerSubagentConfigLifecycle(pi);
	const usageRecording = registerUsageRecording(pi, dependencies.usageRecording);
	const settings = readSubagentSettings();
	let currentSettings: SubagentSettings | undefined = settings;
	let currentCatalog = "";

	pi.on("session_start", async (event, ctx) => {
		const loadNotice = consumeSubagentSettingsNotice();
		const refreshedSettings = readSubagentSettings();
		const refreshedNotice = consumeSubagentSettingsNotice();
		if (!inspectSubagentSettings().error) currentSettings = refreshedSettings;
		const notice = [
			...new Set([loadNotice, refreshedNotice].filter((value) => value !== undefined)),
		].join("\n");
		if (notice) ctx.ui.notify(notice, "warning");

		currentCatalog = formatAgentCatalog(
			discoverAgentCatalog(ctx.cwd, ctx.isProjectTrusted(), currentSettings),
		).text;
		await usageRecording.startSession({
			enabled: resolveUsageRecordingEnabled(currentSettings?.usageRecording),
			surfaceArm: usageSurfaceArm(statefulRuntime.getRuntimeStatus().enabled),
			reason: event.reason,
			onWarning: (message) => {
				if (ctx.hasUI) ctx.ui.notify(message, "warning");
			},
		});
	});

	const statefulRuntime = registerStatefulSubagents(pi, {
		settings: settings?.stateful,
		getSettings: () => currentSettings,
		loadTransport: dependencies.loadStatefulTransport,
		usageRecording,
	});
	const getDelegationCwdPolicy = () =>
		currentSettings?.cwdPolicy?.delegation ?? DEFAULT_DELEGATION_CWD_POLICY;
	registerSubagentInspect(
		pi,
		{
			...statefulRuntime,
			getDelegationCwdPolicy,
			getUsageRecordingStatus: () => usageRecording.getStatus(),
		},
		dependencies.inspect,
	);
	const sessionGuidance = registerSubagentSessionGuidance(
		pi,
		(): SubagentSessionGuidanceSnapshot => {
			const runtimeStatus = statefulRuntime.getRuntimeStatus();
			return {
				statefulEnabled: runtimeStatus.enabled,
				completionDelivery: runtimeStatus.completionDelivery,
				statefulLimits: runtimeStatus.limits,
				delegationCwdPolicy: getDelegationCwdPolicy(),
				agentCatalog: currentCatalog,
			};
		},
		() => statefulRuntime.listAgents(),
	);
	registerSubagentConfigCommand(
		pi,
		{
			...statefulRuntime,
			setCompletionDelivery(value) {
				statefulRuntime.setCompletionDelivery(value);
				sessionGuidance.publish();
			},
			getDelegationCwdPolicy,
			getUsageRecordingEnabled: () => usageRecording.getStatus().enabled,
			getUsageRecordingStatus: () => usageRecording.getStatus(),
			setUsageRecordingEnabled: async (value: boolean) => {
				await usageRecording.setEnabled(value);
				currentSettings = {
					...(currentSettings ?? {}),
					usageRecording: { ...(currentSettings?.usageRecording ?? {}), enabled: value },
				};
			},
			setDelegationCwdPolicy(value: DelegationCwdPolicy) {
				currentSettings = {
					...(currentSettings ?? {}),
					cwdPolicy: { ...(currentSettings?.cwdPolicy ?? {}), delegation: value },
				};
				sessionGuidance.publish();
			},
		},
		configOwner,
		dependencies.config,
	);
	pi.on("session_shutdown", (event) => usageRecording.shutdown(event.reason));
}

function usageSurfaceArm(statefulEnabled: boolean): UsageSurfaceArm {
	return statefulEnabled ? "async-only" : "disabled";
}
