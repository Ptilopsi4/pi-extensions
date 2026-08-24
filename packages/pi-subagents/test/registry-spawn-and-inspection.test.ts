import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { AgentRegistry } from "../src/registry.js";
import { hashSpawnRequest } from "../src/spawn-idempotency.js";

test("spawn idempotency includes retained execution budgets", () => {
	const request = {
		agent: "explorer",
		task: "inspect",
		cwd: process.cwd(),
		agentScope: "user" as const,
		thinkingLevel: "low" as const,
		timeoutMs: 1_000,
		contextSourceIds: [],
		workspaceMode: "shared" as const,
		allowConcurrentWrites: false,
		resultFormat: "text" as const,
	};
	assert.notEqual(hashSpawnRequest(request), hashSpawnRequest({ ...request, timeoutMs: 2_000 }));
	assert.notEqual(hashSpawnRequest(request), hashSpawnRequest({ ...request, idleTimeoutMs: 500 }));
	assert.notEqual(hashSpawnRequest(request), hashSpawnRequest({ ...request, maxTurns: 3 }));
	assert.notEqual(hashSpawnRequest(request), hashSpawnRequest({ ...request, maxToolCalls: 4 }));
	assert.notEqual(
		hashSpawnRequest(request),
		hashSpawnRequest({ ...request, completionRequirement: "required" }),
	);
	assert.equal(
		hashSpawnRequest(request),
		hashSpawnRequest({ ...request, completionRequirement: "background" }),
	);
	assert.notEqual(
		hashSpawnRequest(request),
		hashSpawnRequest({ ...request, taskName: "research" }),
	);
	const { timeoutMs: _omitted, ...withoutTimeout } = request;
	const legacyHash = createHash("sha256")
		.update(
			JSON.stringify({
				agent: withoutTimeout.agent,
				task: withoutTimeout.task,
				cwd: withoutTimeout.cwd,
				agentScope: withoutTimeout.agentScope,
				thinkingLevel: withoutTimeout.thinkingLevel,
				parentId: null,
				contextHash: null,
				contextSourceIds: [],
				workspaceMode: "shared",
				allowConcurrentWrites: false,
				resultFormat: "text",
			}),
		)
		.digest("hex");
	assert.equal(hashSpawnRequest(withoutTimeout), legacyHash);
});

test("AgentRegistry retains spawn idempotency only until close", async () => {
	const registry = new AgentRegistry(async () => ({ output: "done", exitCode: 0 }));
	const first = await registry.spawn({
		agent: "explorer",
		task: "first",
		cwd: process.cwd(),
		spawnIdempotencyKey: "key",
		spawnRequestHash: "hash",
	});
	assert.equal(registry.findBySpawnIdempotencyKey("key", "hash")?.id, first.id);
	assert.throws(() => registry.findBySpawnIdempotencyKey("key", "different"), /different/);
	await registry.close(first.id);
	assert.equal(registry.findBySpawnIdempotencyKey("key", "hash"), undefined);
	const replacement = await registry.spawn({
		agent: "explorer",
		task: "different after close",
		cwd: process.cwd(),
		spawnIdempotencyKey: "key",
		spawnRequestHash: "different",
	});
	assert.notEqual(replacement.id, first.id);
});

test("AgentRegistry preserves queue and transport timing without persisting progress callbacks", async () => {
	let now = 10;
	const registry = new AgentRegistry(
		async (_agent, _task, _signal, onProgress) => {
			onProgress?.({
				transport: "rpc",
				protocol: "pi-subagents:v1",
				phase: "ready",
				updatedAt: 20,
				timing: { startedAt: 15, readyAt: 20 },
			});
			return {
				output: "done",
				exitCode: 0,
				telemetry: {
					transport: "rpc",
					protocol: "pi-subagents:v1",
					phase: "settled",
					updatedAt: 30,
					timing: { startedAt: 15, readyAt: 20, settledAt: 30 },
				},
			};
		},
		{ now: () => now++ },
	);
	const spawned = await registry.spawn({ agent: "explorer", task: "timed", cwd: process.cwd() });
	await registry.wait(spawned.id, 100);
	const telemetry = registry.getInspection(spawned.id)?.telemetry;
	assert.equal(telemetry?.transport, "rpc");
	assert.equal(telemetry?.timing.queuedAt, 12);
	assert.equal(telemetry?.timing.readyAt, 20);
	assert.equal(telemetry?.timing.settledAt, 30);
	const completionId = registry.listPendingCompletions()[0]?.completionId;
	assert.ok(completionId);
	await registry.markCompletionDelivered(completionId, 40);
	assert.equal(registry.getInspection(spawned.id)?.telemetry?.timing.completionDeliveredAt, 40);
});

test("AgentRegistry retains ordered completion identities until exact acknowledgement", async () => {
	const delivered: Array<{ completionId: string; runId: string; generation: number }> = [];
	const registry = new AgentRegistry(
		async (_agent, task) => ({ output: `done:${task}`, exitCode: 0 }),
		{
			onTurnComplete: (completion) => {
				delivered.push({
					completionId: completion.completionId,
					runId: completion.runId,
					generation: completion.generation,
				});
			},
		},
	);
	const spawned = await registry.spawn({ agent: "explorer", task: "first", cwd: process.cwd() });
	await registry.wait(spawned.id, 100);
	await registry.followUp(spawned.id, "second");
	await registry.wait(spawned.id, 100);

	const pending = registry.listPendingCompletions();
	assert.equal(pending.length, 2);
	assert.deepEqual(
		pending.map((completion) => completion.generation),
		[1, 2],
	);
	assert.deepEqual(
		delivered,
		pending.map(({ completionId, runId, generation }) => ({
			completionId,
			runId,
			generation,
		})),
	);
	assert.notEqual(pending[0]?.completionId, pending[1]?.completionId);
	assert.notEqual(pending[0]?.runId, pending[1]?.runId);

	await registry.markCompletionDelivered(pending[1].completionId, 40);
	assert.deepEqual(
		registry.listPendingCompletions().map((completion) => completion.completionId),
		[pending[0].completionId],
	);
	await registry.markCompletionDelivered("completion:unknown", 50);
	assert.equal(registry.listPendingCompletions().length, 1);
});

test("AgentRegistry exposes metadata-only inspection snapshots", async () => {
	let finish!: (value: { output: string; exitCode: number; error?: string }) => void;
	const registry = new AgentRegistry(
		async () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const spawned = await registry.spawn({
		agent: "explorer",
		task: "private current task",
		cwd: process.cwd(),
		thinkingLevel: "high",
		context: "private parent context",
	});
	await registry.sendMessage(spawned.id, "private mailbox content");

	assert.deepEqual(registry.inspectionCounts(), { activeAgents: 1, retainedAgents: 1 });
	const listed = registry.listInspection();
	assert.equal(listed.length, 1);
	assert.deepEqual(listed[0], {
		id: spawned.id,
		taskName: spawned.taskName,
		taskPath: spawned.taskPath,
		agent: "explorer",
		state: "running",
		createdAt: spawned.createdAt,
		updatedAt: listed[0].updatedAt,
		historyCount: 0,
		unreadMessages: 1,
		turnGeneration: 1,
		pendingCompletionCount: 0,
		pendingRequiredCompletionCount: 0,
	});
	assert.doesNotMatch(JSON.stringify(listed), /private/);

	const detail = registry.getInspection(spawned.id);
	assert.equal(detail?.currentTask, "private current task");
	assert.equal(detail?.cwd, process.cwd());
	assert.equal(detail?.thinkingLevel, "high");
	assert.doesNotMatch(JSON.stringify(detail), /mailbox content|parent context/);

	finish({ output: "private history output", exitCode: 1, error: "private error" });
	await registry.wait(spawned.id, 100);
	assert.deepEqual(registry.inspectionCounts(), { activeAgents: 0, retainedAgents: 1 });
	const completed = registry.getInspection(spawned.id);
	assert.equal(completed?.historyCount, 1);
	assert.equal(completed?.error, "private error");
	assert.doesNotMatch(JSON.stringify(completed), /history output|mailbox content|parent context/);
});

test("AgentRegistry deduplicates exact spawn retries before another transport turn", async () => {
	let turns = 0;
	const registry = new AgentRegistry(async () => {
		turns++;
		return {
			output: JSON.stringify({
				version: "pi-subagents:result:v1",
				summary: "done",
				evidence: ["src/a.ts"],
				changes: [],
				verification: ["test"],
				risks: [],
			}),
			exitCode: 0,
		};
	});
	const input = {
		agent: "explorer",
		task: "inspect",
		cwd: process.cwd(),
		spawnIdempotencyKey: "request-1",
		spawnRequestHash: "a".repeat(64),
		resultFormat: "structured-v1" as const,
	};
	const first = await registry.spawn(input);
	const repeated = await registry.spawn(input);
	assert.equal(repeated.id, first.id);
	await registry.wait(first.id, 100);
	assert.equal(turns, 1);
	assert.equal(registry.getInspection(first.id)?.structuredResult?.summary, "done");
	await assert.rejects(
		() => registry.spawn({ ...input, spawnRequestHash: "b".repeat(64) }),
		/different parameters/,
	);
	await registry.close(first.id);
	const afterClose = await registry.spawn(input);
	assert.notEqual(afterClose.id, first.id);
});

test("AgentRegistry projects actionable structured v2 outcomes into lifecycle state", async () => {
	const registry = new AgentRegistry(async () => ({
		output: JSON.stringify({
			version: "pi-subagents:result:v2",
			status: "needs-input",
			reasonCode: "missing-dependency",
			summary: "need schema",
			claims: [],
			artifacts: [],
			changes: [],
			verification: [],
			limitations: [],
			unresolvedDependencies: ["schema"],
		}),
		exitCode: 0,
	}));
	const agent = await registry.spawn({
		agent: "explorer",
		task: "inspect",
		cwd: process.cwd(),
		resultFormat: "structured-v2",
	});
	await registry.wait(agent.id, 100);
	const inspection = registry.getInspection(agent.id);
	assert.equal(inspection?.state, "needs-input");
	assert.deepEqual(inspection?.outcome, {
		status: "needs-input",
		reasonCode: "missing-dependency",
		recoveryActions: ["supply-input"],
		retryable: false,
	});
	await registry.followUp(agent.id, "schema supplied");
});

test("AgentRegistry fails closed when a requested structured result is malformed", async () => {
	const registry = new AgentRegistry(async () => ({ output: "ordinary text", exitCode: 0 }));
	const agent = await registry.spawn({
		agent: "explorer",
		task: "inspect",
		cwd: process.cwd(),
		resultFormat: "structured-v2",
	});
	await registry.wait(agent.id, 100);
	const inspection = registry.getInspection(agent.id);
	assert.equal(inspection?.state, "failed");
	assert.equal(inspection?.outcome?.status, "contract-invalid");
});
