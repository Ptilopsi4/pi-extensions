import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import type { ChildRequest, ChildResult } from "../src/job-types.js";
import { SUBAGENT_WIDGET_KEY } from "../src/job-widget.js";
import subagents, { type SubagentsDependencies } from "../src/subagents-extension.js";

interface RegisteredTool {
	name: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: { properties?: Record<string, unknown>; additionalProperties?: boolean };
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
}

type Mock = ReturnType<typeof createMockPi>;
type Context = ReturnType<typeof createMockContext>;
const sessions: Array<{ mock: Mock; context: Context }> = [];

beforeEach(() => delete process.env.PI_SUBAGENT_DEPTH);
afterEach(async () => {
	for (const { mock, context } of sessions.splice(0)) {
		await emit(mock, "session_shutdown", { reason: "quit" }, context.ctx);
	}
	delete process.env.PI_SUBAGENT_DEPTH;
});

test("registers exactly four fixed bounded tools in contract order", async () => {
	const { mock, context } = await setup();
	const tools = mock.tools as unknown as RegisteredTool[];
	assert.deepEqual(
		tools.map((candidate) => candidate.name),
		["subagent_spawn", "subagent_await", "subagent_cancel", "subagent_inspect"],
	);
	assert.deepEqual(Object.keys(tools[0]?.parameters.properties ?? {}), [
		"task",
		"tools",
		"thinkingLevel",
		"timeout",
	]);
	assert.deepEqual(Object.keys(tools[1]?.parameters.properties ?? {}), ["jobId", "timeout"]);
	assert.deepEqual(Object.keys(tools[2]?.parameters.properties ?? {}), ["jobId"]);
	assert.deepEqual(Object.keys(tools[3]?.parameters.properties ?? {}), []);
	assert.ok(tools.every((candidate) => candidate.parameters.additionalProperties === false));
	assert.deepEqual([...mock.commands.keys()], ["subagents"]);
	assert.deepEqual(mock.commands.get("subagents")?.getArgumentCompletions?.("s"), [
		{ value: "status", label: "status", description: "Show bounded current-session job status" },
	]);
	assert.equal(mock.messageRenderers.size, 0);
	assert.equal(context.widgets.has(SUBAGENT_WIDGET_KEY), false);
	assert.deepEqual([...mock.events.keys()].sort(), ["session_shutdown", "session_start"]);
	await tool(mock, "subagent_inspect").execute("inspect", {}, undefined, undefined, context.ctx);
});

test("spawn normalizes tools, inherits runtime choices, and rejects invalid input before launch", async () => {
	const requests: ChildRequest[] = [];
	const { mock, context } = await setup(
		{
			runChild: async (request) => {
				requests.push(request);
				return completed("done");
			},
		},
		{ thinkingLevel: "high" },
	);
	const spawn = tool(mock, "subagent_spawn");
	const defaults = await spawn.execute(
		"default",
		{ task: "Review" },
		undefined,
		undefined,
		context.ctx,
	);
	const empty = await spawn.execute(
		"empty",
		{ task: "Think", tools: [] },
		undefined,
		undefined,
		context.ctx,
	);
	const explicit = await spawn.execute(
		"explicit",
		{ task: "Edit", tools: ["read", "edit", "read", "write"], thinkingLevel: "low" },
		undefined,
		undefined,
		context.ctx,
	);
	await Promise.all([
		awaitJob(mock, context, String(defaults.details.jobId)),
		awaitJob(mock, context, String(empty.details.jobId)),
		awaitJob(mock, context, String(explicit.details.jobId)),
	]);
	assert.deepEqual(
		requests.map(({ tools, model, thinkingLevel, projectTrusted }) => ({
			tools,
			model,
			thinkingLevel,
			projectTrusted,
		})),
		[
			{
				tools: ["read", "grep", "find", "ls"],
				model: "test/test-model",
				thinkingLevel: "medium",
				projectTrusted: false,
			},
			{ tools: [], model: "test/test-model", thinkingLevel: "medium", projectTrusted: false },
			{
				tools: ["read", "edit", "write"],
				model: "test/test-model",
				thinkingLevel: "low",
				projectTrusted: false,
			},
		],
	);
	const invalid = [
		{ task: "" },
		{ task: "bad\0task" },
		{ task: "bad", tools: ["extension_tool"] },
		{ task: "bad", timeout: Number.POSITIVE_INFINITY },
		{ task: "bad", unknown: true },
	];
	for (const params of invalid) {
		await assert.rejects(() => spawn.execute("invalid", params, undefined, undefined, context.ctx));
	}
	process.env.PI_SUBAGENT_DEPTH = "1";
	await assert.rejects(
		() => spawn.execute("nested", { task: "nested" }, undefined, undefined, context.ctx),
		/Nested subagents/u,
	);
	assert.equal(requests.length, 3);
});

test("spawn rejects parent-only providers and process-local credentials before admission", async () => {
	for (const [registry, expected] of [
		[
			{
				getRegisteredProviderIds: () => ["test"],
				getProviderAuthStatus: () => ({ configured: true, source: "environment" as const }),
			},
			/disable parent extensions/u,
		],
		[
			{
				getRegisteredProviderIds: () => [],
				getProviderAuthStatus: () => ({ configured: true, source: "runtime" as const }),
			},
			/process-local runtime API key/u,
		],
	] as const) {
		let launches = 0;
		const { mock, context } = await setup(
			{
				runChild: async () => {
					launches += 1;
					return completed("unexpected");
				},
			},
			{},
			{ modelRegistry: registry },
		);
		await assert.rejects(() => spawnJob(mock, context, "Reject"), expected);
		assert.equal(launches, 0);
	}
});

test("completion delivery is bounded, sanitized, non-waking, and attempted once", async () => {
	const raw = `done\u001b[31m\u202e${"x".repeat(50 * 1024)}`;
	const { mock, context } = await setup({ runChild: async () => completed(raw) });
	const spawned = await spawnJob(mock, context, "Report");
	const waited = await awaitJob(mock, context, String(spawned.details.jobId));
	assert.ok(Buffer.byteLength(String(waited.details.result), "utf8") <= 32 * 1024);
	assert.equal(String(waited.details.result).includes("\u001b[31m\u202e"), true);
	assert.equal(mock.sentMessages.length, 1);
	const delivery = mock.sentMessages[0];
	assert.deepEqual(delivery?.options, { deliverAs: "steer", triggerTurn: false });
	const content = String((delivery?.message as { content?: unknown } | undefined)?.content ?? "");
	assert.equal(content.includes("\u001b"), false);
	assert.equal(content.includes("\u202e"), false);
	assert.ok(Buffer.byteLength(content, "utf8") <= 40 * 1024);
	await awaitJob(mock, context, String(spawned.details.jobId));
	assert.equal(mock.sentMessages.length, 1);
});

test("completion remains awaitable after its one delivery attempt fails", async () => {
	const raw = "done\u001b[31m\u202e";
	const { mock, context } = await setup({ runChild: async () => completed(raw) });
	let throws = 1;
	const original = mock.rawPi.sendMessage;
	mock.rawPi.sendMessage = (message, options) => {
		if (throws-- > 0) throw new Error("delivery unavailable");
		original(message, options);
	};
	const spawned = await spawnJob(mock, context, "Report");
	const waited = await awaitJob(mock, context, String(spawned.details.jobId));
	assert.equal(waited.details.result, raw);
	assert.equal(waited.content[0]?.text.includes("\u001b"), false);
	assert.equal(mock.sentMessages.length, 0);
	assert.equal((await awaitJob(mock, context, String(spawned.details.jobId))).details.result, raw);
	assert.equal(mock.sentMessages.length, 0, "await must not retry completion delivery");
});

test("spawn, await timeout, and cancel compose through the extension factory", async () => {
	const { mock, context } = await setup({
		runChild: async (request) => {
			if (!request.signal.aborted) {
				await new Promise<void>((resolve) =>
					request.signal.addEventListener("abort", () => resolve(), { once: true }),
				);
			}
			return { state: "cancelled", error: "cancelled", limitations: [], truncated: false };
		},
	});
	const spawned = await spawnJob(mock, context, "Wait");
	const jobId = String(spawned.details.jobId);
	const timed = await tool(mock, "subagent_await").execute(
		"timed",
		{ jobId, timeout: 0.001 },
		undefined,
		undefined,
		context.ctx,
	);
	assert.equal(timed.details.timedOut, true);
	assert.equal(timed.details.state, "running");
	const cancelled = await tool(mock, "subagent_cancel").execute(
		"cancel",
		{ jobId },
		undefined,
		undefined,
		context.ctx,
	);
	assert.equal(cancelled.details.state, "cancelled");
	assert.equal((await awaitJob(mock, context, jobId)).details.state, "cancelled");
});

test("inspect and status omit private job inputs and outputs", async () => {
	const secretTask = "private task token";
	const secretOutput = "private output token";
	const { mock, context } = await setup({ runChild: async () => completed(secretOutput) });
	const spawned = await spawnJob(mock, context, secretTask);
	await awaitJob(mock, context, String(spawned.details.jobId));
	const inspected = await tool(mock, "subagent_inspect").execute(
		"inspect",
		{},
		undefined,
		undefined,
		context.ctx,
	);
	assert.doesNotMatch(
		JSON.stringify(inspected.details),
		/private task token|private output token|tools/u,
	);
	const command = mock.commands.get("subagents");
	assert.ok(command);
	await command.handler("status", context.ctx);
	assert.doesNotMatch(
		JSON.stringify(context.notifications),
		/private task token|private output token/u,
	);
});

test("command is observable only in TUI and RPC and rejects removed or trailing routes", async () => {
	for (const mode of ["tui", "rpc"] as const) {
		const { mock, context } = await setup({}, {}, { mode, hasUI: true });
		const command = mock.commands.get("subagents");
		assert.ok(command);
		await command.handler("", context.ctx);
		await command.handler("help", context.ctx);
		assert.equal(context.notifications.length, 2);
		await assert.rejects(
			() => Promise.resolve(command.handler("settings", context.ctx)),
			/Unknown/u,
		);
		await assert.rejects(
			() => Promise.resolve(command.handler("status extra", context.ctx)),
			/Unknown/u,
		);
	}
	for (const mode of ["print", "json"] as const) {
		const { mock, context } = await setup({}, {}, { mode, hasUI: false });
		await mock.commands.get("subagents")?.handler("status", context.ctx);
		assert.deepEqual(context.notifications, []);
	}
});

test("session replacement cancels old jobs and stale shutdown cannot close the replacement", async () => {
	const requests: ChildRequest[] = [];
	const { mock, context } = await setup({
		runChild: async (request) => {
			requests.push(request);
			if (!request.signal.aborted) {
				await new Promise<void>((resolve) =>
					request.signal.addEventListener("abort", () => resolve(), { once: true }),
				);
			}
			return { state: "cancelled", error: "cancelled", limitations: [], truncated: false };
		},
	});
	await spawnJob(mock, context, "old");
	await Promise.resolve();
	const replacement = createMockContext({
		model: { provider: "test", id: "test-model" },
		thinkingLevel: "medium",
		modelRegistry: modelRegistry(),
		sessionManager: { getSessionId: () => "replacement" },
	});
	await emit(mock, "session_start", { reason: "fork" }, replacement.ctx);
	assert.equal(requests[0]?.signal.aborted, true);
	await emit(mock, "session_shutdown", { reason: "replace" }, context.ctx);
	const next = await spawnJob(mock, replacement, "new");
	assert.equal(next.details.state, "queued");
	await emit(mock, "session_shutdown", { reason: "quit" }, replacement.ctx);
});

async function setup(
	dependencies: SubagentsDependencies = {},
	mockOptions: Parameters<typeof createMockPi>[0] = {},
	contextOverrides: Record<string, unknown> = {},
) {
	const mock = createMockPi(mockOptions);
	const context = createMockContext({
		model: { provider: "test", id: "test-model" },
		thinkingLevel: "medium",
		modelRegistry: modelRegistry(),
		...contextOverrides,
	});
	subagents(mock.pi, dependencies);
	await emit(mock, "session_start", { reason: "startup" }, context.ctx);
	sessions.push({ mock, context });
	return { mock, context };
}

function modelRegistry() {
	return {
		getRegisteredProviderIds: () => [],
		getProviderAuthStatus: () => ({ configured: true, source: "environment" as const }),
	};
}

async function emit(mock: Mock, event: string, payload: unknown, ctx: ExtensionContext) {
	for (const handler of mock.events.get(event) ?? []) await handler(payload, ctx);
}

function tool(mock: Mock, name: string): RegisteredTool {
	const registered = (mock.tools as unknown as RegisteredTool[]).find(
		(candidate) => candidate.name === name,
	);
	assert.ok(registered, `Missing tool ${name}`);
	return registered;
}

function spawnJob(mock: Mock, context: Context, task: string) {
	return tool(mock, "subagent_spawn").execute("spawn", { task }, undefined, undefined, context.ctx);
}

function awaitJob(mock: Mock, context: Context, jobId: string) {
	return tool(mock, "subagent_await").execute(
		"await",
		{ jobId },
		undefined,
		undefined,
		context.ctx,
	);
}

function completed(result: string): ChildResult {
	return { state: "completed", result, limitations: [], truncated: false };
}
