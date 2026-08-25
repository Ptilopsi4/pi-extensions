import assert from "node:assert/strict";
import {
	type ContextEvent,
	convertToLlm,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { afterAll, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import {
	beginCompletionRequirement,
	COMPLETION_REQUIREMENT_CONTEXT_TYPE,
	reconcileRequiredCompletionContext,
} from "../src/completion-requirement.js";
import {
	createSubagentSessionGuidance,
	reconcileSubagentSessionGuidance,
	registerSubagentSessionGuidance,
	SUBAGENT_GUIDANCE_CONTEXT_TYPE,
	SUBAGENT_GUIDANCE_VERSION,
	type SubagentSessionGuidanceSnapshot,
} from "../src/session-guidance-contract.js";
import { resolveStatefulLimits } from "../src/stateful-limits.js";
import subagents from "../src/subagents.js";
import { installSubagentsTestEnvironment } from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
afterAll(restoreTestEnvironment);

function sessionManagerFor(branch: SessionEntry[]) {
	return {
		getSessionId: () => "cache-contract-session",
		getSessionName: () => undefined,
		getBranch: () => branch,
		getEntries: () => branch,
	};
}

function userMessage(text: string): ContextEvent["messages"][number] {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: 0,
	};
}

function assistantMessage(text: string): ContextEvent["messages"][number] {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "cache-contract",
		model: "cache-contract",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

async function emit(
	mock: ReturnType<typeof createMockPi>,
	event: string,
	payload: unknown,
	ctx: ExtensionContext,
): Promise<void> {
	for (const handler of mock.events.get(event) ?? []) await handler(payload, ctx);
}

async function applyPromptBoundary(
	mock: ReturnType<typeof createMockPi>,
	messages: ContextEvent["messages"],
	ctx: ExtensionContext,
): Promise<ContextEvent["messages"]> {
	let current = messages;
	for (const handler of mock.events.get("before_agent_start") ?? []) {
		const result = (await handler(
			{ prompt: "continue", systemPrompt: "stable base system prompt" },
			ctx,
		)) as { message?: ContextEvent["messages"][number] } | undefined;
		if (result?.message) current = [...current, result.message];
	}
	for (const handler of mock.events.get("context") ?? []) {
		const result = (await handler({ messages: current }, ctx)) as
			| { messages?: ContextEvent["messages"] }
			| undefined;
		current = result?.messages ?? current;
	}
	return current;
}

function normalizedRequest(
	mock: ReturnType<typeof createMockPi>,
	messages: ContextEvent["messages"],
) {
	const activeToolNames = mock.rawPi.getActiveTools();
	const toolsByName = new Map(mock.tools.map((tool) => [String(tool.name), tool]));
	const tools = activeToolNames.map((name) => toolsByName.get(name));
	return {
		effectiveSystemGuidance: tools.flatMap((tool) => [
			...(typeof tool?.promptSnippet === "string" ? [tool.promptSnippet] : []),
			...(Array.isArray(tool?.promptGuidelines) ? tool.promptGuidelines : []),
		]),
		activeToolNames,
		toolDefinitions: tools.map((tool, index) => ({
			name: tool?.name ?? activeToolNames[index],
			description: tool?.description,
			parameters: tool?.parameters,
			constrainedSampling: tool?.constrainedSampling,
		})),
		messages: convertToLlm(messages),
	};
}

function guidanceSnapshot(): SubagentSessionGuidanceSnapshot {
	return {
		blockingEnabled: true,
		statefulEnabled: true,
		completionDelivery: "next-turn",
		blockingMaxParallelTasks: 8,
		statefulLimits: resolveStatefulLimits(),
		consultationCwdPolicy: "anywhere",
		delegationCwdPolicy: "trusted-targets",
		consultResourcePolicy: "project-context",
		agentCatalog: "Available agent definitions\n- explorer [source: built-in]",
	};
}

test("ordinary subagent requests keep system guidance and provider tool definitions stable", async () => {
	const branch: SessionEntry[] = [];
	const mock = createMockPi();
	subagents(mock.pi);
	mock.rawPi.setActiveTools(mock.tools.map((tool) => String(tool.name)));
	const context = createMockContext({ sessionManager: sessionManagerFor(branch) });
	const registrationsBeforeStart = mock.tools.length;
	await emit(mock, "session_start", { reason: "new" }, context.ctx);
	assert.equal(mock.tools.length, registrationsBeforeStart);

	const firstMessages = await applyPromptBoundary(mock, [userMessage("first")], context.ctx);
	const guidance = firstMessages.find(
		(message) => message.role === "custom" && message.customType === SUBAGENT_GUIDANCE_CONTEXT_TYPE,
	);
	assert.ok(guidance);
	branch.push({
		type: "message",
		id: "guidance",
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: guidance,
	} as SessionEntry);
	const first = normalizedRequest(mock, firstMessages);

	const secondMessages = await applyPromptBoundary(
		mock,
		[...firstMessages, assistantMessage("working"), userMessage("second")],
		context.ctx,
	);
	const second = normalizedRequest(mock, secondMessages);
	assert.deepEqual(second.effectiveSystemGuidance, first.effectiveSystemGuidance);
	assert.deepEqual(second.activeToolNames, first.activeToolNames);
	assert.deepEqual(second.toolDefinitions, first.toolDefinitions);
	assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);
	assert.equal(new Set(second.activeToolNames).size, second.activeToolNames.length);

	await emit(mock, "session_shutdown", { reason: "quit" }, context.ctx);
});

test("session guidance persists once, appends live changes, and rejects stale sessions", async () => {
	let snapshot = guidanceSnapshot();
	const branch: SessionEntry[] = [];
	const mock = createMockPi();
	const controller = registerSubagentSessionGuidance(
		mock.pi,
		() => snapshot,
		() => [],
	);
	const firstContext = createMockContext({ sessionManager: sessionManagerFor(branch) });
	await emit(mock, "session_start", { reason: "new" }, firstContext.ctx);
	const before = mock.events.get("before_agent_start")?.[0];
	const first = (await before?.({ prompt: "continue", systemPrompt: "base" }, firstContext.ctx)) as
		| { message?: ContextEvent["messages"][number] }
		| undefined;
	assert.equal(
		first?.message?.role === "custom" ? first.message.customType : undefined,
		SUBAGENT_GUIDANCE_CONTEXT_TYPE,
	);
	if (!first?.message) assert.fail("expected initial guidance contract");
	branch.push({
		type: "message",
		id: "guidance",
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: first.message,
	} as SessionEntry);
	assert.equal(
		await before?.({ prompt: "continue", systemPrompt: "base" }, firstContext.ctx),
		undefined,
	);

	snapshot = { ...snapshot, completionDelivery: "auto-resume" };
	controller.publish();
	controller.publish();
	assert.equal(mock.sentMessages.length, 1);
	assert.deepEqual(mock.sentMessages[0]?.options, {
		deliverAs: "nextTurn",
		triggerTurn: false,
	});
	assert.match(
		String((mock.sentMessages[0]?.message as { content?: unknown } | undefined)?.content),
		/"completionDelivery":"auto-resume"/u,
	);
	snapshot = { ...snapshot, completionDelivery: "next-turn" };
	controller.publish();
	assert.equal(mock.sentMessages.length, 2, "a rapid revert must append a superseding contract");

	const replacement = createMockContext();
	await emit(mock, "session_start", { reason: "fork" }, replacement.ctx);
	await emit(mock, "session_shutdown", { reason: "replace" }, firstContext.ctx);
	snapshot = { ...snapshot, blockingMaxParallelTasks: 3 };
	controller.publish();
	assert.equal(mock.sentMessages.length, 3, "stale shutdown must not clear the replacement owner");
	await emit(mock, "session_shutdown", { reason: "quit" }, replacement.ctx);
	controller.publish();
	assert.equal(mock.sentMessages.length, 3);

	const resumedMock = createMockPi();
	registerSubagentSessionGuidance(
		resumedMock.pi,
		() => guidanceSnapshot(),
		() => [],
	);
	const resumed = createMockContext({ sessionManager: sessionManagerFor(branch) });
	await emit(resumedMock, "session_start", { reason: "resume" }, resumed.ctx);
	assert.equal(
		await resumedMock.events.get("before_agent_start")?.[0]?.(
			{ prompt: "continue", systemPrompt: "base" },
			resumed.ctx,
		),
		undefined,
		"resume and reload must reuse an equivalent retained contract",
	);

	const retryMock = createMockPi();
	const retryController = registerSubagentSessionGuidance(
		retryMock.pi,
		() => guidanceSnapshot(),
		() => [],
	);
	const retryContext = createMockContext();
	await emit(retryMock, "session_start", { reason: "new" }, retryContext.ctx);
	retryMock.rawPi.sendMessage = () => {
		throw new Error("insertion unavailable");
	};
	retryController.publish();
	const retried = (await retryMock.events.get("before_agent_start")?.[0]?.(
		{ prompt: "continue", systemPrompt: "base" },
		retryContext.ctx,
	)) as { message?: { customType?: string } } | undefined;
	assert.equal(retried?.message?.customType, SUBAGENT_GUIDANCE_CONTEXT_TYPE);
});

test("compaction restores guidance and required completion at deterministic boundaries", () => {
	const snapshot = guidanceSnapshot();
	const requirement = beginCompletionRequirement(undefined, {
		runId: "run:required",
		generation: 1,
		createdAt: 10,
	})[0];
	const agent = {
		id: "sa_required",
		taskName: "required",
		taskPath: "/root/required",
		agent: "explorer",
		rootId: "sa_required",
		depth: 0,
		children: [],
		state: "running" as const,
		createdAt: 1,
		updatedAt: 2,
		cwd: process.cwd(),
		completionRequirements: [requirement],
		history: [],
		mailbox: [],
	};
	const summaries: ContextEvent["messages"] = [
		{
			role: "compactionSummary",
			summary: "Earlier work was compacted.",
			tokensBefore: 100,
			timestamp: 0,
		},
		{
			role: "branchSummary",
			summary: "Retained branch state.",
			fromId: "branch-start",
			timestamp: 0,
		},
	];
	const restore = (messages: ContextEvent["messages"]) =>
		reconcileRequiredCompletionContext(
			reconcileSubagentSessionGuidance(messages, snapshot),
			[agent],
			[SUBAGENT_GUIDANCE_CONTEXT_TYPE],
		);
	const firstMessages = restore([...summaries, userMessage("continue")]);
	assert.equal(
		firstMessages[2]?.role === "custom" ? firstMessages[2].customType : undefined,
		SUBAGENT_GUIDANCE_CONTEXT_TYPE,
	);
	assert.equal(
		firstMessages[3]?.role === "custom" ? firstMessages[3].customType : undefined,
		COMPLETION_REQUIREMENT_CONTEXT_TYPE,
	);
	assert.equal(restore(firstMessages), firstMessages);
	const staleVersion = firstMessages.map((message, index) =>
		index === 2 && message.role === "custom"
			? { ...message, details: { version: "pi-subagents:session-guidance:v0" } }
			: message,
	);
	const repairedVersion = restore(staleVersion);
	assert.deepEqual(repairedVersion[2]?.role === "custom" ? repairedVersion[2].details : undefined, {
		version: SUBAGENT_GUIDANCE_VERSION,
	});

	const first = convertToLlm(firstMessages);
	const secondMessages = restore([
		...summaries,
		userMessage("continue"),
		assistantMessage("working"),
		userMessage("continue again"),
	]);
	const second = convertToLlm(secondMessages);
	assert.deepEqual(second.slice(0, first.length), first);

	const changed = createSubagentSessionGuidance({
		...snapshot,
		completionDelivery: "auto-resume",
	});
	const transitioned = [...secondMessages, changed];
	assert.deepEqual(
		convertToLlm(transitioned).slice(0, second.length),
		second,
		"a settings transition appends instead of rewriting the earlier prefix",
	);
});
