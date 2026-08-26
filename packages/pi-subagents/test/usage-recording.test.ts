import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { createMockPi } from "../../../test/support.js";
import type { ManagedAgent } from "../src/registry-types.js";
import { registerUsageRecording } from "../src/usage-recording.js";
import type { UsageEventStorePort } from "../src/usage-recording-store.js";

class MemoryUsageStore implements UsageEventStorePort {
	static events: unknown[] = [];
	static created = 0;
	static closed = 0;
	readonly path: string;

	constructor(path: string) {
		this.path = path;
		MemoryUsageStore.created += 1;
	}

	async append(event: unknown): Promise<void> {
		MemoryUsageStore.events.push(structuredClone(event));
	}

	async prune(): Promise<void> {}

	async close(): Promise<void> {
		MemoryUsageStore.closed += 1;
	}
}

async function emit(
	mock: ReturnType<typeof createMockPi>,
	name: string,
	...args: unknown[]
): Promise<void> {
	for (const handler of mock.events.get(name) ?? []) await handler(...args);
}

function managedAgent(): ManagedAgent {
	return {
		id: "raw-agent-secret",
		agent: "private-agent-name",
		rootId: "raw-agent-secret",
		depth: 0,
		children: [],
		state: "running",
		createdAt: 100,
		updatedAt: 110,
		cwd: "/private/project/path",
		currentTask: "private task contents",
		currentRunId: "raw-run-secret",
		currentTurnGeneration: 3,
		turnGeneration: 3,
		history: [],
		mailbox: [],
		telemetry: {
			phase: "running",
			updatedAt: 110,
			timing: { startedAt: 100, settledAt: 200 },
			usage: {
				input: 10,
				output: 20,
				cacheRead: 3,
				cacheWrite: 4,
				totalTokens: 37,
				cost: 0.1,
				turns: 2,
			},
		},
	};
}

test("local usage recording enables and shuts down without background waits", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-usage-runtime-"));
	const mock = createMockPi();
	const recorder = registerUsageRecording(mock.pi, { getAgentDir: () => directory });
	try {
		await recorder.startSession({ enabled: false, surfaceArm: "async-only", reason: "startup" });
		await assert.rejects(() => lstat(path.join(directory, "pi-subagents-usage")), /ENOENT/);
		await recorder.setEnabled(true);
		assert.equal(recorder.getStatus().enabled, true);
		assert.equal(recorder.getStatus().recordedEvents, 2);
		await recorder.shutdown("quit");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("usage recording separates replacement sessions and closes each writer", async () => {
	MemoryUsageStore.events = [];
	MemoryUsageStore.created = 0;
	MemoryUsageStore.closed = 0;
	const mock = createMockPi();
	let id = 0;
	const recorder = registerUsageRecording(mock.pi, {
		createId: () => `replacement-${++id}`,
		monotonicNow: () => id,
		getAgentDir: () => "/agent",
		loadStore: async () => ({ UsageEventStore: MemoryUsageStore }),
	});
	await recorder.startSession({ enabled: true, surfaceArm: "async-only", reason: "startup" });
	await recorder.startSession({ enabled: true, surfaceArm: "async-only", reason: "fork" });
	await recorder.shutdown("quit");

	assert.equal(MemoryUsageStore.created, 2);
	assert.equal(MemoryUsageStore.closed, 2);
	const exposures = MemoryUsageStore.events.filter(
		(event) => (event as { eventType?: string }).eventType === "study_exposure",
	) as Array<{
		logicalSession: string;
		runtimeInstance: string;
		branchEpoch: number;
		surfaceArm: string;
	}>;
	assert.equal(exposures.length, 2);
	assert.notEqual(exposures[0]?.logicalSession, exposures[1]?.logicalSession);
	assert.equal(exposures[0]?.runtimeInstance, exposures[1]?.runtimeInstance);
	assert.deepEqual(
		exposures.map((event) => [event.branchEpoch, event.surfaceArm]),
		[
			[1, "async-only"],
			[2, "async-only"],
		],
	);
});

test("usage recording serializes enable with concurrent shutdown", async () => {
	let releaseWrite: (() => void) | undefined;
	let startedWrite: (() => void) | undefined;
	const started = new Promise<void>((resolve) => {
		startedWrite = resolve;
	});
	const release = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	class DelayedStore extends MemoryUsageStore {
		override async append(event: unknown): Promise<void> {
			startedWrite?.();
			await release;
			await super.append(event);
		}
	}
	MemoryUsageStore.events = [];
	MemoryUsageStore.closed = 0;
	const mock = createMockPi();
	const recorder = registerUsageRecording(mock.pi, {
		createId: () => "local-runtime",
		monotonicNow: () => 1,
		getAgentDir: () => "/agent",
		loadStore: async () => ({ UsageEventStore: DelayedStore }),
	});
	const enabling = recorder.setEnabled(true);
	await started;
	const shuttingDown = recorder.shutdown("quit");
	releaseWrite?.();
	await Promise.all([enabling, shuttingDown]);
	assert.equal(recorder.getStatus().enabled, false);
	assert.equal(MemoryUsageStore.closed, 1);
});

test("usage recording stays dormant until opt-in and stores only bounded metadata", async () => {
	MemoryUsageStore.events = [];
	MemoryUsageStore.created = 0;
	MemoryUsageStore.closed = 0;
	const mock = createMockPi();
	let monotonic = 0;
	let id = 0;
	const recorder = registerUsageRecording(mock.pi, {
		createId: () => `local-${++id}`,
		monotonicNow: () => ++monotonic,
		getAgentDir: () => "/agent",
		loadStore: async () => ({ UsageEventStore: MemoryUsageStore }),
	});

	await recorder.startSession({
		enabled: false,
		surfaceArm: "async-only",
		reason: "startup",
	});
	await emit(mock, "tool_execution_start", {
		toolCallId: "provider-tool-secret",
		toolName: "subagent",
		args: { task: "private prompt", cwd: "/private/path" },
	});
	assert.equal(MemoryUsageStore.created, 0);
	assert.deepEqual(MemoryUsageStore.events, []);

	await recorder.setEnabled(true);
	await emit(mock, "agent_start", {});
	await emit(mock, "turn_start", { turnIndex: 0, timestamp: 999 });
	await emit(mock, "tool_execution_start", {
		toolCallId: "provider-tool-secret",
		toolName: "subagent_spawn",
		args: { task: "private prompt", cwd: "/private/path" },
	});
	await emit(mock, "tool_execution_end", {
		toolCallId: "provider-tool-secret",
		toolName: "subagent_spawn",
		isError: false,
		result: { content: [{ type: "text", text: "private result" }] },
	});
	const baseAgent = managedAgent();
	recorder.observeAgents([baseAgent]);
	const agent: ManagedAgent = {
		...baseAgent,
		state: "partial" as const,
		outcome: {
			status: "partial" as const,
			reasonCode: "tool_call_limit",
			recoveryActions: [],
			retryable: false,
		},
		telemetry: {
			...(baseAgent.telemetry as NonNullable<ManagedAgent["telemetry"]>),
			budgetSource: {
				timeout: "runtime" as const,
				idleTimeout: "runtime" as const,
				turnLimit: "runtime" as const,
				toolCallLimit: "explicit" as const,
			},
		},
	};
	const completion = {
		completionId: "raw-completion-secret",
		runId: "raw-run-secret",
		generation: 3,
		task: "private task contents",
		output: "private child output",
		createdAt: 200,
		agent,
	};
	recorder.recordChildCompletion(completion);
	recorder.recordCompletionDeliveryAttempt(completion, {
		delivery: "steer",
		triggerTurn: true,
		outcome: "accepted",
	});
	recorder.recordCompletionVisible(completion);
	await emit(mock, "turn_end", {
		message: {
			role: "assistant",
			usage: { input: 11, output: 12, cacheRead: 1, cacheWrite: 2 },
		},
	});
	await emit(mock, "agent_settled", {});
	await recorder.shutdown("quit");

	assert.equal(MemoryUsageStore.created, 1);
	assert.equal(MemoryUsageStore.closed, 1);
	const serialized = JSON.stringify(MemoryUsageStore.events);
	for (const prohibited of [
		"private prompt",
		"private result",
		"private task contents",
		"private child output",
		"/private/project/path",
		"/private/path",
		"provider-tool-secret",
		"raw-agent-secret",
		"raw-run-secret",
		"raw-completion-secret",
		"private-agent-name",
	]) {
		assert.doesNotMatch(serialized, new RegExp(prohibited.replaceAll("/", "\\/")));
	}
	assert.match(serialized, /subagent_spawn/);
	assert.match(serialized, /child_run_start/);
	assert.match(serialized, /child_run_end/);
	assert.match(serialized, /delivery_attempt/);
	assert.match(serialized, /visible/);
	assert.match(serialized, /"totalTokens":37/);
	assert.match(serialized, /"outcomeStatus":"partial"/);
	assert.match(serialized, /"toolCallLimitBudgetSource":"explicit"/);
	assert.ok(
		MemoryUsageStore.events.every((event) => {
			const record = event as Record<string, unknown>;
			return record.schemaVersion === 1 && record.studyId === "pi-subagents-surface-v1";
		}),
	);
});
