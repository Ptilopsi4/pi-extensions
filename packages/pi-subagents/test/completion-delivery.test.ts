import assert from "node:assert/strict";
import { test } from "vitest";
import type { AgentTurnCompletion, ManagedAgent } from "../src/registry.js";
import { CompletionDeliveryBroker } from "../src/stateful.js";

function completion(id: string, output = `output:${id}`): AgentTurnCompletion {
	const agent: ManagedAgent = {
		id,
		agent: "explorer",
		rootId: id,
		depth: 0,
		children: [],
		state: "completed",
		createdAt: 1,
		updatedAt: 2,
		cwd: process.cwd(),
		history: [],
		mailbox: [],
	};
	return {
		agent,
		task: `task:${id}`,
		output,
		completionId: `completion:${id}:1`,
		runId: `run:${id}:1`,
		generation: 1,
		createdAt: 1,
	};
}

function deliveryHarness(options: { idle?: boolean; pending?: boolean } = {}) {
	const sent: Array<{ message: Record<string, unknown>; options: Record<string, unknown> }> = [];
	const pi = {
		sendMessage(message: Record<string, unknown>, messageOptions: Record<string, unknown>) {
			sent.push({ message, options: messageOptions });
		},
	};
	const ctx = {
		isIdle: () => options.idle ?? true,
		hasPendingMessages: () => options.pending ?? false,
	};
	return { pi, ctx, sent };
}

test("completion delivery acknowledges one deterministic timestamp when the parent consumes it", () => {
	const harness = deliveryHarness();
	const delivered: Array<{ ids: string[]; at: number }> = [];
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "next-turn", {
		now: () => 1234,
		onAcknowledged: (completions, at) => {
			delivered.push({ ids: completions.map((value) => value.agent.id), at });
		},
	});
	broker.enqueue(completion("sa_timed"));
	broker.flush();
	assert.deepEqual(delivered, []);
	broker.onParentTurnStart();
	assert.deepEqual(delivered, []);
	broker.onParentContext([
		{
			role: "custom",
			customType: "pi-subagent-completion",
			details: harness.sent[0]?.message.details,
		},
	]);
	assert.deepEqual(delivered, [{ ids: ["sa_timed"], at: 1234 }]);
	broker.close();
});

test("completion delivery reports accepted and failed send attempts", () => {
	const attempts: Array<{
		ids: string[];
		delivery: string;
		triggerTurn: boolean;
		outcome: string;
	}> = [];
	let sends = 0;
	const broker = new CompletionDeliveryBroker(
		{
			sendMessage() {
				sends += 1;
				if (sends === 1) throw new Error("primary failed");
			},
		} as never,
		{ isIdle: () => true, hasPendingMessages: () => false },
		"next-turn",
		{
			onDeliveryAttempt: (completions, input) => {
				attempts.push({
					ids: completions.map((value) => value.completionId),
					delivery: input.delivery,
					triggerTurn: input.triggerTurn,
					outcome: input.outcome,
				});
			},
		},
	);
	broker.enqueue(completion("sa_fallback"));
	broker.flush();
	assert.deepEqual(attempts, [
		{
			ids: ["completion:sa_fallback:1"],
			delivery: "steer",
			triggerTurn: false,
			outcome: "failed",
		},
		{
			ids: ["completion:sa_fallback:1"],
			delivery: "nextTurn",
			triggerTurn: false,
			outcome: "accepted",
		},
	]);
	broker.close();
});

test("an unobserved asynchronous injection remains pending for retry", () => {
	const harness = deliveryHarness();
	const acknowledged: string[] = [];
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "next-turn", {
		onAcknowledged: (completions) => {
			acknowledged.push(...completions.map((value) => value.completionId));
		},
	});
	broker.enqueue(completion("sa_async_failure"));
	broker.flush();

	broker.onParentTurnStart();
	broker.onParentContext([]);
	assert.deepEqual(acknowledged, []);
	broker.flush();
	assert.equal(harness.sent.length, 2);

	broker.onParentContext([
		{
			role: "custom",
			customType: "pi-subagent-completion",
			details: harness.sent[1]?.message.details,
		},
	]);
	assert.deepEqual(acknowledged, ["completion:sa_async_failure:1"]);
	broker.close();
});

test("next-turn completion delivery never wakes an idle root", () => {
	const harness = deliveryHarness();
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "next-turn");
	broker.enqueue(completion("sa_one"));
	broker.flush();

	assert.equal(harness.sent.length, 1);
	assert.deepEqual(harness.sent[0]?.options, { deliverAs: "steer" });
	assert.equal(harness.sent[0]?.message.customType, "pi-subagent-completion");
	assert.match(String(harness.sent[0]?.message.content), /Agent ID: sa_one/);
	assert.deepEqual(harness.sent[0]?.message.details, {
		protocol: "pi-subagents:v1",
		completionId: "completion:sa_one:1",
		runId: "run:sa_one:1",
		generation: 1,
		agentId: "sa_one",
		agent: "explorer",
		task: "task:sa_one",
		state: "completed",
	});
	broker.close();
});

test("active-turn next-turn delivery queues once for context acknowledgement", () => {
	const queuedSteering: Record<string, unknown>[] = [];
	const insertedImmediately: Record<string, unknown>[] = [];
	const acknowledged: string[] = [];
	const broker = new CompletionDeliveryBroker(
		{
			sendMessage(message: Record<string, unknown>, options?: { triggerTurn?: boolean }) {
				if (options?.triggerTurn !== false) queuedSteering.push(message);
				else insertedImmediately.push(message);
			},
		} as never,
		{ isIdle: () => false, hasPendingMessages: () => false },
		"next-turn",
		{
			onAcknowledged: (completions) => {
				acknowledged.push(...completions.map((value) => value.completionId));
			},
		},
	);
	broker.enqueue(completion("sa_streaming"));
	broker.flush();

	assert.equal(queuedSteering.length, 1);
	assert.equal(insertedImmediately.length, 0);
	broker.onParentContext([
		{
			role: "custom",
			customType: "pi-subagent-completion",
			details: queuedSteering[0]?.details,
		},
	]);
	broker.flush();

	assert.deepEqual(acknowledged, ["completion:sa_streaming:1"]);
	assert.equal(queuedSteering.length, 1);
	broker.close();
});

test("auto-resume batches simultaneous completions into one root synthesis turn", () => {
	const harness = deliveryHarness();
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "auto-resume");
	broker.enqueue(completion("sa_one"));
	broker.enqueue(completion("sa_two"));
	broker.flush();

	assert.equal(harness.sent.length, 1);
	assert.deepEqual(harness.sent[0]?.options, { deliverAs: "steer", triggerTurn: true });
	assert.match(String(harness.sent[0]?.message.content), /SUBAGENT_COMPLETION_BATCH/);
	assert.match(String(harness.sent[0]?.message.content), /Agent ID: sa_one/);
	assert.match(String(harness.sent[0]?.message.content), /Agent ID: sa_two/);
	assert.deepEqual(harness.sent[0]?.message.details, {
		completionCount: 2,
		completions: [
			{
				protocol: "pi-subagents:v1",
				completionId: "completion:sa_one:1",
				runId: "run:sa_one:1",
				generation: 1,
				agentId: "sa_one",
				agent: "explorer",
				task: "task:sa_one",
				state: "completed",
			},
			{
				protocol: "pi-subagents:v1",
				completionId: "completion:sa_two:1",
				runId: "run:sa_two:1",
				generation: 1,
				agentId: "sa_two",
				agent: "explorer",
				task: "task:sa_two",
				state: "completed",
			},
		],
	});
	broker.close();
});

test("completion delivery deduplicates the same completion identity", () => {
	const harness = deliveryHarness();
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "next-turn");
	const value = completion("sa_duplicate");
	broker.enqueue(value);
	broker.enqueue(value);
	broker.flush();

	assert.equal(harness.sent.length, 1);
	assert.match(
		String(harness.sent[0]?.message.content),
		/Completion ID: completion:sa_duplicate:1/,
	);
	broker.close();
});

test("completion timer coalesces a burst into one batched wake", async () => {
	const harness = deliveryHarness();
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "auto-resume");
	broker.enqueue(completion("sa_timer_one"));
	broker.enqueue(completion("sa_timer_two"));
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(harness.sent.length, 1);
	assert.match(String(harness.sent[0]?.message.content), /SUBAGENT_COMPLETION_BATCH/);
	assert.deepEqual(harness.sent[0]?.options, { deliverAs: "steer", triggerTurn: true });
	broker.close();
});

test("large completion bursts stay bounded and request only one synthesis turn", () => {
	const harness = deliveryHarness();
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "auto-resume");
	for (let index = 0; index < 17; index++) broker.enqueue(completion(`sa_${index}`));
	broker.flush();

	assert.equal(harness.sent.length, 2);
	assert.deepEqual(
		harness.sent.map((entry) => entry.options),
		[{ deliverAs: "steer" }, { deliverAs: "steer", triggerTurn: true }],
	);
	assert.ok(Buffer.byteLength(String(harness.sent[0]?.message.content), "utf8") <= 50 * 1024);
	broker.close();
});

test("auto-resume allows only one in-flight wake until the parent starts", () => {
	const harness = deliveryHarness();
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "auto-resume");
	broker.enqueue(completion("sa_first"));
	broker.flush();
	broker.enqueue(completion("sa_second"));
	broker.flush();
	broker.onParentTurnStart();
	broker.enqueue(completion("sa_third"));
	broker.flush();

	assert.deepEqual(
		harness.sent.map((entry) => entry.options),
		[
			{ deliverAs: "steer", triggerTurn: true },
			{ deliverAs: "steer" },
			{ deliverAs: "steer", triggerTurn: true },
		],
	);
	broker.close();
});

test("auto-resume holds active-turn completions until settlement", () => {
	const options = { idle: false, pending: false };
	const harness = deliveryHarness(options);
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "auto-resume");
	broker.enqueue(completion("sa_active"));
	broker.flush();
	assert.equal(harness.sent.length, 0);

	options.idle = true;
	broker.onParentSettled();
	broker.flush();
	assert.deepEqual(harness.sent[0]?.options, { deliverAs: "steer", triggerTurn: true });
	broker.onParentSettled();
	broker.flush();
	assert.equal(harness.sent.length, 1);
	broker.close();
});

test("changing delivery policy flushes an active-root batch without waiting for settlement", () => {
	const harness = deliveryHarness({ idle: false });
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "auto-resume");
	broker.enqueue(completion("sa_policy"));
	broker.flush();
	assert.equal(harness.sent.length, 0);
	broker.setDelivery("next-turn");
	broker.flush();
	assert.deepEqual(harness.sent[0]?.options, { deliverAs: "steer" });
	broker.close();
});

test("auto-resume lets pending user input suppress its wake", () => {
	const harness = deliveryHarness({ idle: true, pending: true });
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "auto-resume");
	broker.enqueue(completion("sa_pending"));
	broker.flush();
	assert.deepEqual(harness.sent[0]?.options, { deliverAs: "steer" });
	broker.close();
});

test("a synchronous parent-start acknowledgement clears the pre-set wake latch", () => {
	const sent: Array<Record<string, unknown>> = [];
	let broker: CompletionDeliveryBroker;
	broker = new CompletionDeliveryBroker(
		{
			sendMessage(_message: unknown, options: Record<string, unknown>) {
				sent.push(options);
				broker.onParentTurnStart();
			},
		} as never,
		{ isIdle: () => true, hasPendingMessages: () => false },
		"auto-resume",
	);
	broker.enqueue(completion("sa_first"));
	broker.flush();
	broker.enqueue(completion("sa_second"));
	broker.flush();
	assert.deepEqual(sent, [
		{ deliverAs: "steer", triggerTurn: true },
		{ deliverAs: "steer", triggerTurn: true },
	]);
	broker.close();
});

test("a synchronous auto-resume delivery error falls back to the next user turn", () => {
	const sent: Array<Record<string, unknown>> = [];
	let attempts = 0;
	const broker = new CompletionDeliveryBroker(
		{
			sendMessage(_message: unknown, options: Record<string, unknown>) {
				attempts++;
				if (attempts === 1) throw new Error("wake rejected");
				sent.push(options);
			},
		} as never,
		{ isIdle: () => true, hasPendingMessages: () => false },
		"auto-resume",
	);
	broker.enqueue(completion("sa_fallback"));
	broker.flush();
	assert.deepEqual(sent, [{ deliverAs: "nextTurn", triggerTurn: false }]);
	broker.close();
});

test("double delivery failure retains the complete unsent suffix in order", () => {
	let failing = true;
	let attempts = 0;
	let errors = 0;
	const sent: Array<{ message: Record<string, unknown>; options: Record<string, unknown> }> = [];
	const broker = new CompletionDeliveryBroker(
		{
			sendMessage(message: Record<string, unknown>, options: Record<string, unknown>) {
				attempts++;
				if (failing) throw new Error("delivery rejected");
				sent.push({ message, options });
			},
		} as never,
		{ isIdle: () => true, hasPendingMessages: () => false },
		"auto-resume",
		{
			onDeliveryError: () => {
				errors++;
				throw new Error("observer failed");
			},
		},
	);
	for (let index = 0; index < 17; index++) broker.enqueue(completion(`sa_${index}`));
	broker.flush();
	assert.equal(attempts, 2);
	assert.equal(errors, 1);
	assert.equal(sent.length, 0);

	failing = false;
	broker.enqueue(completion("sa_17"));
	broker.flush();
	assert.equal(sent.length, 2);
	assert.match(String(sent[0]?.message.content), /Agent ID: sa_0/);
	assert.match(String(sent[1]?.message.content), /Agent ID: sa_16/);
	assert.match(String(sent[1]?.message.content), /Agent ID: sa_17/);
	assert.deepEqual(sent[1]?.options, { deliverAs: "steer", triggerTurn: true });
	broker.close();
});

test("closing a completion broker drops session-stale queued notifications", async () => {
	const harness = deliveryHarness();
	const broker = new CompletionDeliveryBroker(harness.pi as never, harness.ctx, "auto-resume");
	broker.enqueue(completion("sa_stale"));
	broker.close();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(harness.sent, []);
});
