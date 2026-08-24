import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubagentTransportKind } from "./agents/types.js";
import { safeTerminalLine as safeTerminalText } from "./safe-text.js";
import { inspectStatefulTransportSettings, updateStatefulTransportSetting } from "./settings.js";
import type { StatefulSubagentRuntimeStatus } from "./stateful.js";

const TRANSPORT_OPTIONS: Array<{
	value: SubagentTransportKind;
	label: string;
	description: string;
}> = [
	{
		value: "subprocess",
		label: "Fresh process",
		description:
			"Start a separate Pi process for every turn. Most compatible, but slower for follow-ups.",
	},
	{
		value: "in-process",
		label: "Inside Pi",
		description:
			"Run built-in tools inside Pi for faster follow-ups. Shares Pi's memory and crash boundary.",
	},
	{
		value: "rpc",
		label: "Persistent process (RPC)",
		description:
			"Keep one separate Pi process per background subagent so follow-ups preserve history.",
	},
	{
		value: "auto",
		label: "Automatic · Recommended",
		description: "Let Pi choose a compatible method for each subagent and its tools.",
	},
];

export interface TransportUiRuntime {
	getRuntimeStatus(): StatefulSubagentRuntimeStatus;
}

export function transportSettingsScreen(runtime: TransportUiRuntime) {
	const configured = inspectStatefulTransportSettings();
	const current = runtime.getRuntimeStatus();
	return {
		kind: "actions" as const,
		title: configured.error
			? "Background Agent Transport · Read only"
			: "Background Agent Transport",
		lines: [
			"Advanced: choose how Pi hosts background subagents.",
			`Current session: ${transportLabel(current.transport)}`,
			`Configured after reload: ${transportLabel(configured.value)} (${configured.source})`,
			"Separate processes do not restrict filesystem or network access.",
			"Persistent process (RPC) supports built-in Pi tools and does not load child extensions.",
			...(configured.error
				? [
						`Settings cannot be edited: ${safeTerminalText(configured.error)}`,
						`Repair ${safeTerminalText(configured.path)} and retry.`,
					]
				: []),
		],
		items: [
			...(configured.error
				? []
				: TRANSPORT_OPTIONS.map((option) => ({
						id: option.value,
						label: option.label,
						description: option.description,
						action: "set-transport" as const,
					}))),
			{ id: "back", label: "Back", action: "back" as const },
		],
		hint: "back" as const,
	};
}

export async function applyTransportSetting(
	value: string,
	ctx: ExtensionCommandContext,
	runtime: TransportUiRuntime,
	signal: AbortSignal,
	isCurrent: () => boolean,
) {
	if (!isTransport(value)) return { kind: "rejected" as const };
	const before = inspectStatefulTransportSettings();
	if (before.error) return { kind: "rejected" as const };
	if (value === before.value) return { kind: "stay" as const };
	const status = runtime.getRuntimeStatus();
	if (status.retainedAgents > 0) {
		ctx.ui.notify(
			`Cannot change transport while ${status.retainedAgents} subagent${status.retainedAgents === 1 ? " is" : "s are"} saved for follow-up. Clear Current subagents first.`,
			"warning",
		);
		return { kind: "rejected" as const };
	}
	const option = TRANSPORT_OPTIONS.find((candidate) => candidate.value === value);
	const confirmed = await ctx.ui.confirm(
		`Use ${transportLabel(value)} after reload?`,
		`${option?.description ?? ""}\n\nThis saves the setting but does not reload Pi automatically.`,
		{ signal },
	);
	if (signal.aborted || !isCurrent()) return { kind: "close" as const };
	if (!confirmed) return { kind: "rejected" as const };
	const after = inspectStatefulTransportSettings();
	if (after.error || after.value !== before.value || after.source !== before.source) {
		ctx.ui.notify("Transport settings changed while confirming; review again.", "warning");
		return { kind: "rejected" as const };
	}
	if (runtime.getRuntimeStatus().retainedAgents > 0) {
		ctx.ui.notify(
			"New subagents were saved for follow-up while confirming. Clear them before changing transport.",
			"warning",
		);
		return { kind: "rejected" as const };
	}
	try {
		updateStatefulTransportSetting(value);
		ctx.ui.notify(`Saved ${transportLabel(value)}. Run /reload when ready.`, "info");
		return { kind: "stay" as const };
	} catch (error) {
		ctx.ui.notify(
			`Transport was not saved; the previous setting remains: ${safeTerminalText(error instanceof Error ? error.message : String(error))}`,
			"error",
		);
		return { kind: "rejected" as const };
	}
}

export function transportLabel(value: SubagentTransportKind): string {
	return TRANSPORT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function isTransport(value: string): value is SubagentTransportKind {
	return ["subprocess", "in-process", "rpc", "auto"].includes(value);
}
