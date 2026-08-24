import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { AgentPersistence } from "../src/persistence.js";
import { AgentRegistry } from "../src/registry.js";
import { CompletionDeliveryBroker } from "../src/stateful.js";
import { record } from "./registry-test-helpers.js";

test("AgentPersistence atomically saves, restores, redacts, deletes, and quarantines bad state", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-state-"));
	const persistence = new AgentPersistence("session", { stateDir: dir, maxStoredAgents: 2 });
	await persistence.save([
		record({
			thinkingLevel: "high",
			timeoutMs: 1234,
			currentTimeoutMs: 4321,
			idleTimeoutMs: 2345,
			currentIdleTimeoutMs: 5432,
			maxTurns: 7,
			currentMaxTurns: 8,
			maxToolCalls: 9,
			currentMaxToolCalls: 10,
			spawnIdempotencyKey: "persisted-request",
			spawnRequestHash: "a".repeat(64),
			resultFormat: "structured-v1",
			contextTurns: 2,
			contextBytes: 128,
			telemetry: {
				protocol: "pi-subagents:v1",
				transport: "rpc",
				phase: "settled",
				updatedAt: 2,
				timing: { settledAt: 2 },
			},
			structuredResult: {
				version: "pi-subagents:result:v1",
				summary: "ephemeral",
				evidence: [],
				changes: [],
				verification: [],
				risks: [],
			},
			termination: {
				version: "pi-subagents:termination:v1",
				reason: "work_timeout",
				limit: 1234,
				checkpoint: {
					version: "pi-subagents:checkpoint:v1",
					task: "inspect",
					assistantNotes: ["<private>checkpoint-secret</private>visible checkpoint"],
					completedTools: [],
					changedFiles: [],
					sideEffectsMayHaveOccurred: false,
					truncated: false,
				},
				finalization: { attempted: false, status: "skipped", durationMs: 0 },
			},
			target: {
				cwd: process.cwd(),
				boundary: "external",
				trust: { kind: "saved-trusted", projectTrusted: true, sourcePath: process.cwd() },
			},
			context: "<private>secret</private>",
			mailbox: [
				{
					id: "msg",
					senderId: "root",
					recipientId: "sa_test",
					content: "<private>mail-secret</private>visible",
					createdAt: 1,
				},
			],
			turnGeneration: 2,
			completionRequirements: [
				{
					version: "pi-subagents:completion-requirement:v1",
					runId: "run:two",
					generation: 2,
					state: "available",
					createdAt: 2,
					updatedAt: 3,
					completionId: "completion:two",
					terminalState: "completed",
				},
			],
			pendingCompletions: [
				{
					completionId: "completion:one",
					runId: "run:one",
					generation: 1,
					task: "<private>completion-task</private>visible task",
					output: "[subagent-private] completion-output\nvisible completion",
					createdAt: 2,
				},
				{
					completionId: "completion:two",
					runId: "run:two",
					generation: 2,
					task: "second",
					output: "done",
					createdAt: 3,
				},
			],
			history: [
				{
					task: "task",
					output: "[subagent-private] hidden\nvisible",
					startedAt: 1,
					completedAt: 2,
					exitCode: 0,
				},
			],
		}),
	]);
	const raw = readFileSync(persistence.filePath, "utf8");
	assert.doesNotMatch(raw, /secret|hidden/);
	assert.match(raw, /visible/);
	assert.doesNotMatch(raw, /telemetry/);
	assert.match(raw, /structuredResult|ephemeral/);
	const restoredState = persistence.load()[0];
	assert.equal(restoredState?.state, "completed");
	assert.equal(restoredState?.thinkingLevel, "high");
	assert.equal(restoredState?.timeoutMs, 1234);
	assert.equal(restoredState?.currentTimeoutMs, undefined);
	assert.equal(restoredState?.idleTimeoutMs, 2345);
	assert.equal(restoredState?.currentIdleTimeoutMs, undefined);
	assert.equal(restoredState?.maxTurns, 7);
	assert.equal(restoredState?.currentMaxTurns, undefined);
	assert.equal(restoredState?.maxToolCalls, 9);
	assert.equal(restoredState?.currentMaxToolCalls, undefined);
	assert.equal(restoredState?.spawnIdempotencyKey, "persisted-request");
	assert.equal(restoredState?.spawnRequestHash, "a".repeat(64));
	assert.equal(restoredState?.resultFormat, "structured-v1");
	assert.equal(restoredState?.contextTurns, 2);
	assert.equal(restoredState?.contextBytes, 128);
	assert.equal(restoredState?.telemetry, undefined);
	assert.equal(restoredState?.structuredResult?.summary, "ephemeral");
	assert.equal(restoredState?.turnGeneration, 2);
	assert.deepEqual(restoredState?.completionRequirements, [
		{
			version: "pi-subagents:completion-requirement:v1",
			runId: "run:two",
			generation: 2,
			state: "available",
			createdAt: 2,
			updatedAt: 3,
			completionId: "completion:two",
			terminalState: "completed",
		},
	]);
	assert.deepEqual(
		restoredState?.pendingCompletions?.map((completion) => ({
			completionId: completion.completionId,
			runId: completion.runId,
			generation: completion.generation,
			task: completion.task,
			output: completion.output,
		})),
		[
			{
				completionId: "completion:one",
				runId: "run:one",
				generation: 1,
				task: "[private content omitted]visible task",
				output: "visible completion",
			},
			{
				completionId: "completion:two",
				runId: "run:two",
				generation: 2,
				task: "second",
				output: "done",
			},
		],
	);
	assert.equal(
		restoredState?.termination?.checkpoint.assistantNotes[0],
		"[private content omitted]visible checkpoint",
	);
	assert.equal(restoredState?.target?.trust.kind, "saved-trusted");
	assert.equal(restoredState?.target?.trust.projectTrusted, true);
	assert.equal(restoredState?.mailbox[0]?.content, "[private content omitted]visible");
	const competing = new AgentPersistence("session", { stateDir: dir, maxStoredAgents: 2 });
	await Promise.all([
		persistence.save([record({ id: "one" })]),
		competing.save([record({ id: "two" })]),
	]);
	assert.ok(["one", "two"].includes(persistence.load()[0]?.id ?? ""));
	const hierarchyPersistence = new AgentPersistence("hierarchy", {
		stateDir: dir,
		maxStoredAgents: 2,
	});
	const persistenceNow = Date.now();
	await hierarchyPersistence.save([
		record({ id: "root", rootId: "root", updatedAt: persistenceNow }),
		record({
			id: "child",
			rootId: "root",
			parentId: "root",
			depth: 1,
			updatedAt: persistenceNow + 2,
		}),
		record({ id: "other", rootId: "other", updatedAt: persistenceNow + 1 }),
	]);
	assert.deepEqual(
		hierarchyPersistence.load().map((agent) => agent.id),
		["root", "child"],
	);
	assert.throws(
		() => new AgentPersistence("invalid", { stateDir: dir, maxStoredAgents: 0 }),
		/positive safe integer/,
	);
	await persistence.delete();
	assert.deepEqual(persistence.load(), []);
	writeFileSync(
		persistence.filePath,
		JSON.stringify({
			version: 1,
			updatedAt: Date.now(),
			agents: [
				{
					id: "legacy",
					agent: "explorer",
					state: "completed",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					cwd: process.cwd(),
					history: [],
				},
			],
		}),
	);
	assert.equal(persistence.load()[0]?.rootId, "legacy");
	assert.equal(persistence.load()[0]?.thinkingLevel, undefined);
	writeFileSync(
		persistence.filePath,
		JSON.stringify({
			version: 2,
			updatedAt: Date.now(),
			agents: [
				{
					id: "invalid-thinking",
					agent: "explorer",
					thinkingLevel: "huge",
					state: "idle",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					cwd: process.cwd(),
					history: [],
				},
			],
		}),
	);
	assert.deepEqual(persistence.load(), []);
	writeFileSync(
		persistence.filePath,
		JSON.stringify({
			version: 2,
			updatedAt: Date.now(),
			agents: [
				{
					id: "malformed",
					agent: "explorer",
					state: "idle",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					cwd: process.cwd(),
					history: [{}],
				},
			],
		}),
	);
	assert.deepEqual(persistence.load(), []);
	writeFileSync(persistence.filePath, JSON.stringify({ version: 999, agents: [] }));
	assert.deepEqual(persistence.load(), []);
	writeFileSync(persistence.filePath, "not json");
	assert.deepEqual(persistence.load(), []);
	assert.ok(
		readdirSync(dir).some((name) =>
			name.startsWith(`${path.basename(persistence.filePath)}.invalid-`),
		),
	);
});

test("AgentPersistence preserves additive task identity and restores legacy identity through the registry", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-task-path-state-"));
	const persistence = new AgentPersistence("session", { stateDir: dir });
	const futureRecord = {
		...record({ taskName: "research", taskPath: "/root/research" }),
		futureMetadata: { mode: "preserve" },
	};
	await persistence.save([futureRecord]);
	const restored = persistence.load()[0] as
		| (ReturnType<typeof record> & { futureMetadata?: { mode?: string } })
		| undefined;
	assert.equal(restored?.taskName, "research");
	assert.equal(restored?.taskPath, "/root/research");
	assert.equal(restored?.futureMetadata?.mode, "preserve");

	writeFileSync(
		persistence.filePath,
		JSON.stringify({
			version: 1,
			updatedAt: Date.now(),
			agents: [
				{
					id: "legacy-no-path",
					agent: "worker",
					state: "completed",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					cwd: process.cwd(),
					history: [],
				},
			],
		}),
	);
	const legacy = persistence.load();
	assert.equal(legacy[0]?.taskPath, undefined);
	const registry = new AgentRegistry(async () => ({ output: "", exitCode: 0 }));
	registry.restore(legacy);
	assert.match(registry.get("legacy-no-path")?.taskPath ?? "", /^\/root\/agent_/u);
	rmSync(dir, { recursive: true, force: true });
});

test("AgentPersistence trims history instead of dropping a root with pending completion", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-completion-priority-"));
	const persistence = new AgentPersistence("session", { stateDir: dir });
	await persistence.save([
		record({
			turnGeneration: 1,
			pendingCompletions: [
				{
					completionId: "completion:priority:1",
					runId: "run:priority:1",
					generation: 1,
					task: "deliver",
					output: "result",
					createdAt: 2,
				},
			],
			history: [
				{
					task: "oversized history",
					output: "x".repeat(6 * 1024 * 1024),
					startedAt: 1,
					completedAt: 2,
					exitCode: 0,
				},
			],
		}),
	]);
	const restored = persistence.load()[0];
	assert.equal(restored?.id, "sa_test");
	assert.equal(restored?.history.length, 0);
	assert.equal(restored?.pendingCompletions?.[0]?.completionId, "completion:priority:1");
	rmSync(dir, { recursive: true, force: true });
});

test("restored completion outbox delivery does not rerun retained agent work", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-completion-restore-"));
	const persistence = new AgentPersistence("session", { stateDir: dir });
	await persistence.save([
		record({
			turnGeneration: 1,
			pendingCompletions: [
				{
					completionId: "completion:restore:1",
					runId: "run:restore:1",
					generation: 1,
					task: "restore",
					output: "restored output",
					createdAt: 2,
				},
			],
		}),
	]);
	let turns = 0;
	const registry = new AgentRegistry(async () => {
		turns++;
		return { output: "unexpected", exitCode: 0 };
	});
	registry.restore(persistence.load());
	const sent: Array<{ message: Record<string, unknown>; options: Record<string, unknown> }> = [];
	const broker = new CompletionDeliveryBroker(
		{
			sendMessage(message: Record<string, unknown>, options: Record<string, unknown>) {
				sent.push({ message, options });
			},
		} as never,
		{ isIdle: () => true, hasPendingMessages: () => false },
		"next-turn",
	);
	for (const completion of registry.listPendingCompletions()) broker.enqueue(completion);
	broker.flush();
	assert.equal(turns, 0);
	assert.equal(sent.length, 1);
	assert.match(String(sent[0]?.message.content), /Completion ID: completion:restore:1/);
	assert.match(String(sent[0]?.message.content), /restored output/);
	broker.close();
	rmSync(dir, { recursive: true, force: true });
});

test("AgentPersistence restores in-flight work as interrupted without replay", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-crash-state-"));
	const persistence = new AgentPersistence("session", { stateDir: dir });
	await persistence.save([record({ state: "running", currentTask: "do not replay" })]);
	const restored = persistence.load()[0];
	assert.equal(restored?.state, "interrupted");
	assert.equal(restored?.currentTask, undefined);
	rmSync(dir, { recursive: true, force: true });
});
