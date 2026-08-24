import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, SubagentThinkingLevel } from "./agents/types.js";
import { MAX_SUBAGENT_TIMEOUT_MS } from "./limits.js";
import { safeTerminalLine as safeTerminalText } from "./safe-text.js";
import { readSubagentSettings, updateAgentSettingsPatch } from "./settings.js";

export function executionAgentPickerScreen(agents: readonly AgentConfig[]) {
	const configured = readSubagentSettings()?.agents ?? {};
	return {
		kind: "actions" as const,
		title: "Model, Thinking, and Time Limit",
		lines: ["Choose a subagent. A specific request can override these starting values."],
		items: [
			...agents.map((agent) => {
				const value = configured[agent.name];
				return {
					id: agent.name,
					label: safeTerminalText(agent.name),
					description: safeTerminalText(
						`${agent.source} · model ${value?.model ?? agent.model ?? "default"} · thinking ${value?.thinkingLevel ?? agent.thinkingLevel ?? "default"} · time limit ${value?.timeoutMs ?? agent.timeoutMs ?? "default"}`,
					),
					action: "pick-execution-agent" as const,
				};
			}),
			{ id: "back", label: "Back", action: "back" as const },
		],
		hint: "back" as const,
	};
}

export function executionAgentScreen(agent: AgentConfig | undefined) {
	if (!agent) {
		return {
			kind: "actions" as const,
			title: "Model, Thinking, and Time Limit",
			lines: ["No subagent selected."],
			items: [{ id: "back", label: "Back", action: "back" as const }],
			hint: "back" as const,
		};
	}
	const configured = readSubagentSettings()?.agents?.[agent.name];
	return {
		kind: "actions" as const,
		title: `${safeTerminalText(agent.name)} defaults`,
		lines: [
			`Model: ${safeTerminalText(configured?.model ?? agent.model ?? "agent or Pi default")}`,
			`Thinking: ${configured?.thinkingLevel ?? agent.thinkingLevel ?? "agent or Pi default"}`,
			`Time limit: ${configured?.timeoutMs ?? agent.timeoutMs ?? "agent or Pi default"}`,
			"A specific subagent request can override these defaults.",
		],
		items: [
			{ id: "thinking", label: "Thinking level", to: "execution-thinking" as const },
			{ id: "model", label: "Model", to: "execution-model" as const },
			{ id: "timeout", label: "Time limit", to: "execution-timeout" as const },
			{
				id: "reset",
				label: "Use agent or Pi defaults",
				description: "Remove custom model, thinking, and time limit without changing tools",
				action: "reset-agent-execution" as const,
			},
			{ id: "back", label: "Back", action: "back" as const },
		],
		hint: "back" as const,
	};
}

export function executionThinkingScreen(agent: AgentConfig | undefined) {
	const configured = agent ? readSubagentSettings()?.agents?.[agent.name] : undefined;
	return {
		kind: "settings" as const,
		title: agent ? `${safeTerminalText(agent.name)} thinking` : "Agent thinking",
		items: agent
			? [
					{
						id: "thinking",
						label: "Default thinking level",
						description: "A specific subagent request can override this value.",
						currentValue:
							configured?.thinkingLevel ?? agent.thinkingLevel ?? "Use agent or Pi default",
						values: [
							"Use agent or Pi default",
							"off",
							"minimal",
							"low",
							"medium",
							"high",
							"xhigh",
							"max",
						],
						action: "set-agent-thinking" as const,
					},
				]
			: [],
		hint: "back" as const,
	};
}

export function executionModelScreen(agent: AgentConfig | undefined, ctx: ExtensionCommandContext) {
	const configured = agent ? readSubagentSettings()?.agents?.[agent.name] : undefined;
	const models = ctx.modelRegistry
		.getAvailable()
		.map((model) => `${model.provider}/${model.id}`)
		.sort((left, right) => left.localeCompare(right))
		.slice(0, 100);
	return {
		kind: "actions" as const,
		title: agent ? `${safeTerminalText(agent.name)} model` : "Agent model",
		lines: [
			`Current: ${safeTerminalText(configured?.model ?? agent?.model ?? "agent or Pi default")}`,
			"Choose an available model or enter a custom Pi model pattern.",
		],
		items: agent
			? [
					{
						id: "model:__inherited__",
						label: "Use agent or Pi default",
						description: "Remove the custom model setting",
						action: "set-agent-model" as const,
					},
					...models.map((model) => ({
						id: `model:${model}`,
						label: safeTerminalText(model),
						action: "set-agent-model" as const,
					})),
					{
						id: "custom",
						label: "Custom model pattern",
						description: "Enter provider/model, a model pattern, or an optional :thinking suffix",
						to: "execution-model-input" as const,
					},
					{ id: "back", label: "Back", action: "back" as const },
				]
			: [],
		hint: "back" as const,
	};
}

export function executionModelInputScreen(agent: AgentConfig | undefined) {
	const configured = agent ? readSubagentSettings()?.agents?.[agent.name] : undefined;
	return {
		kind: "input" as const,
		title: agent ? `${safeTerminalText(agent.name)} model` : "Agent model",
		lines: [
			`Current: ${safeTerminalText(configured?.model ?? agent?.model ?? "agent or Pi default")}`,
			"Enter a Pi CLI model pattern, including an optional :thinking suffix.",
			"Use agent or Pi defaults to remove this custom value.",
		],
		placeholder: "provider/model or model pattern",
		action: "set-agent-model" as const,
		hint: "back" as const,
	};
}

export function executionTimeoutInputScreen(agent: AgentConfig | undefined) {
	const configured = agent ? readSubagentSettings()?.agents?.[agent.name] : undefined;
	return {
		kind: "input" as const,
		title: agent ? `${safeTerminalText(agent.name)} time limit` : "Agent time limit",
		lines: [
			`Current: ${configured?.timeoutMs ?? agent?.timeoutMs ?? "agent or Pi default"}`,
			`Allowed: 1-${MAX_SUBAGENT_TIMEOUT_MS} milliseconds.`,
			"Use agent or Pi defaults to remove this custom value.",
		],
		placeholder: "Time limit in milliseconds",
		action: "set-agent-timeout" as const,
		hint: "back" as const,
	};
}

export function applyAgentThinking(
	agent: AgentConfig | undefined,
	value: string | undefined,
	ctx: ExtensionCommandContext,
) {
	if (!agent) return { kind: "rejected" as const };
	const thinkingLevel =
		value === "Use agent or Pi default" ? undefined : (value as SubagentThinkingLevel);
	if (
		thinkingLevel !== undefined &&
		!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinkingLevel)
	) {
		return { kind: "rejected" as const };
	}
	return saveAgentPatch(agent.name, { thinkingLevel }, ctx, "thinking level");
}

export function applyAgentModel(
	agent: AgentConfig | undefined,
	value: string | undefined,
	ctx: ExtensionCommandContext,
) {
	if (!agent) return { kind: "rejected" as const };
	if (value === undefined) return saveAgentPatch(agent.name, { model: undefined }, ctx, "model");
	const model = value.trim();
	if (!model || Buffer.byteLength(model, "utf8") > 1_024 || hasTerminalControl(model)) {
		ctx.ui.notify("Model must contain 1-1024 UTF-8 bytes on one line.", "warning");
		return { kind: "rejected" as const };
	}
	return saveAgentPatch(agent.name, { model }, ctx, "model");
}

export function applyAgentTimeout(
	agent: AgentConfig | undefined,
	value: string | undefined,
	ctx: ExtensionCommandContext,
) {
	if (!agent) return { kind: "rejected" as const };
	const normalized = value?.trim() ?? "";
	if (!/^\d+$/u.test(normalized)) {
		ctx.ui.notify("Time limit must be a whole number of milliseconds.", "warning");
		return { kind: "rejected" as const };
	}
	const timeoutMs = Number(normalized);
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_SUBAGENT_TIMEOUT_MS) {
		ctx.ui.notify(`Time limit must be between 1 and ${MAX_SUBAGENT_TIMEOUT_MS}.`, "warning");
		return { kind: "rejected" as const };
	}
	return saveAgentPatch(agent.name, { timeoutMs }, ctx, "timeout");
}

export function resetAgentExecution(agent: AgentConfig | undefined, ctx: ExtensionCommandContext) {
	if (!agent) return { kind: "rejected" as const };
	return saveAgentPatch(
		agent.name,
		{ model: undefined, thinkingLevel: undefined, timeoutMs: undefined },
		ctx,
		"execution defaults",
	);
}

function saveAgentPatch(
	name: string,
	patch: Parameters<typeof updateAgentSettingsPatch>[0][string],
	ctx: ExtensionCommandContext,
	label: string,
) {
	try {
		updateAgentSettingsPatch({ [name]: patch });
		ctx.ui.notify(`${safeTerminalText(name)} ${label} saved.`, "info");
		return { kind: "back" as const };
	} catch (error) {
		ctx.ui.notify(
			`${safeTerminalText(name)} ${label} was not saved: ${formatError(error)}`,
			"error",
		);
		return { kind: "rejected" as const };
	}
}

function hasTerminalControl(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
	});
}

function formatError(error: unknown): string {
	return safeTerminalText(error instanceof Error ? error.message : String(error));
}
