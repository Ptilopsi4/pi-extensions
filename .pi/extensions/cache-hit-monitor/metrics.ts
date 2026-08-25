import type { AssistantMessage, ModelCostRates, Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

const TREND_SAMPLE_COUNT = 8;
const MAX_LABEL_LENGTH = 60;

export interface CacheUsageRecord {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	promptTokens: number;
	hitRatePercent: number;
	uncachedRatePercent: number;
	promptCost: number | null;
	estimatedSavings: number | null;
}

export interface CacheSample extends CacheUsageRecord {
	epoch: number;
	timestamp: number;
	provider: string;
	model: string;
	inputUnitCost: number | null;
	cacheReadUnitCost: number | null;
	paidPromptUnitCost: number | null;
}

export interface CacheComparison {
	previousRequestNumber: number;
	hitRateDeltaPercent: number;
	hitRateLossPercent: number;
	promptTokenDelta: number;
	cacheReadDelta: number;
	reusablePrefixTokens: number;
	rebilledTokens: number;
	rebilledPercent: number | null;
	estimatedMissPremium: number | null;
	modelChanged: boolean;
	requestStartGapMs: number;
}

export interface CacheAggregate {
	requestCount: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	promptTokens: number;
	hitRatePercent: number | null;
	promptCost: number | null;
	estimatedSavings: number | null;
	rebilledTokens: number;
	estimatedMissPremium: number | null;
	bestHitRatePercent: number | null;
	worstHitRatePercent: number | null;
}

export interface CacheMonitorView {
	streaming: boolean;
	requestNumber: number;
	latest: CacheSample | null;
	comparison: CacheComparison | null;
	session: CacheAggregate;
	trend: number[];
}

export interface MonitorLine {
	role: "title" | "good" | "warning" | "bad" | "muted" | "dim";
	text: string;
}

export interface CollectedCacheSamples {
	samples: CacheSample[];
	summaryRecords: CacheUsageRecord[];
	currentEpoch: number;
}

export interface CacheMonitorViewOptions {
	activeEpoch?: number;
	summaryRecords?: readonly CacheUsageRecord[];
}

type CostRateResolver = (provider: string, model: string) => ModelCostRates | undefined;

export function collectCacheSamples(
	entries: readonly SessionEntry[],
	resolveCostRates: CostRateResolver = () => undefined,
): CollectedCacheSamples {
	const samples: CacheSample[] = [];
	const summaryRecords: CacheUsageRecord[] = [];
	let currentEpoch = 0;
	for (const entry of entries) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			const summaryRecord = entry.usage ? createCacheUsageRecord(entry.usage) : null;
			if (summaryRecord) summaryRecords.push(summaryRecord);
			currentEpoch += 1;
			continue;
		}
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const sample = createCacheSample(
			entry.message,
			currentEpoch,
			resolveCostRates(entry.message.provider, entry.message.model),
		);
		if (sample) samples.push(sample);
	}
	return { samples, summaryRecords, currentEpoch };
}

export function createCacheSample(
	message: AssistantMessage,
	epoch: number,
	costRates?: ModelCostRates,
): CacheSample | null {
	const usageRecord = createCacheUsageRecord(message.usage, costRates);
	if (!usageRecord) return null;

	const inputUnitCost = unitCost(
		usageRecord.input,
		finiteNumber(message.usage.cost?.input),
		costRates?.input,
	);
	const cacheReadUnitCost = unitCost(
		usageRecord.cacheRead,
		finiteNumber(message.usage.cost?.cacheRead),
		costRates?.cacheRead,
	);
	const paidPromptTokens = usageRecord.input + usageRecord.cacheWrite;
	const paidPromptCost = sumKnownCosts([
		componentCost(usageRecord.input, finiteNumber(message.usage.cost?.input), costRates?.input),
		componentCost(
			usageRecord.cacheWrite,
			finiteNumber(message.usage.cost?.cacheWrite),
			costRates?.cacheWrite,
		),
	]);
	const paidPromptUnitCost =
		paidPromptCost === null
			? null
			: unitCost(
					paidPromptTokens,
					paidPromptCost,
					costRates
						? weightedPaidRate(usageRecord.input, usageRecord.cacheWrite, costRates)
						: undefined,
				);

	return {
		...usageRecord,
		epoch,
		timestamp: finiteNumber(message.timestamp),
		provider: message.provider,
		model: message.model,
		inputUnitCost,
		cacheReadUnitCost,
		paidPromptUnitCost,
	};
}

export function cacheSamplesEqual(left: CacheSample, right: CacheSample): boolean {
	return (
		left.epoch === right.epoch &&
		left.timestamp === right.timestamp &&
		left.provider === right.provider &&
		left.model === right.model &&
		left.input === right.input &&
		left.cacheRead === right.cacheRead &&
		left.cacheWrite === right.cacheWrite &&
		left.promptCost === right.promptCost &&
		left.estimatedSavings === right.estimatedSavings &&
		left.inputUnitCost === right.inputUnitCost &&
		left.cacheReadUnitCost === right.cacheReadUnitCost &&
		left.paidPromptUnitCost === right.paidPromptUnitCost
	);
}

export function createCacheMonitorView(
	finalizedSamples: readonly CacheSample[],
	streamingSample?: CacheSample,
	options: CacheMonitorViewOptions = {},
): CacheMonitorView {
	const samples = streamingSample ? [...finalizedSamples, streamingSample] : [...finalizedSamples];
	const latest = samples.at(-1) ?? null;
	const activeEpoch = options.activeEpoch ?? latest?.epoch;
	const previousIndex =
		latest && latest.epoch === activeEpoch
			? findPreviousComparableIndex(samples, samples.length - 1, latest.epoch)
			: -1;
	const previous = previousIndex >= 0 ? samples[previousIndex] : undefined;

	return {
		streaming: streamingSample !== undefined,
		requestNumber: samples.length,
		latest,
		comparison:
			latest && previous ? compareCacheSamples(previous, latest, previousIndex + 1) : null,
		session: aggregateCacheSamples(samples, options.summaryRecords),
		trend: samples.slice(-TREND_SAMPLE_COUNT).map((sample) => sample.hitRatePercent),
	};
}

export function compareCacheSamples(
	previous: CacheSample,
	current: CacheSample,
	previousRequestNumber: number,
): CacheComparison | null {
	if (previous.epoch !== current.epoch) return null;
	const reusablePrefixTokens = Math.min(previous.promptTokens, current.promptTokens);
	const reusedTokens = Math.min(current.cacheRead, reusablePrefixTokens);
	const rebilledTokens = Math.max(0, reusablePrefixTokens - reusedTokens);
	const hitRateDeltaPercent = current.hitRatePercent - previous.hitRatePercent;
	const unitPremium =
		current.paidPromptUnitCost !== null && current.cacheReadUnitCost !== null
			? Math.max(0, current.paidPromptUnitCost - current.cacheReadUnitCost)
			: null;

	return {
		previousRequestNumber,
		hitRateDeltaPercent,
		hitRateLossPercent: Math.max(0, -hitRateDeltaPercent),
		promptTokenDelta: current.promptTokens - previous.promptTokens,
		cacheReadDelta: current.cacheRead - previous.cacheRead,
		reusablePrefixTokens,
		rebilledTokens,
		rebilledPercent:
			reusablePrefixTokens > 0 ? (rebilledTokens / reusablePrefixTokens) * 100 : null,
		estimatedMissPremium: unitPremium === null ? null : rebilledTokens * unitPremium,
		modelChanged: previous.provider !== current.provider || previous.model !== current.model,
		requestStartGapMs: Math.max(0, current.timestamp - previous.timestamp),
	};
}

export function aggregateCacheSamples(
	samples: readonly CacheSample[],
	additionalRecords: readonly CacheUsageRecord[] = [],
): CacheAggregate {
	let input = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let promptCost = 0;
	let promptCostKnown = true;
	let estimatedSavings = 0;
	let savingsKnown = true;
	let rebilledTokens = 0;
	let estimatedMissPremium = 0;
	let missPremiumKnown = false;
	let bestHitRatePercent: number | null = null;
	let worstHitRatePercent: number | null = null;

	const addUsage = (record: CacheUsageRecord): void => {
		input += record.input;
		cacheRead += record.cacheRead;
		cacheWrite += record.cacheWrite;
		if (record.promptCost === null) promptCostKnown = false;
		else promptCost += record.promptCost;
		if (record.estimatedSavings === null) savingsKnown = false;
		else estimatedSavings += record.estimatedSavings;
		bestHitRatePercent = Math.max(
			bestHitRatePercent ?? record.hitRatePercent,
			record.hitRatePercent,
		);
		worstHitRatePercent = Math.min(
			worstHitRatePercent ?? record.hitRatePercent,
			record.hitRatePercent,
		);
	};

	for (const sample of samples) addUsage(sample);
	for (const record of additionalRecords) addUsage(record);

	for (let index = 0; index < samples.length; index += 1) {
		const sample = samples[index];
		if (!sample) continue;
		const previousIndex = findPreviousComparableIndex(samples, index, sample.epoch);
		if (previousIndex < 0) continue;
		const previous = samples[previousIndex];
		if (!previous) continue;
		const comparison = compareCacheSamples(previous, sample, previousIndex + 1);
		if (!comparison) continue;
		rebilledTokens += comparison.rebilledTokens;
		if (comparison.estimatedMissPremium !== null) {
			estimatedMissPremium += comparison.estimatedMissPremium;
			missPremiumKnown = true;
		}
	}

	const requestCount = samples.length + additionalRecords.length;
	const promptTokens = input + cacheRead + cacheWrite;
	return {
		requestCount,
		input,
		cacheRead,
		cacheWrite,
		promptTokens,
		hitRatePercent: promptTokens > 0 ? (cacheRead / promptTokens) * 100 : null,
		promptCost: promptCostKnown ? promptCost : null,
		estimatedSavings: requestCount > 0 && savingsKnown ? estimatedSavings : null,
		rebilledTokens,
		estimatedMissPremium: missPremiumKnown ? estimatedMissPremium : null,
		bestHitRatePercent,
		worstHitRatePercent,
	};
}

export function formatMonitorLines(view: CacheMonitorView): MonitorLine[] {
	if (!view.latest) {
		return [
			{ role: "title", text: "Prompt cache · waiting for provider usage" },
			{
				role: "dim",
				text: "Hit = cacheRead / (input + cacheRead + cacheWrite). Live updates begin when usage is reported.",
			},
		];
	}

	const latest = view.latest;
	const comparison = view.comparison;
	const session = view.session;
	const live = view.streaming ? " · LIVE" : "";
	const lines: MonitorLine[] = [
		{
			role: "title",
			text: `Prompt cache${live} · request #${view.requestNumber} · ${sanitizeDisplayLabel(latest.provider)}/${sanitizeDisplayLabel(latest.model)}`,
		},
		{
			role: latest.hitRatePercent >= 80 ? "good" : latest.hitRatePercent >= 50 ? "warning" : "bad",
			text: [
				`Latest  hit ${formatPercent(latest.hitRatePercent)}`,
				comparison ? `Δ ${formatSignedPercent(comparison.hitRateDeltaPercent)}` : "Δ n/a",
				comparison ? `loss ${formatPercentagePoints(comparison.hitRateLossPercent)}` : "loss n/a",
				`uncached ${formatPercent(latest.uncachedRatePercent)}`,
			].join("  ·  "),
		},
		{
			role: "muted",
			text: [
				`Tokens  prompt ${formatTokens(latest.promptTokens)}`,
				`read ${formatTokens(latest.cacheRead)}`,
				`write ${formatTokens(latest.cacheWrite)}`,
				`uncached ${formatTokens(latest.input)}`,
				comparison ? `prompt Δ ${formatSignedTokens(comparison.promptTokenDelta)}` : "prompt Δ n/a",
			].join("  ·  "),
		},
	];

	if (comparison) {
		lines.push({
			role: comparison.rebilledTokens > 0 ? "warning" : "good",
			text: [
				`Reuse vs #${comparison.previousRequestNumber}`,
				`eligible ${formatTokens(comparison.reusablePrefixTokens)}`,
				`re-billed ${formatTokens(comparison.rebilledTokens)} (${formatNullablePercent(comparison.rebilledPercent)})`,
				`read Δ ${formatSignedTokens(comparison.cacheReadDelta)}`,
				comparison.modelChanged ? "model changed" : "same model",
				`start gap ${formatDuration(comparison.requestStartGapMs)}`,
			].join("  ·  "),
		});
	} else {
		lines.push({
			role: "dim",
			text: "Reuse  no comparable request in the current cache epoch (session start or compaction boundary).",
		});
	}

	lines.push(
		{
			role: "muted",
			text: [
				`Cost  prompt ${formatNullableMoney(latest.promptCost)}`,
				`cache saved ~${formatNullableMoney(latest.estimatedSavings)}`,
				`miss premium ~${formatNullableMoney(comparison?.estimatedMissPremium ?? null)}`,
			].join("  ·  "),
		},
		{
			role: "muted",
			text: [
				`Session  ${session.requestCount} req`,
				`hit ${formatNullablePercent(session.hitRatePercent)}`,
				`read ${formatTokens(session.cacheRead)}`,
				`uncached ${formatTokens(session.input)}`,
				`write ${formatTokens(session.cacheWrite)}`,
				`cost ${formatNullableMoney(session.promptCost)}`,
				`saved ~${formatNullableMoney(session.estimatedSavings)}`,
				`re-billed ${formatTokens(session.rebilledTokens)} (~${formatNullableMoney(session.estimatedMissPremium)})`,
			].join("  ·  "),
		},
		{
			role: "dim",
			text: `Trend old→new  ${view.trend.map(formatPercent).join(" → ")}`,
		},
		{
			role: "dim",
			text: "Formula  hit=read/prompt · re-billed=max(0, min(previous prompt, current prompt) - current read); costs are estimates from reported/model rates.",
		},
	);
	return lines;
}

export function sanitizeDisplayLabel(value: string): string {
	const stripped = stripTerminalSequences(value)
		.replace(/[^\p{L}\p{N}_.:/@+\- ]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!stripped) return "unknown";
	const characters = [...stripped];
	return characters.length > MAX_LABEL_LENGTH
		? `${characters.slice(0, MAX_LABEL_LENGTH).join("")}…`
		: stripped;
}

function createCacheUsageRecord(usage: Usage, costRates?: ModelCostRates): CacheUsageRecord | null {
	const input = finiteNumber(usage.input);
	const cacheRead = finiteNumber(usage.cacheRead);
	const cacheWrite = finiteNumber(usage.cacheWrite);
	const promptTokens = input + cacheRead + cacheWrite;
	if (promptTokens <= 0) return null;

	const inputCost = finiteNumber(usage.cost?.input);
	const cacheReadCost = finiteNumber(usage.cost?.cacheRead);
	const cacheWriteCost = finiteNumber(usage.cost?.cacheWrite);
	const inputUnitCost = unitCost(input, inputCost, costRates?.input);
	const cacheReadUnitCost = unitCost(cacheRead, cacheReadCost, costRates?.cacheRead);

	return {
		input,
		cacheRead,
		cacheWrite,
		promptTokens,
		hitRatePercent: (cacheRead / promptTokens) * 100,
		uncachedRatePercent: (input / promptTokens) * 100,
		promptCost: sumKnownCosts([
			componentCost(input, inputCost, costRates?.input),
			componentCost(cacheRead, cacheReadCost, costRates?.cacheRead),
			componentCost(cacheWrite, cacheWriteCost, costRates?.cacheWrite),
		]),
		estimatedSavings:
			inputUnitCost !== null && cacheReadUnitCost !== null
				? cacheRead * Math.max(0, inputUnitCost - cacheReadUnitCost)
				: null,
	};
}

function findPreviousComparableIndex(
	samples: readonly CacheSample[],
	currentIndex: number,
	epoch: number,
): number {
	for (let index = currentIndex - 1; index >= 0; index -= 1) {
		const candidate = samples[index];
		if (!candidate) continue;
		if (candidate.epoch === epoch) return index;
		if (candidate.epoch < epoch) return -1;
	}
	return -1;
}

function weightedPaidRate(input: number, cacheWrite: number, rates: ModelCostRates): number {
	const tokens = input + cacheWrite;
	if (tokens <= 0) return rates.input;
	return (input * rates.input + cacheWrite * rates.cacheWrite) / tokens;
}

function componentCost(tokens: number, reportedCost: number, fallbackRate?: number): number | null {
	if (tokens <= 0) return 0;
	if (reportedCost > 0) return reportedCost;
	return fallbackRate === undefined ? null : (tokens * fallbackRate) / 1_000_000;
}

function sumKnownCosts(costs: readonly (number | null)[]): number | null {
	return costs.every((cost) => cost !== null)
		? costs.reduce<number>((total, cost) => total + (cost ?? 0), 0)
		: null;
}

function unitCost(tokens: number, cost: number, fallbackRate?: number): number | null {
	if (tokens > 0 && cost > 0) return cost / tokens;
	return fallbackRate === undefined ? null : fallbackRate / 1_000_000;
}

function formatPercent(value: number): string {
	return `${value.toFixed(1)}%`;
}

function formatNullablePercent(value: number | null): string {
	return value === null ? "n/a" : formatPercent(value);
}

function formatSignedPercent(value: number): string {
	const sign = value > 0 ? "+" : "";
	return `${sign}${formatPercentagePoints(value)}`;
}

function formatPercentagePoints(value: number): string {
	return `${value.toFixed(1)} pp`;
}

function formatTokens(value: number): string {
	const absolute = Math.abs(value);
	if (absolute < 1_000) return Math.round(value).toLocaleString("en-US");
	if (absolute < 1_000_000) return `${trimFixed(value / 1_000)}k`;
	return `${trimFixed(value / 1_000_000)}m`;
}

function formatSignedTokens(value: number): string {
	return `${value > 0 ? "+" : ""}${formatTokens(value)}`;
}

function trimFixed(value: number): string {
	return value.toFixed(Math.abs(value) >= 100 ? 0 : 1).replace(/\.0$/, "");
}

function formatMoney(value: number): string {
	if (value === 0) return "$0.0000";
	if (value < 0.0001) return "<$0.0001";
	return `$${value.toFixed(value < 0.01 ? 4 : 3)}`;
}

function formatNullableMoney(value: number | null): string {
	return value === null ? "n/a" : formatMoney(value);
}

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
	if (milliseconds < 60_000) return `${trimFixed(milliseconds / 1_000)}s`;
	return `${trimFixed(milliseconds / 60_000)}m`;
}

function finiteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
