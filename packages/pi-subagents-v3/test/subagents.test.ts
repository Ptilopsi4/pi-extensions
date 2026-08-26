import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { createBrokerClient } from "../src/child-communication-bridge.js";
import { MessageBroker } from "../src/message-broker.js";
import subagentsV3, { type SubagentsV3Dependencies } from "../src/subagents.js";
import type { ChildRequest, ChildResult } from "../src/types.js";

interface RegisteredTool {
	name: string;
	description: string;
	parameters: {
		properties?: Record<
			string,
			{
				description?: string;
				maxLength?: number;
				maxItems?: number;
				enum?: string[];
			}
		>;
	};
	prepareArguments?: (args: unknown) => unknown;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: ((value: unknown) => void) | undefined,
		ctx: unknown,
	) => Promise<{
		content: Array<{ type: string; text: string }>;
		details: Record<string, unknown>;
	}>;
}

type Mock = ReturnType<typeof createMockPi>;
type Context = ReturnType<typeof createMockContext>;

const activeSessions: Array<{ mock: Mock; context: Context }> = [];

beforeEach(() => {
	delete process.env.PI_SUBAGENT_DEPTH;
});

afterEach(async () => {
	for (const session of activeSessions.splice(0)) {
		await emit(session.mock, "session_shutdown", { reason: "quit" }, session.context.ctx);
	}
	delete process.env.PI_SUBAGENT_DEPTH;
});

test("registers five fixed main-agent tools with bounded stable schemas", async () => {
	const { mock, context } = await setup();
	const tools = mock.tools as unknown as RegisteredTool[];
	assert.deepEqual(
		tools.map((candidate) => candidate.name),
		["subagent-spawn", "subagent-inspect", "subagent-cancel", "subagent-wait", "subagent-reply"],
	);
	assert.equal(tools[0]?.parameters.properties?.task?.maxLength, 50 * 1024);
	assert.equal(tools[0]?.parameters.properties?.tools?.maxItems, 64);
	assert.deepEqual(
		(tools[0]?.parameters.properties?.tools as { items?: { enum?: string[] } })?.items?.enum,
		["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"],
	);
	assert.deepEqual(tools[0]?.parameters.properties?.thinkingLevel?.enum, [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
	assert.equal(tools[4]?.parameters.properties?.message?.maxLength, 50 * 1024);
	assert.deepEqual(Object.keys(tools[1]?.parameters.properties ?? {}), []);
	assert.deepEqual(tools[0]?.prepareArguments?.({ task: "old", timeoutMs: 1_500 }), {
		task: "old",
		timeout: 1.5,
	});
	assert.deepEqual(tools[3]?.prepareArguments?.({ jobId: "job_old", timeoutMs: 30_000 }), {
		jobId: "job_old",
		timeout: 30,
	});
	assert.match(tools[0]?.description ?? "", /task defines.*selected tools define/is);
	assert.deepEqual([...mock.commands.keys()], []);
	const definitions = JSON.stringify(
		tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
	);
	await tool(mock, "subagent-inspect").execute("inspect", {}, undefined, undefined, context.ctx);
	assert.equal(
		JSON.stringify(
			tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
		),
		definitions,
	);
});

test("spawns jobs with default and explicit tools and thinking levels", async () => {
	const requests: ChildRequest[] = [];
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const { mock, context } = await setup(
		{
			runChild: async (request) => {
				requests.push(request);
				await pending;
				return completed("done");
			},
		},
		{ thinkingLevel: "medium" },
		{ thinkingLevel: "high" },
	);
	const inherited = await tool(mock, "subagent-spawn").execute(
		"inherited",
		{ task: "Review one thing", timeout: 1 },
		undefined,
		undefined,
		context.ctx,
	);
	const explicit = await tool(mock, "subagent-spawn").execute(
		"explicit",
		{
			task: "Implement one thing",
			tools: ["read", "edit", "read", "write"],
			thinkingLevel: "low",
		},
		undefined,
		undefined,
		context.ctx,
	);
	assert.equal(inherited.details.state, "queued");
	assert.equal(explicit.details.state, "queued");
	await Promise.resolve();
	assert.deepEqual(
		requests.map(({ tools, model, thinkingLevel }) => ({ tools, model, thinkingLevel })),
		[
			{
				tools: ["read", "grep", "find", "ls"],
				model: "test-provider/test-model",
				thinkingLevel: "high",
			},
			{
				tools: ["read", "edit", "write"],
				model: "test-provider/test-model",
				thinkingLevel: "low",
			},
		],
	);
	for (const request of requests) {
		assert.equal(request.communication.host, "127.0.0.1");
		assert.ok(request.communication.port > 0);
		assert.match(request.communication.token, /^[a-f0-9]{64}$/u);
	}
	release();
	await Promise.all([
		waitFor(mock, context, String(inherited.details.jobId)),
		waitFor(mock, context, String(explicit.details.jobId)),
	]);
});

test("falls back to the Pi thinking level when context has none", async () => {
	let request!: ChildRequest;
	const { mock, context } = await setup(
		{
			runChild: async (candidate) => {
				request = candidate;
				return completed("done");
			},
		},
		{ thinkingLevel: "xhigh" },
	);
	const spawned = await tool(mock, "subagent-spawn").execute(
		"spawn",
		{ task: "Reason carefully", tools: [] },
		undefined,
		undefined,
		context.ctx,
	);
	await waitFor(mock, context, String(spawned.details.jobId));
	assert.equal(request.thinkingLevel, "xhigh");
	assert.deepEqual(request.tools, []);
});

test("rejects invalid spawn arguments and nesting before child launch", async () => {
	let launches = 0;
	const { mock, context } = await setup({
		runChild: async () => {
			launches++;
			return completed("unexpected");
		},
	});
	const spawn = tool(mock, "subagent-spawn");
	for (const params of [
		{ task: "bad tools", tools: "read" },
		{ task: "bad item", tools: [1] },
		{ task: "too many", tools: Array.from({ length: 65 }, (_, index) => `tool_${index}`) },
		{ task: "bad name", tools: ["read,bash"] },
		{ task: "typo", tools: ["baash"] },
		{ task: "extension tool", tools: ["subagent-spawn"] },
		{ task: "bad thinking", thinkingLevel: "turbo" },
		{ task: "bad timeout", timeout: 0 },
	]) {
		await assert.rejects(() => spawn.execute("invalid", params, undefined, undefined, context.ctx));
	}
	process.env.PI_SUBAGENT_DEPTH = "1";
	await assert.rejects(
		() => spawn.execute("nested", { task: "nested" }, undefined, undefined, context.ctx),
		/nested subagents/i,
	);
	delete process.env.PI_SUBAGENT_DEPTH;
	const missingModelContext = createMockContext({ model: undefined });
	await assert.rejects(
		() =>
			spawn.execute(
				"missing-model",
				{ task: "missing model" },
				undefined,
				undefined,
				missingModelContext.ctx,
			),
		/no main-agent model is selected/i,
	);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		() =>
			spawn.execute("cancelled", { task: "cancelled" }, controller.signal, undefined, context.ctx),
		(error: Error) => error.name === "AbortError",
	);
	assert.equal(launches, 0);
});

test("rejects parent-only model providers and credentials before child launch", async () => {
	for (const [modelRegistry, expected] of [
		[
			{
				getProviderAuthStatus: () => ({ configured: true, source: "runtime" as const }),
				getRegisteredProviderIds: () => [],
			},
			/process-local runtime API key/i,
		],
		[
			{
				getProviderAuthStatus: () => ({ configured: true, source: "stored" as const }),
				getRegisteredProviderIds: () => ["test-provider"],
			},
			/children disable parent extensions/i,
		],
	] as const) {
		let launches = 0;
		const { mock, context } = await setup(
			{
				runChild: async () => {
					launches++;
					return completed("unexpected");
				},
			},
			{},
			{ modelRegistry },
		);
		await assert.rejects(() => spawnJob(mock, context, "must not launch"), expected);
		assert.equal(launches, 0);
	}
});

test("delivers child questions, interrupts parent waits, and returns plain-text replies", async () => {
	let request!: ChildRequest;
	const { mock, context } = await setup({
		runChild: async (candidate) => {
			request = candidate;
			await new Promise<void>((resolve) =>
				candidate.signal.addEventListener("abort", () => resolve(), { once: true }),
			);
			return cancelled();
		},
	});
	const spawned = await spawnJob(mock, context, "Need one decision");
	await Promise.resolve();
	const parentWait = tool(mock, "subagent-wait").execute(
		"parent-wait",
		{ jobId: spawned.details.jobId },
		undefined,
		undefined,
		context.ctx,
	);
	const client = createBrokerClient(request.communication);
	const questionText = "May I use option A?\u001b[31m";
	const requestId = await client.ask(questionText, undefined);
	const inspected = await tool(mock, "subagent-inspect").execute(
		"inspect-pending",
		{},
		undefined,
		undefined,
		context.ctx,
	);
	assert.doesNotMatch(
		JSON.stringify(inspected.details),
		new RegExp(`${request.communication.token}|May I use option A`, "u"),
	);
	assert.equal(Object.hasOwn(inspected.details, "agents"), false);
	assert.deepEqual((await parentWait).details, {
		jobId: spawned.details.jobId,
		state: "running",
		timedOut: false,
		interrupted: true,
		reason: "subagent_message",
	});
	const delivery = mock.sentMessages.find(
		(entry) => (entry.message as { customType?: string }).customType === "pi-subagents-v3-question",
	);
	assert.ok(delivery);
	assert.deepEqual(delivery.options, { deliverAs: "steer", triggerTurn: true });
	const content = (delivery.message as { content: string }).content;
	assert.match(content, /not the user/i);
	assert.match(content, /cannot authorize writes, shell commands/i);
	assert.doesNotMatch(content, /Execution mode:|Agent:/u);
	assert.equal(content.includes(String.fromCharCode(27)), false);

	const childWait = client.wait(requestId, undefined, undefined);
	const replied = await tool(mock, "subagent-reply").execute(
		"reply",
		{ requestId, message: "Use option A." },
		undefined,
		undefined,
		context.ctx,
	);
	assert.deepEqual(replied.details, { requestId, accepted: true, duplicate: false });
	assert.equal(await childWait, "Use option A.");
	assert.deepEqual(
		(
			await tool(mock, "subagent-reply").execute(
				"duplicate",
				{ requestId, message: "Replacement" },
				undefined,
				undefined,
				context.ctx,
			)
		).details,
		{ requestId, accepted: false, duplicate: true },
	);
	await cancelJob(mock, context, String(spawned.details.jobId));
});

test("sanitizes terminal controls at child-output display boundaries", async () => {
	const raw = "reported\u001b[31m output";
	const { mock, context } = await setup({ runChild: async () => completed(raw) });
	const spawned = await spawnJob(mock, context, "Report output");
	const waited = await waitFor(mock, context, String(spawned.details.jobId));
	assert.equal(waited.details.result, raw);
	assert.equal(waited.content[0]?.text.includes(String.fromCharCode(27)), false);
	const completion = mock.sentMessages.find(
		(entry) =>
			(entry.message as { customType?: string }).customType === "pi-subagents-v3-completion",
	);
	assert.ok(completion);
	assert.equal(
		(completion.message as { content: string }).content.includes(String.fromCharCode(27)),
		false,
	);
});

test("wait timeout leaves a job active and cancellation rejects stale output", async () => {
	let resolveChild!: (result: ChildResult) => void;
	const { mock, context } = await setup({
		runChild: ({ signal }) =>
			new Promise<ChildResult>((resolve) => {
				resolveChild = resolve;
				signal.addEventListener("abort", () => resolve(completed("stale completion")), {
					once: true,
				});
			}),
	});
	const spawned = await spawnJob(mock, context, "bounded task");
	const jobId = String(spawned.details.jobId);
	await Promise.resolve();
	assert.deepEqual(
		(
			await tool(mock, "subagent-wait").execute(
				"wait",
				{ jobId, timeout: 0.001 },
				undefined,
				undefined,
				context.ctx,
			)
		).details,
		{ jobId, state: "running", timedOut: true },
	);
	assert.deepEqual((await cancelJob(mock, context, jobId)).details, {
		jobId,
		state: "cancelled",
	});
	resolveChild(completed("another stale completion"));
	await Promise.resolve();
	const terminal = await waitFor(mock, context, jobId);
	assert.equal(terminal.details.state, "cancelled");
	assert.doesNotMatch(JSON.stringify(terminal.details), /stale completion/);
});

test("jobs share the eight-job capacity", async () => {
	const { mock, context } = await setup({ runChild: waitForCancellation });
	const jobIds: string[] = [];
	for (let index = 0; index < 8; index++) {
		const result = await spawnJob(mock, context, `Job ${index}`);
		jobIds.push(String(result.details.jobId));
	}
	await assert.rejects(() => spawnJob(mock, context, "Ninth"), /limit reached \(8\)/i);
	await Promise.all(jobIds.map((jobId) => cancelJob(mock, context, jobId)));
});

test("broker startup failure leaves inspect available and prevents child launch", async () => {
	let launched = false;
	const { mock, context } = await setup({
		runChild: async () => {
			launched = true;
			return completed("unexpected");
		},
		createBroker: (onQuestion) =>
			new MessageBroker({
				onQuestion,
				createServer: () => {
					throw new Error("synthetic bind failure");
				},
			}),
	});
	const inspected = await tool(mock, "subagent-inspect").execute(
		"inspect",
		{},
		undefined,
		undefined,
		context.ctx,
	);
	assert.deepEqual(inspected.details, { jobs: [], omitted: { jobs: 0 } });
	await assert.rejects(
		() => spawnJob(mock, context, "must not launch"),
		/messaging is unavailable.*synthetic bind failure/i,
	);
	assert.equal(launched, false);
});

test("session replacement cancels old jobs and permits a clean new session", async () => {
	const requests: ChildRequest[] = [];
	const { mock, context } = await setup({
		runChild: async (request) => {
			requests.push(request);
			return waitForCancellation(request);
		},
	});
	await spawnJob(mock, context, "Old session");
	await Promise.resolve();
	const oldClient = createBrokerClient(requests[0]?.communication as ChildRequest["communication"]);
	await emit(mock, "session_start", { reason: "new" }, context.ctx);
	assert.equal(requests[0]?.signal.aborted, true);
	await assert.rejects(() => oldClient.ask("stale session", undefined));
	const next = await spawnJob(mock, context, "New session");
	assert.equal(next.details.state, "queued");
});

async function setup(
	dependencies: SubagentsV3Dependencies = {},
	mockOptions: Parameters<typeof createMockPi>[0] = {},
	contextOverrides: Record<string, unknown> = {},
) {
	const mock = createMockPi(mockOptions);
	const context = createMockContext({
		model: { provider: "test-provider", id: "test-model" },
		modelRegistry: {
			getProviderAuthStatus: () => ({ configured: true, source: "environment" as const }),
			getRegisteredProviderIds: () => [],
		},
		...contextOverrides,
	});
	subagentsV3(mock.pi, dependencies);
	await emit(mock, "session_start", { reason: "startup" }, context.ctx);
	activeSessions.push({ mock, context });
	return { mock, context };
}

async function emit(mock: Mock, event: string, payload: unknown, context: unknown): Promise<void> {
	for (const handler of mock.events.get(event) ?? []) await handler(payload, context);
}

function tool(mock: Mock, name: string): RegisteredTool {
	const registered = (mock.tools as unknown as RegisteredTool[]).find(
		(candidate) => candidate.name === name,
	);
	assert.ok(registered, `Missing tool ${name}`);
	return registered;
}

function spawnJob(mock: Mock, context: Context, task: string) {
	return tool(mock, "subagent-spawn").execute("spawn", { task }, undefined, undefined, context.ctx);
}

function waitFor(mock: Mock, context: Context, jobId: string) {
	return tool(mock, "subagent-wait").execute("wait", { jobId }, undefined, undefined, context.ctx);
}

function cancelJob(mock: Mock, context: Context, jobId: string) {
	return tool(mock, "subagent-cancel").execute(
		"cancel",
		{ jobId },
		undefined,
		undefined,
		context.ctx,
	);
}

async function waitForCancellation(request: Pick<ChildRequest, "signal">): Promise<ChildResult> {
	await new Promise<void>((resolve) =>
		request.signal.addEventListener("abort", () => resolve(), { once: true }),
	);
	return cancelled();
}

function completed(result: string): ChildResult {
	return { state: "completed", result, limitations: [], truncated: false };
}

function cancelled(): ChildResult {
	return {
		state: "cancelled",
		error: "cancelled",
		limitations: [],
		truncated: false,
	};
}
