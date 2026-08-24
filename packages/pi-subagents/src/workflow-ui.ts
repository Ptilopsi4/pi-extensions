import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DelegationWorkflow } from "./settings/inspection.js";

export async function showWorkflowPreview(
	ctx: ExtensionCommandContext,
	current: DelegationWorkflow,
	next: DelegationWorkflow,
	requiresReload: boolean,
	signal: AbortSignal,
): Promise<boolean> {
	const changes = workflowEffects(current, next);
	return ctx.ui.confirm(
		requiresReload ? "Save how subagents run and reload?" : "Save how subagents run?",
		[
			`Current: ${workflowLabel(current)}`,
			`New: ${workflowLabel(next)}`,
			"",
			"Effect:",
			...(changes.length > 0 ? changes : ["Keep the current registered tools"]).map(
				(effect) => `- ${effect}`,
			),
			`- ${requiresReload ? "Reload the extension to apply this tool surface" : "No reload is needed because the active tools already match"}`,
		].join("\n"),
		{ signal },
	);
}

export function workflowLabel(value: DelegationWorkflow): string {
	switch (value) {
		case "all":
			return "Background and blocking methods";
		case "async-only":
			return "Keep Pi available";
		case "blocking-only":
			return "Wait for every subagent";
		case "disabled":
			return "Subagents disabled";
	}
}

function workflowEffects(current: DelegationWorkflow, next: DelegationWorkflow): string[] {
	const blockingEnabled = (value: DelegationWorkflow) =>
		value === "all" || value === "blocking-only";
	const asyncEnabled = (value: DelegationWorkflow) => value === "all" || value === "async-only";
	const awaitEnabled = (value: DelegationWorkflow) => blockingEnabled(value) && asyncEnabled(value);
	const effects: string[] = [];
	if (blockingEnabled(current) !== blockingEnabled(next)) {
		effects.push(
			blockingEnabled(next)
				? "Allow methods that make Pi wait: `subagent` and read-only `subagent_consult`"
				: "Remove methods that make Pi wait: `subagent` and read-only `subagent_consult`",
		);
	}
	if (asyncEnabled(current) !== asyncEnabled(next)) {
		effects.push(
			asyncEnabled(next)
				? "Allow background tools: `subagent_spawn`, `subagent_send`, `subagent_manage`, and `subagent_mailbox`"
				: "Remove background tools: `subagent_spawn`, `subagent_send`, `subagent_manage`, and `subagent_mailbox`",
		);
	}
	if (awaitEnabled(current) !== awaitEnabled(next)) {
		effects.push(
			awaitEnabled(next)
				? "Allow the blocking retained-agent join: `subagent_await`"
				: "Remove the blocking retained-agent join: `subagent_await`",
		);
	}
	return effects;
}
