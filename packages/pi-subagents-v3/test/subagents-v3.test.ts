import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { discoverAgents } from "../src/agents.js";
import { createBrokerClient } from "../src/child-communication-bridge.js";
import { MessageBroker } from "../src/message-broker.js";
import subagentsV3, { type SubagentsV3Dependencies } from "../src/subagents-v3.js";
import type { ChildRequest, ChildResult } from "../src/types.js";

interface RegisteredTool {
	name: string;
	description: string;
	parameters: {
		properties?: Record<string, { description?: string; maxLength?: number }>;
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

let agentDirectory: string;
let previousAgentDirectory: string | undefined;
const activeSessions: Array<{ mock: Mock; context: ReturnType<typeof createMockContext> }> = [];

beforeEach(() => {
	previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
	agentDirectory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-v3-agent-"));
	process.env.PI_CODING_AGENT_DIR = agentDirectory;
	delete process.env.PI_SUBAGENT_DEPTH;
});

afterEach(async () => {
	for (const session of activeSessions.splice(0)) {
		await emit(session.mock, "session_shutdown", { reason: "quit" }, session.context.ctx);
	}
	if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
	delete process.env.PI_SUBAGENT_DEPTH;
	rmSync(agentDirectory, { recursive: true, force: true });
});

test("registers six fixed main-agent tools with bounded stable schemas", async () => {
	const { mock, context } = await setup();
	const tools = mock.tools as unknown as RegisteredTool[];
	assert.deepEqual(
		tools.map((candidate) => candidate.name),
		[
			"subagent-start",
			"subagent-inspect",
			"subagent-cancel",
			"subagent-wait",
			"subagent-consult",
			"subagent-reply",
		],
	);
	assert.equal(tools[0]?.parameters.properties?.task?.maxLength, 50 * 1024);
	assert.equal(tools[5]?.parameters.properties?.message?.maxLength, 50 * 1024);
	assert.deepEqual(Object.keys(tools[1]?.parameters.properties ?? {}), []);
	assert.deepEqual(
		tools[0]?.prepareArguments?.({ agent: "worker", task: "old", timeoutMs: 1500 }),
		{ agent: "worker", task: "old", timeout: 1.5 },
	);
	assert.deepEqual(tools[3]?.prepareArguments?.({ jobId: "job_old", timeoutMs: 30_000 }), {
		jobId: "job_old",
		timeout: 30,
	});
	assert.match(tools[4]?.description ?? "", /asynchronous read-only/i);
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

test("starts normal and read-only jobs asynchronously with broker credentials", async () => {
	const requests: ChildRequest[] = [];
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const { mock, context } = await setup({
		runChild: async (request) => {
			requests.push(request);
			await pending;
			return completed("done");
		},
	});
	const started = await tool(mock, "subagent-start").execute(
		"start",
		{ agent: "worker", task: "Implement one thing", timeout: 1 },
		undefined,
		undefined,
		context.ctx,
	);
	const consulted = await tool(mock, "subagent-consult").execute(
		"consult",
		{ agent: "explorer", task: "Review one thing" },
		undefined,
		undefined,
		context.ctx,
	);
	assert.equal(started.details.state, "queued");
	assert.equal(consulted.details.state, "queued");
	await Promise.resolve();
	assert.deepEqual(
		requests.map((request) => request.mode),
		["normal", "read_only"],
	);
	for (const request of requests) {
		assert.equal(request.communication.host, "127.0.0.1");
		assert.ok(request.communication.port > 0);
		assert.match(request.communication.token, /^[a-f0-9]{64}$/u);
	}
	release();
	await Promise.all([
		tool(mock, "subagent-wait").execute(
			"wait-start",
			{ jobId: started.details.jobId },
			undefined,
			undefined,
			context.ctx,
		),
		tool(mock, "subagent-wait").execute(
			"wait-consult",
			{ jobId: consulted.details.jobId },
			undefined,
			undefined,
			context.ctx,
		),
	]);
});

test("delivers child questions, interrupts parent waits, and returns plain-text replies", async () => {
	let request!: ChildRequest;
	const { mock, context } = await setup({
		runChild: async (candidate) => {
			request = candidate;
			await new Promise<void>((resolve) =>
				candidate.signal.addEventListener("abort", () => resolve(), { once: true }),
			);
			return {
				state: "cancelled",
				error: "cancelled",
				limitations: [],
				truncated: false,
			};
		},
	});
	const started = await tool(mock, "subagent-start").execute(
		"start",
		{ agent: "worker", task: "Need one decision" },
		undefined,
		undefined,
		context.ctx,
	);
	await Promise.resolve();
	const parentWait = tool(mock, "subagent-wait").execute(
		"parent-wait",
		{ jobId: started.details.jobId },
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
	assert.deepEqual((await parentWait).details, {
		jobId: started.details.jobId,
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
	await tool(mock, "subagent-cancel").execute(
		"cancel",
		{ jobId: started.details.jobId },
		undefined,
		undefined,
		context.ctx,
	);
});

test("sanitizes terminal controls at child-output display boundaries", async () => {
	const raw = "reported\u001b[31m output";
	const { mock, context } = await setup({ runChild: async () => completed(raw) });
	const started = await tool(mock, "subagent-start").execute(
		"start",
		{ agent: "worker", task: "Report output" },
		undefined,
		undefined,
		context.ctx,
	);
	const waited = await tool(mock, "subagent-wait").execute(
		"wait",
		{ jobId: started.details.jobId },
		undefined,
		undefined,
		context.ctx,
	);
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
	const started = await tool(mock, "subagent-start").execute(
		"start",
		{ agent: "worker", task: "bounded task" },
		undefined,
		undefined,
		context.ctx,
	);
	const jobId = String(started.details.jobId);
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
	const cancelled = await tool(mock, "subagent-cancel").execute(
		"cancel",
		{ jobId },
		undefined,
		undefined,
		context.ctx,
	);
	assert.deepEqual(cancelled.details, { jobId, state: "cancelled" });
	resolveChild(completed("another stale completion"));
	await Promise.resolve();
	const terminal = await tool(mock, "subagent-wait").execute(
		"terminal",
		{ jobId },
		undefined,
		undefined,
		context.ctx,
	);
	assert.equal(terminal.details.state, "cancelled");
	assert.doesNotMatch(JSON.stringify(terminal.details), /stale completion/);
});

test("normal and read-only jobs share the eight-job capacity", async () => {
	const { mock, context } = await setup({
		runChild: async ({ signal }) => {
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true }),
			);
			return {
				state: "cancelled",
				error: "cancelled",
				limitations: [],
				truncated: false,
			};
		},
	});
	const jobIds: string[] = [];
	for (let index = 0; index < 8; index++) {
		const name = index % 2 === 0 ? "subagent-start" : "subagent-consult";
		const result = await tool(mock, name).execute(
			`job-${index}`,
			{ agent: "worker", task: `Job ${index}` },
			undefined,
			undefined,
			context.ctx,
		);
		jobIds.push(String(result.details.jobId));
	}
	await assert.rejects(
		() =>
			tool(mock, "subagent-start").execute(
				"ninth",
				{ agent: "worker", task: "Ninth" },
				undefined,
				undefined,
				context.ctx,
			),
		/limit reached \(8\)/i,
	);
	await Promise.all(
		jobIds.map((jobId) =>
			tool(mock, "subagent-cancel").execute(
				`cancel-${jobId}`,
				{ jobId },
				undefined,
				undefined,
				context.ctx,
			),
		),
	);
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
	assert.ok(Array.isArray(inspected.details.agents));
	for (const name of ["subagent-start", "subagent-consult"]) {
		await assert.rejects(
			() =>
				tool(mock, name).execute(
					name,
					{ agent: "worker", task: "must not launch" },
					undefined,
					undefined,
					context.ctx,
				),
			/messaging is unavailable.*synthetic bind failure/i,
		);
	}
	assert.equal(launched, false);
});

test("session replacement cancels old jobs and permits a clean new session", async () => {
	const requests: ChildRequest[] = [];
	const { mock, context } = await setup({
		runChild: async (request) => {
			requests.push(request);
			await new Promise<void>((resolve) =>
				request.signal.addEventListener("abort", () => resolve(), { once: true }),
			);
			return {
				state: "cancelled",
				error: "cancelled",
				limitations: [],
				truncated: false,
			};
		},
	});
	await tool(mock, "subagent-start").execute(
		"old",
		{ agent: "worker", task: "Old session" },
		undefined,
		undefined,
		context.ctx,
	);
	await Promise.resolve();
	const oldClient = createBrokerClient(requests[0]?.communication as ChildRequest["communication"]);
	await emit(mock, "session_start", { reason: "new" }, context.ctx);
	assert.equal(requests[0]?.signal.aborted, true);
	await assert.rejects(() => oldClient.ask("stale session", undefined));
	const next = await tool(mock, "subagent-start").execute(
		"new",
		{ agent: "worker", task: "New session" },
		undefined,
		undefined,
		context.ctx,
	);
	assert.equal(next.details.state, "queued");
});

test("trusted project agents override user agents and inspection hides private text", async () => {
	const userAgents = path.join(agentDirectory, "agents");
	mkdirSync(userAgents, { recursive: true });
	writeFileSync(
		path.join(userAgents, "reviewer.md"),
		"---\nname: reviewer\ndescription: User reviewer\ntools: read\n---\nUser prompt\n",
	);
	const project = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-v3-project-"));
	try {
		const projectAgents = path.join(project, ".pi", "agents");
		mkdirSync(projectAgents, { recursive: true });
		writeFileSync(
			path.join(projectAgents, "reviewer.md"),
			"---\nname: reviewer\ndescription: Project reviewer\ntools: read\n---\nSECRET PROJECT PROMPT\n",
		);
		const { mock } = await setup();
		const trustedContext = createMockContext({ cwd: project, isProjectTrusted: () => true });
		const inspected = await tool(mock, "subagent-inspect").execute(
			"inspect-project",
			{},
			undefined,
			undefined,
			trustedContext.ctx,
		);
		const projectReviewer = (inspected.details.agents as Array<Record<string, unknown>>).find(
			(candidate) => candidate.name === "reviewer",
		);
		assert.equal(projectReviewer?.source, "project");
		assert.equal(
			discoverAgents(project, true).agents.find((candidate) => candidate.name === "reviewer")
				?.source,
			"project",
		);
		assert.doesNotMatch(JSON.stringify(inspected.details), /SECRET PROJECT PROMPT/);
	} finally {
		rmSync(project, { recursive: true, force: true });
	}
});

async function setup(dependencies: SubagentsV3Dependencies = {}) {
	const mock = createMockPi();
	const context = createMockContext();
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

function completed(result: string): ChildResult {
	return { state: "completed", result, limitations: [], truncated: false };
}
