import { MAX_TOOL_MESSAGE_BYTES, truncateUtf8 } from "./limits.js";
import type { ManagedAgent } from "./registry.js";

export function formatStatefulAgentLine(agent: ManagedAgent, now = Date.now()): string {
	const elapsedSeconds = Math.max(0, Math.floor((now - agent.updatedAt) / 1000));
	const task = agent.currentTask ? ` — ${sanitizeStatusLine(agent.currentTask, 80)}` : "";
	const unread = agent.mailbox.filter((message) => !message.readAt).length;
	const indent = "  ".repeat(agent.depth);
	return `${indent}${sanitizeStatusLine(agent.taskPath ?? agent.id, 256)} · ${sanitizeStatusLine(agent.agent, 128)} · ${agentStateLabel(agent.state)} · updated ${elapsedSeconds}s ago · ${unread} unread${task}`;
}

export function summarizeStatefulAgent(agent: ManagedAgent) {
	return {
		id: agent.id,
		taskName: agent.taskName,
		taskPath: agent.taskPath,
		agent: agent.agent,
		parentId: agent.parentId,
		rootId: agent.rootId,
		depth: agent.depth,
		children: [...agent.children],
		state: agent.state,
		createdAt: agent.createdAt,
		updatedAt: agent.updatedAt,
		cwd: agent.cwd,
		workspaceMode: agent.workspaceMode ?? "shared",
		thinkingLevel: agent.thinkingLevel,
		timeoutMs: agent.timeoutMs,
		currentTimeoutMs: agent.currentTimeoutMs,
		idleTimeoutMs: agent.idleTimeoutMs,
		currentIdleTimeoutMs: agent.currentIdleTimeoutMs,
		maxTurns: agent.maxTurns,
		currentMaxTurns: agent.currentMaxTurns,
		maxToolCalls: agent.maxToolCalls,
		currentMaxToolCalls: agent.currentMaxToolCalls,
		currentTask: agent.currentTask
			? truncateUtf8(agent.currentTask, MAX_TOOL_MESSAGE_BYTES).text
			: undefined,
		historyCount: agent.history.length,
		unreadMessages: agent.mailbox.filter((message) => !message.readAt).length,
		context: {
			turns: agent.contextTurns ?? 0,
			sources: agent.contextSourceIds?.length ?? 0,
			bytes: agent.contextBytes ?? 0,
			truncated: agent.contextTruncated === true,
		},
		resultFormat: agent.resultFormat ?? "text",
		completionRequirements: (agent.completionRequirements ?? []).map((record) => ({
			...record,
		})),
		structuredResult: agent.structuredResult,
		termination: agent.termination,
		outcome: agent.outcome,
		executionPlan: agent.executionPlan,
		capabilityGrant: agent.capabilityGrant,
		semanticCompatibility: agent.semanticCompatibility,
		semanticSnapshotDigest: agent.semanticSnapshot?.digest,
		telemetry: agent.telemetry,
		error: agent.error ? truncateUtf8(agent.error, MAX_TOOL_MESSAGE_BYTES).text : undefined,
		target: agent.target,
		policy: agent.policy,
	};
}

function agentStateLabel(state: ManagedAgent["state"]): string {
	switch (state) {
		case "running":
			return "working";
		case "completed":
			return "finished";
		default:
			return state;
	}
}

function sanitizeStatusLine(value: string, maxLength: number): string {
	return (
		value
			.slice(0, maxLength)
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Escape untrusted terminal controls.
			.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
			.replace(/\s+/gu, " ")
			.trim()
	);
}
