export const ASYNC_SUBAGENT_BENCHMARK_VERSION = "pi-subagents:async-surface-benchmark:v1" as const;

export const BENCHMARK_RESULT_PREFIX = "BENCHMARK_RESULT_JSON:";
export const BENCHMARK_MODES = ["quick", "extended"] as const;
export const BENCHMARK_ARMS = ["sync", "async"] as const;
export const BENCHMARK_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type AsyncSubagentBenchmarkMode = (typeof BENCHMARK_MODES)[number];
export type AsyncSubagentBenchmarkArm = (typeof BENCHMARK_ARMS)[number];
export type AsyncSubagentBenchmarkThinkingLevel = (typeof BENCHMARK_THINKING_LEVELS)[number];
export type AsyncSubagentTerminalOutcome =
	| "completed"
	| "invalid-output"
	| "timed-out"
	| "readiness-timeout"
	| "process-error"
	| "protocol-error";

export const FIXED_BENCHMARK_TASK = [
	"Inspect only packages/pi-subagents/src/registry.ts, packages/pi-subagents/src/completion-delivery.ts, and packages/pi-subagents/src/stateful-registration.ts.",
	"Report what AgentRegistry.wait races, how completion IDs prevent duplicate delivery, and which session hook closes retained completion delivery state.",
	"Cite each finding with its repository-relative source path and exact symbol or operation.",
	"Do not modify files.",
].join("\n");

export const FIXED_EVIDENCE_RUBRIC = [
	{
		id: "registry-wait-race",
		terms: ["packages/pi-subagents/src/registry.ts", "promise.race"],
	},
	{
		id: "completion-id-deduplication",
		terms: ["packages/pi-subagents/src/completion-delivery.ts", "completionid"],
	},
	{
		id: "session-shutdown-cleanup",
		terms: ["packages/pi-subagents/src/stateful-registration.ts", "session_shutdown"],
	},
] as const;

export interface AsyncSubagentBenchmarkOptions {
	mode: AsyncSubagentBenchmarkMode;
	model: string;
	thinkingLevel: AsyncSubagentBenchmarkThinkingLevel;
	timeoutMs: number;
	readinessTimeoutMs: number;
	outputPath?: string;
	run: boolean;
	piCommand: string;
	workspace?: string;
	extension?: string;
}

export interface AsyncSubagentBenchmarkTrialPlan {
	pairIndex: number;
	orderIndex: number;
	arm: AsyncSubagentBenchmarkArm;
}

export interface AsyncSubagentEventAnalysis {
	completionObserved: boolean;
	evidenceScore: number;
	matchedEvidence: string[];
	prematureFinalCount: number;
	finalAnswer?: string;
	resultMarker?: Record<string, unknown>;
}

export interface AsyncSubagentBenchmarkTrialRecord extends AsyncSubagentEventAnalysis {
	version: typeof ASYNC_SUBAGENT_BENCHMARK_VERSION;
	pairIndex: number;
	orderIndex: number;
	arm: AsyncSubagentBenchmarkArm;
	outcome: AsyncSubagentTerminalOutcome;
	readinessMs: number;
	elapsedMs: number;
	cost: number | null;
	startedAt: string;
	completedAt: string;
	events: unknown[];
	stderr?: string;
	error?: string;
}

export interface DistributionSummary {
	median: number;
	p95: number;
}

export interface AsyncSubagentArmSummary {
	trials: number;
	completionCoverage: number;
	evidenceScore: number;
	prematureFinalCount: number;
	terminalOutcomes: Record<AsyncSubagentTerminalOutcome, number>;
	latencyMs: DistributionSummary | null;
	cost: {
		available: number;
		total: number;
		median: number;
		p95: number;
	} | null;
}

export interface AsyncSubagentBenchmarkSummary {
	version: typeof ASYNC_SUBAGENT_BENCHMARK_VERSION;
	pairs: number;
	arms: Record<AsyncSubagentBenchmarkArm, AsyncSubagentArmSummary>;
}

export class BenchmarkDeadlineError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BenchmarkDeadlineError";
	}
}

export function parseAsyncSubagentBenchmarkArgs(
	args: readonly string[],
): AsyncSubagentBenchmarkOptions {
	let mode: AsyncSubagentBenchmarkMode = "quick";
	let model = "";
	let thinkingLevel: AsyncSubagentBenchmarkThinkingLevel = "medium";
	let timeoutMs = 120_000;
	let readinessTimeoutMs = 15_000;
	let outputPath: string | undefined;
	let run = false;
	let piCommand = "pi";
	let workspace: string | undefined;
	let extension: string | undefined;

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--run") {
			run = true;
			continue;
		}
		const value = args[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
		index++;
		switch (argument) {
			case "--mode":
				if (!isOneOf(value, BENCHMARK_MODES)) throw new Error("--mode must be quick or extended");
				mode = value;
				break;
			case "--model":
				model = value.trim();
				break;
			case "--thinking":
				if (!isOneOf(value, BENCHMARK_THINKING_LEVELS)) {
					throw new Error(`Unsupported thinking level: ${value}`);
				}
				thinkingLevel = value;
				break;
			case "--timeout-ms":
				timeoutMs = positiveInteger(value, "--timeout-ms");
				break;
			case "--readiness-timeout-ms":
				readinessTimeoutMs = positiveInteger(value, "--readiness-timeout-ms");
				break;
			case "--output":
				outputPath = value;
				break;
			case "--pi":
				piCommand = value;
				break;
			case "--workspace":
				workspace = value;
				break;
			case "--extension":
				extension = value;
				break;
			default:
				throw new Error(`Unknown benchmark argument: ${argument}`);
		}
	}
	if (!model) throw new Error("--model is required so every paired trial uses one fixed model");
	if (run && !outputPath) throw new Error("--output is required with --run");
	return {
		mode,
		model,
		thinkingLevel,
		timeoutMs,
		readinessTimeoutMs,
		outputPath,
		run,
		piCommand,
		...(workspace ? { workspace } : {}),
		...(extension ? { extension } : {}),
	};
}

export function benchmarkPairCount(mode: AsyncSubagentBenchmarkMode): number {
	return mode === "quick" ? 3 : 10;
}

export function createAlternatingTrialPlan(
	mode: AsyncSubagentBenchmarkMode,
): AsyncSubagentBenchmarkTrialPlan[] {
	const trials: AsyncSubagentBenchmarkTrialPlan[] = [];
	for (let pairIndex = 0; pairIndex < benchmarkPairCount(mode); pairIndex++) {
		const order: readonly AsyncSubagentBenchmarkArm[] =
			pairIndex % 2 === 0 ? ["sync", "async"] : ["async", "sync"];
		for (const [orderIndex, arm] of order.entries()) {
			trials.push({ pairIndex, orderIndex, arm });
		}
	}
	return trials;
}

export function buildAsyncSubagentBenchmarkPrompt(
	arm: AsyncSubagentBenchmarkArm,
	thinkingLevel: AsyncSubagentBenchmarkThinkingLevel = "medium",
): string {
	const orchestration =
		arm === "sync"
			? [
					"Use the deprecated subagent tool in single mode exactly once with agent explorer.",
					`Set thinkingLevel to ${thinkingLevel}, pass the fixed task below, and wait for the blocking result.`,
				]
			: [
					"Use subagent_spawn exactly once with agent explorer, context none, and completionRequirement required.",
					`Set thinkingLevel to ${thinkingLevel}, continue only useful non-overlapping local work, and rely on automatic completion delivery without calling any blocking or inspection tool.`,
					"Do not provide the benchmark result before the retained completion is visible or terminal.",
				];
	return [
		"This is a non-interactive paired benchmark.",
		...orchestration,
		"Use the configured model without changing it.",
		"Fixed child task:",
		FIXED_BENCHMARK_TASK,
		"After observing the child result, answer concisely with all three requested findings.",
		`End with one single-line marker in this exact form: ${BENCHMARK_RESULT_PREFIX} {"complete":true}`,
	].join("\n\n");
}

export function parseBenchmarkJsonLines(source: string): unknown[] {
	const values: unknown[] = [];
	for (const [index, rawLine] of source.split("\n").entries()) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (!line) continue;
		try {
			values.push(JSON.parse(line));
		} catch {
			throw new Error(`Invalid benchmark JSONL at line ${index + 1}`);
		}
	}
	return values;
}

export function analyzeBenchmarkEvents(
	arm: AsyncSubagentBenchmarkArm,
	events: readonly unknown[],
): AsyncSubagentEventAnalysis {
	let completionIndex = -1;
	let spawnObserved = false;
	let prematureFinalCount = 0;
	let finalAnswer: string | undefined;
	let resultMarker: Record<string, unknown> | undefined;
	let finalIndex = -1;

	for (const [index, value] of events.entries()) {
		if (!isRecord(value)) continue;
		const message =
			value.type === "message_end" && isRecord(value.message) ? value.message : undefined;
		if (!message) continue;
		if (message.role === "custom" && message.customType === "pi-subagent-completion") {
			if (completionIndex < 0) completionIndex = index;
			continue;
		}
		if (message.role === "toolResult") {
			const toolName = typeof message.toolName === "string" ? message.toolName : "";
			const details = isRecord(message.details) ? message.details : undefined;
			if (toolName === "subagent_spawn" && message.isError !== true) spawnObserved = true;
			if (
				message.isError !== true &&
				details?.timedOut !== true &&
				((arm === "sync" && toolName === "subagent") ||
					(arm === "async" && toolName === "subagent_await"))
			) {
				if (completionIndex < 0) completionIndex = index;
			}
			continue;
		}
		if (message.role !== "assistant") continue;
		const content = Array.isArray(message.content) ? message.content : [];
		const hasToolCall = content.some(
			(item) => isRecord(item) && item.type === "toolCall" && typeof item.name === "string",
		);
		if (
			content.some(
				(item) => isRecord(item) && item.type === "toolCall" && item.name === "subagent_spawn",
			)
		) {
			spawnObserved = true;
		}
		const text = messageText(message);
		const marker = extractResultMarker(text);
		if (marker) {
			if (arm === "async" && spawnObserved && completionIndex < 0) prematureFinalCount++;
			finalAnswer = text;
			resultMarker = marker;
			finalIndex = index;
		} else if (
			arm === "async" &&
			spawnObserved &&
			completionIndex < 0 &&
			text.trim() &&
			!hasToolCall &&
			scoreBenchmarkEvidence(text).score > 0
		) {
			prematureFinalCount++;
		}
	}

	const score = scoreBenchmarkEvidence(finalAnswer ?? "");
	return {
		completionObserved: completionIndex >= 0 && (finalIndex < 0 || completionIndex < finalIndex),
		evidenceScore: score.score,
		matchedEvidence: score.matched,
		prematureFinalCount,
		...(finalAnswer ? { finalAnswer } : {}),
		...(resultMarker ? { resultMarker } : {}),
	};
}

export function scoreBenchmarkEvidence(text: string): { score: number; matched: string[] } {
	const normalized = text.toLowerCase().replaceAll("`", "");
	const matched = FIXED_EVIDENCE_RUBRIC.filter((item) =>
		item.terms.every((term) => normalized.includes(term.toLowerCase())),
	).map((item) => item.id);
	return {
		score: round(matched.length / FIXED_EVIDENCE_RUBRIC.length),
		matched,
	};
}

export function percentile(values: readonly number[], quantile: number): number {
	if (values.length === 0) throw new Error("Cannot calculate a percentile without values");
	if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
		throw new Error("Percentile quantile must be between zero and one");
	}
	const sorted = [...values].sort((left, right) => left - right);
	const position = (sorted.length - 1) * quantile;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return round(sorted[lower]);
	return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

export function summarizeAsyncSubagentBenchmark(
	records: readonly AsyncSubagentBenchmarkTrialRecord[],
): AsyncSubagentBenchmarkSummary {
	const summarizeArm = (arm: AsyncSubagentBenchmarkArm): AsyncSubagentArmSummary => {
		const selected = records.filter((record) => record.arm === arm);
		const completed = selected.filter((record) => record.outcome === "completed");
		const costs = selected.flatMap((record) => (record.cost === null ? [] : [record.cost]));
		const terminalOutcomes = emptyTerminalOutcomes();
		for (const record of selected) terminalOutcomes[record.outcome]++;
		return {
			trials: selected.length,
			completionCoverage:
				selected.length === 0
					? 0
					: round(selected.filter((record) => record.completionObserved).length / selected.length),
			evidenceScore:
				selected.length === 0
					? 0
					: round(
							selected.reduce((sum, record) => sum + record.evidenceScore, 0) / selected.length,
						),
			prematureFinalCount: selected.reduce((sum, record) => sum + record.prematureFinalCount, 0),
			terminalOutcomes,
			latencyMs:
				completed.length === 0
					? null
					: {
							median: percentile(
								completed.map((record) => record.elapsedMs),
								0.5,
							),
							p95: percentile(
								completed.map((record) => record.elapsedMs),
								0.95,
							),
						},
			cost:
				costs.length === 0
					? null
					: {
							available: costs.length,
							total: round(costs.reduce((sum, value) => sum + value, 0)),
							median: percentile(costs, 0.5),
							p95: percentile(costs, 0.95),
						},
		};
	};
	return {
		version: ASYNC_SUBAGENT_BENCHMARK_VERSION,
		pairs: new Set(records.map((record) => record.pairIndex)).size,
		arms: { sync: summarizeArm("sync"), async: summarizeArm("async") },
	};
}

export async function runAfterReadinessWithDeadline<T>(
	readiness: Promise<unknown>,
	run: () => Promise<T>,
	timeoutMs: number,
): Promise<T> {
	await readiness;
	return await withDeadline(run(), timeoutMs, "Benchmark trial timed out");
}

export async function withDeadline<T>(
	operation: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("Deadline must be positive");
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new BenchmarkDeadlineError(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function redactBenchmarkValue(value: unknown): unknown {
	return redactValue(value, new WeakSet<object>());
}

function extractResultMarker(text: string): Record<string, unknown> | undefined {
	for (const line of text.split("\n").reverse()) {
		const markerIndex = line.indexOf(BENCHMARK_RESULT_PREFIX);
		if (markerIndex < 0) continue;
		const source = line.slice(markerIndex + BENCHMARK_RESULT_PREFIX.length).trim();
		try {
			const parsed: unknown = JSON.parse(source);
			if (isRecord(parsed) && parsed.complete === true) return parsed;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function messageText(message: Record<string, unknown>): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.flatMap((item) =>
			isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : [],
		)
		.join("\n");
}

function emptyTerminalOutcomes(): Record<AsyncSubagentTerminalOutcome, number> {
	return {
		completed: 0,
		"invalid-output": 0,
		"timed-out": 0,
		"readiness-timeout": 0,
		"process-error": 0,
		"protocol-error": 0,
	};
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
	if (typeof value === "string") return redactString(value);
	if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
	if (!isRecord(value)) return value;
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	const redacted: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		redacted[key] = sensitiveKey(key) ? "[redacted]" : redactValue(item, seen);
	}
	return redacted;
}

function redactString(value: string): string {
	const home = process.env.HOME;
	let redacted = value.replace(/<private>[\s\S]*?<\/private>/giu, "[private content omitted]");
	redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, "Bearer [redacted]");
	redacted = redacted.replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/gu, "[redacted-key]");
	redacted = redacted.replace(
		/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))=([^\s]+)/gu,
		"$1=[redacted]",
	);
	if (home) redacted = redacted.split(home).join("$HOME");
	const limit = 16 * 1024;
	return redacted.length <= limit ? redacted : `${redacted.slice(0, limit)}\n[truncated]`;
}

function sensitiveKey(key: string): boolean {
	return /^(?:authorization|api[-_]?key|token|secret|password|headers|environment|env)$/iu.test(
		key,
	);
}

function positiveInteger(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: string, values: T): value is T[number] {
	return values.includes(value);
}

function round(value: number): number {
	return Number(value.toFixed(3));
}
