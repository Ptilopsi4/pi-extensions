import { randomUUID } from "node:crypto";
import path from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentTurnCompletion, ManagedAgent } from "./registry-types.js";
import type { TransportUsage } from "./transport-types.js";
import {
	USAGE_RECORDING_DIRECTORY,
	USAGE_RECORDING_RETENTION_DAYS,
	USAGE_RECORDING_STUDY_ID,
} from "./usage-recording-config.js";
import type { UsageEventStorePort } from "./usage-recording-store.js";

const SHUTDOWN_FLUSH_MS = 2_500;

const SUBAGENT_TOOLS = new Set([
	"subagent_spawn",
	"subagent_send",
	"subagent_manage",
	"subagent_mailbox",
	"subagent_inspect",
	"subagent_await",
]);

export type UsageSurfaceArm = "async-only" | "disabled";

type UsageEventType =
	| "study_exposure"
	| "parent_turn_start"
	| "parent_turn_end"
	| "tool_start"
	| "tool_end"
	| "child_run_start"
	| "child_run_end"
	| "completion_transition"
	| "lifecycle";

interface UsageEvent {
	schemaVersion: 1;
	studyId: typeof USAGE_RECORDING_STUDY_ID;
	surfaceArm: UsageSurfaceArm;
	logicalSession: string;
	runtimeInstance: string;
	branchEpoch: number;
	turnId?: string;
	eventSequence: number;
	monotonicOffsetMs: number;
	eventType: UsageEventType;
	data: Record<string, boolean | number | string>;
}

export interface UsageRecordingStatus {
	enabled: boolean;
	initialized: boolean;
	retentionDays: number;
	path: string;
	recordedEvents: number;
	writeFailure: boolean;
}

export interface UsageRecordingController {
	startSession(input: {
		enabled: boolean;
		surfaceArm: UsageSurfaceArm;
		reason: "startup" | "reload" | "new" | "resume" | "fork";
		onWarning?: (message: string) => void;
	}): Promise<void>;
	shutdown(reason: "quit" | "reload" | "new" | "resume" | "fork"): Promise<void>;
	setEnabled(value: boolean): Promise<void>;
	getStatus(): UsageRecordingStatus;
	observeAgents(agents: readonly ManagedAgent[]): void;
	recordChildCompletion(completion: AgentTurnCompletion): void;
	recordCompletionDeliveryAttempt(
		completion: AgentTurnCompletion,
		input: {
			delivery: "steer" | "nextTurn";
			triggerTurn: boolean;
			outcome: "accepted" | "failed";
		},
	): void;
	recordCompletionVisible(completion: AgentTurnCompletion): void;
}

export interface UsageRecordingDependencies {
	createId(): string;
	monotonicNow(): number;
	getAgentDir(): string;
	loadStore(): Promise<{
		UsageEventStore: new (path: string) => UsageEventStorePort;
	}>;
}

export function registerUsageRecording(
	pi: ExtensionAPI,
	dependencies: Partial<UsageRecordingDependencies> = {},
): UsageRecordingController {
	const deps: UsageRecordingDependencies = {
		createId: dependencies.createId ?? randomUUID,
		monotonicNow: dependencies.monotonicNow ?? performance.now.bind(performance),
		getAgentDir: dependencies.getAgentDir ?? getAgentDir,
		loadStore: dependencies.loadStore ?? (() => import("./usage-recording-store.js")),
	};
	const pathValue = path.join(deps.getAgentDir(), USAGE_RECORDING_DIRECTORY);
	const runtimeInstance = deps.createId();
	let logicalSession = deps.createId();
	let branchEpoch = 0;
	let surfaceArm: UsageSurfaceArm = "disabled";
	let sessionStartedAt = deps.monotonicNow();
	let enabled = false;
	let eventSequence = 0;
	let recordedEvents = 0;
	let writeFailure = false;
	let warningActive = false;
	let onWarning: ((message: string) => void) | undefined;
	let storePromise: Promise<UsageEventStorePort> | undefined;
	let writeGeneration = 0;
	let writeTail: Promise<void> = Promise.resolve();
	let transitionTail: Promise<void> = Promise.resolve();
	let currentTurnId: string | undefined;
	let turnOrdinal = 0;
	let operationOrdinal = 0;
	let childOrdinal = 0;
	let runOrdinal = 0;
	let completionOrdinal = 0;
	const operations = new Map<string, { id: string; startedAt: number }>();
	const children = new Map<string, string>();
	const runs = new Map<string, string>();
	const completions = new Map<string, string>();
	const agentStates = new Map<string, string>();
	const activeRuns = new Map<string, string>();

	pi.on("agent_start", () => record("lifecycle", { phase: "parent_agent_start" }));
	pi.on("agent_settled", () => record("lifecycle", { phase: "parent_agent_settled" }));
	pi.on("turn_start", () => {
		currentTurnId = `turn-${++turnOrdinal}`;
		record("parent_turn_start", { turnOrdinal }, currentTurnId);
	});
	pi.on("turn_end", (event) => {
		record(
			"parent_turn_end",
			{
				turnOrdinal,
				...usageNumbers(event.message.role === "assistant" ? event.message.usage : undefined),
			},
			currentTurnId,
		);
		currentTurnId = undefined;
	});
	pi.on("tool_execution_start", (event) => {
		if (!SUBAGENT_TOOLS.has(event.toolName)) return;
		const operationId = `tool-${++operationOrdinal}`;
		operations.set(event.toolCallId, { id: operationId, startedAt: offset() });
		record("tool_start", { operationId, tool: event.toolName }, currentTurnId);
	});
	pi.on("tool_execution_end", (event) => {
		if (!SUBAGENT_TOOLS.has(event.toolName)) return;
		const operation = operations.get(event.toolCallId);
		operations.delete(event.toolCallId);
		record(
			"tool_end",
			{
				operationId: operation?.id ?? `tool-${++operationOrdinal}`,
				tool: event.toolName,
				isError: event.isError,
				...(operation ? { durationMs: Math.max(0, offset() - operation.startedAt) } : {}),
				...usageNumbers(event.result?.usage),
			},
			currentTurnId,
		);
	});

	const controller: UsageRecordingController = {
		startSession(input) {
			return serializeTransition(async () => {
				enabled = false;
				await closeStore();
				logicalSession = deps.createId();
				branchEpoch += 1;
				surfaceArm = input.surfaceArm;
				sessionStartedAt = deps.monotonicNow();
				eventSequence = 0;
				recordedEvents = 0;
				writeFailure = false;
				warningActive = false;
				onWarning = input.onWarning;
				currentTurnId = undefined;
				turnOrdinal = 0;
				operationOrdinal = 0;
				childOrdinal = 0;
				runOrdinal = 0;
				completionOrdinal = 0;
				operations.clear();
				children.clear();
				runs.clear();
				completions.clear();
				agentStates.clear();
				activeRuns.clear();
				enabled = input.enabled;
				if (!enabled) return;
				record("study_exposure", { reason: input.reason });
				record("lifecycle", { phase: "session_start", reason: input.reason });
				enqueue(async (store) => store.prune(USAGE_RECORDING_RETENTION_DAYS));
				await writeTail;
			});
		},
		shutdown(reason) {
			return serializeTransition(async () => {
				if (enabled) record("lifecycle", { phase: "session_shutdown", reason });
				enabled = false;
				await flushWithin(SHUTDOWN_FLUSH_MS);
				await closeStore();
			});
		},
		setEnabled(value) {
			return serializeTransition(async () => {
				if (value === enabled) return;
				if (value) {
					enabled = true;
					record("study_exposure", { reason: "enabled_in_settings" });
					record("lifecycle", { phase: "recording_enabled" });
					enqueue(async (store) => store.prune(USAGE_RECORDING_RETENTION_DAYS));
					await writeTail;
					return;
				}
				record("lifecycle", { phase: "recording_disabled" });
				enabled = false;
				await flushWithin(SHUTDOWN_FLUSH_MS);
				await closeStore();
			});
		},
		getStatus() {
			return {
				enabled,
				initialized: storePromise !== undefined,
				retentionDays: USAGE_RECORDING_RETENTION_DAYS,
				path: pathValue,
				recordedEvents,
				writeFailure,
			};
		},
		observeAgents(agents) {
			if (!enabled) return;
			for (const agent of agents) {
				const childId = localChildId(agent.id);
				if (agentStates.get(agent.id) !== agent.state) {
					agentStates.set(agent.id, agent.state);
					record("lifecycle", { phase: "child_state", childId, state: agent.state });
				}
				if (agent.currentRunId && activeRuns.get(agent.id) !== agent.currentRunId) {
					activeRuns.set(agent.id, agent.currentRunId);
					record("child_run_start", {
						childId,
						runId: localRunId(agent.currentRunId),
						generation: agent.currentTurnGeneration ?? agent.turnGeneration ?? 0,
					});
				}
			}
		},
		recordChildCompletion(completion) {
			if (!enabled) return;
			const childId = localChildId(completion.agent.id);
			const runId = localRunId(completion.runId);
			const timing = completion.agent.telemetry?.timing;
			record("child_run_end", {
				childId,
				runId,
				generation: completion.generation,
				state: completion.agent.state,
				...(completion.agent.outcome?.status
					? { outcomeStatus: completion.agent.outcome.status }
					: {}),
				...(completion.agent.termination?.reason
					? { terminationReason: completion.agent.termination.reason }
					: {}),
				...(completion.agent.telemetry?.budgetSource
					? {
							timeoutBudgetSource: completion.agent.telemetry.budgetSource.timeout,
							idleTimeoutBudgetSource: completion.agent.telemetry.budgetSource.idleTimeout,
							turnLimitBudgetSource: completion.agent.telemetry.budgetSource.turnLimit,
							toolCallLimitBudgetSource: completion.agent.telemetry.budgetSource.toolCallLimit,
						}
					: {}),
				...(timing?.startedAt !== undefined && timing.settledAt !== undefined
					? { durationMs: Math.max(0, timing.settledAt - timing.startedAt) }
					: {}),
				...transportUsageNumbers(completion.agent.telemetry?.usage),
			});
			recordCompletion(completion, "persisted");
		},
		recordCompletionDeliveryAttempt(completion, input) {
			recordCompletion(completion, "delivery_attempt", {
				delivery: input.delivery,
				triggerTurn: input.triggerTurn,
				outcome: input.outcome,
			});
		},
		recordCompletionVisible(completion) {
			recordCompletion(completion, "visible");
		},
	};

	return controller;

	function record(
		eventType: UsageEventType,
		data: UsageEvent["data"],
		turnId = currentTurnId,
	): void {
		if (!enabled) return;
		const event: UsageEvent = {
			schemaVersion: 1,
			studyId: USAGE_RECORDING_STUDY_ID,
			surfaceArm,
			logicalSession,
			runtimeInstance,
			branchEpoch,
			...(turnId ? { turnId } : {}),
			eventSequence: ++eventSequence,
			monotonicOffsetMs: offset(),
			eventType,
			data,
		};
		enqueue(async (store) => store.append(event), true);
	}

	function recordCompletion(
		completion: AgentTurnCompletion,
		transition: "persisted" | "delivery_attempt" | "visible",
		extra: UsageEvent["data"] = {},
	): void {
		if (!enabled) return;
		record("completion_transition", {
			completionId: localCompletionId(completion.completionId),
			childId: localChildId(completion.agent.id),
			runId: localRunId(completion.runId),
			generation: completion.generation,
			transition,
			...extra,
		});
	}

	function enqueue(
		operation: (store: UsageEventStorePort) => Promise<void>,
		countsAsEvent = false,
	): void {
		const generation = writeGeneration;
		const task = writeTail.then(async () => {
			if (generation !== writeGeneration) return false;
			await operation(await ensureStore());
			return true;
		});
		writeTail = task.then(
			(completed) => {
				if (completed && countsAsEvent) recordedEvents += 1;
				writeFailure = false;
				warningActive = false;
			},
			() => {
				writeFailure = true;
				if (!warningActive) {
					warningActive = true;
					safeWarn("Local subagent usage recording could not save an event; recording will retry.");
				}
			},
		);
	}

	async function ensureStore(): Promise<UsageEventStorePort> {
		storePromise ??= deps
			.loadStore()
			.then(({ UsageEventStore }) => new UsageEventStore(pathValue))
			.catch((error: unknown) => {
				storePromise = undefined;
				throw error;
			});
		return storePromise;
	}

	function serializeTransition(operation: () => Promise<void>): Promise<void> {
		const result = transitionTail.then(operation, operation);
		transitionTail = result.catch(() => undefined);
		return result;
	}

	async function flushWithin(timeoutMs: number): Promise<void> {
		let timer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				writeTail,
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, timeoutMs);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	async function closeStore(): Promise<void> {
		writeGeneration += 1;
		const active = storePromise;
		storePromise = undefined;
		if (active) await active.then((store) => store.close()).catch(() => undefined);
		await writeTail;
		writeTail = Promise.resolve();
	}

	function localChildId(value: string): string {
		return localId(children, value, "child", () => ++childOrdinal);
	}

	function localRunId(value: string): string {
		return localId(runs, value, "run", () => ++runOrdinal);
	}

	function localCompletionId(value: string): string {
		return localId(completions, value, "completion", () => ++completionOrdinal);
	}

	function offset(): number {
		return Math.max(0, Math.round(deps.monotonicNow() - sessionStartedAt));
	}

	function safeWarn(message: string): void {
		try {
			onWarning?.(message);
		} catch {
			// A replaced UI cannot receive storage feedback.
		}
	}
}

function localId(
	values: Map<string, string>,
	raw: string,
	prefix: string,
	next: () => number,
): string {
	const existing = values.get(raw);
	if (existing) return existing;
	const created = `${prefix}-${next()}`;
	values.set(raw, created);
	return created;
}

function usageNumbers(value: unknown): Record<string, number> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const record = value as Record<string, unknown>;
	return numericFields(record, ["input", "output", "cacheRead", "cacheWrite"]);
}

function transportUsageNumbers(value: TransportUsage | undefined): Record<string, number> {
	if (!value) return {};
	return numericFields(value as unknown as Record<string, unknown>, [
		"input",
		"output",
		"cacheRead",
		"cacheWrite",
		"totalTokens",
		"cost",
		"turns",
	]);
}

function numericFields(
	record: Record<string, unknown>,
	fields: readonly string[],
): Record<string, number> {
	return Object.fromEntries(
		fields.flatMap((field) => {
			const value = record[field];
			return typeof value === "number" && Number.isFinite(value) && value >= 0
				? [[field, value] as const]
				: [];
		}),
	);
}
