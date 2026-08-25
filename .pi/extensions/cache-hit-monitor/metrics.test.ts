import assert from "node:assert/strict";
import type { AssistantMessage, ModelCostRates } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import {
	aggregateCacheSamples,
	collectCacheSamples,
	compareCacheSamples,
	createCacheMonitorView,
	createCacheSample,
	formatMonitorLines,
	sanitizeDisplayLabel,
} from "./metrics.js";

const RATES: ModelCostRates = {
	input: 10,
	output: 20,
	cacheRead: 1,
	cacheWrite: 20,
};

function assistant(
	input: number,
	cacheRead: number,
	cacheWrite: number,
	overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "test-provider",
		model: "test-model",
		content: [],
		stopReason: "stop",
		timestamp: 1_000,
		usage: {
			input,
			output: 10,
			cacheRead,
			cacheWrite,
			totalTokens: input + cacheRead + cacheWrite + 10,
			cost: {
				input: (input * RATES.input) / 1_000_000,
				output: (10 * RATES.output) / 1_000_000,
				cacheRead: (cacheRead * RATES.cacheRead) / 1_000_000,
				cacheWrite: (cacheWrite * RATES.cacheWrite) / 1_000_000,
				total:
					(input * RATES.input +
						10 * RATES.output +
						cacheRead * RATES.cacheRead +
						cacheWrite * RATES.cacheWrite) /
					1_000_000,
			},
		},
		...overrides,
	};
}

function messageEntry(message: AssistantMessage): SessionEntry {
	return { type: "message", id: crypto.randomUUID(), parentId: null, message } as SessionEntry;
}

test("calculates hit rate, downward loss, re-billed tokens, and estimated cost impact", () => {
	const previous = createCacheSample(assistant(200, 800, 0), 0, RATES);
	const current = createCacheSample(assistant(400, 600, 100, { timestamp: 3_500 }), 0, RATES);
	assert.ok(previous);
	assert.ok(current);

	const comparison = compareCacheSamples(previous, current, 1);
	assert.ok(comparison);
	assert.equal(previous.hitRatePercent, 80);
	assert.ok(Math.abs(current.hitRatePercent - 54.545_454) < 0.000_01);
	assert.ok(Math.abs(comparison.hitRateDeltaPercent + 25.454_545) < 0.000_01);
	assert.ok(Math.abs(comparison.hitRateLossPercent - 25.454_545) < 0.000_01);
	assert.equal(comparison.reusablePrefixTokens, 1_000);
	assert.equal(comparison.rebilledTokens, 400);
	assert.equal(comparison.rebilledPercent, 40);
	assert.ok(Math.abs((comparison.estimatedMissPremium ?? 0) - 0.0044) < 0.000_000_1);
	assert.equal(comparison.promptTokenDelta, 100);
	assert.equal(comparison.cacheReadDelta, -200);
	assert.equal(comparison.idleMs, 2_500);
});

test("uses weighted session totals and excludes cross-compaction comparisons", () => {
	const first = createCacheSample(assistant(200, 800, 0), 0, RATES);
	const second = createCacheSample(assistant(400, 600, 100), 0, RATES);
	const afterCompaction = createCacheSample(assistant(900, 100, 0), 1, RATES);
	assert.ok(first && second && afterCompaction);

	const aggregate = aggregateCacheSamples([first, second, afterCompaction]);
	assert.equal(aggregate.requestCount, 3);
	assert.equal(aggregate.input, 1_500);
	assert.equal(aggregate.cacheRead, 1_500);
	assert.equal(aggregate.cacheWrite, 100);
	assert.ok(Math.abs((aggregate.hitRatePercent ?? 0) - (1_500 / 3_100) * 100) < 0.000_01);
	assert.equal(aggregate.rebilledTokens, 400);
	assert.ok(Math.abs((aggregate.estimatedMissPremium ?? 0) - 0.0044) < 0.000_000_1);
	assert.equal(compareCacheSamples(second, afterCompaction, 2), null);
});

test("reconstructs cache epochs from the active branch", () => {
	const entries = [
		messageEntry(assistant(200, 800, 0)),
		{ type: "compaction", id: "compact", parentId: null },
		messageEntry(assistant(900, 100, 0, { timestamp: 2_000 })),
	] as SessionEntry[];
	const restored = collectCacheSamples(entries, () => RATES);

	assert.equal(restored.currentEpoch, 1);
	assert.deepEqual(
		restored.samples.map(({ epoch, hitRatePercent }) => [epoch, hitRatePercent]),
		[
			[0, 80],
			[1, 10],
		],
	);
	const view = createCacheMonitorView(restored.samples);
	assert.equal(view.comparison, null);
	assert.equal(view.session.requestCount, 2);
});

test("formats a detailed live report with both rate and token loss", () => {
	const previous = createCacheSample(assistant(200, 800, 0), 0, RATES);
	const current = createCacheSample(assistant(400, 600, 100, { timestamp: 3_500 }), 0, RATES);
	assert.ok(previous && current);
	const lines = formatMonitorLines(createCacheMonitorView([previous], current)).map(
		({ text }) => text,
	);

	assert.match(lines[0] ?? "", /Prompt cache · LIVE · request #2/);
	assert.match(lines[1] ?? "", /hit 54\.5%.*Δ -25\.5 pp.*loss 25\.5 pp.*uncached 36\.4%/);
	assert.match(lines[2] ?? "", /prompt 1\.1k.*read 600.*write 100.*uncached 400/);
	assert.match(lines[3] ?? "", /eligible 1k.*re-billed 400 \(40\.0%\).*read Δ -200/);
	assert.match(lines[4] ?? "", /cache saved ~\$0\.0054.*miss premium ~\$0\.0044/);
	assert.match(lines[5] ?? "", /Session {2}2 req.*re-billed 400/);
	assert.match(lines[6] ?? "", /80\.0% → 54\.5%/);
	assert.match(lines[7] ?? "", /re-billed=max/);
});

test("sanitizes terminal controls and bounds provider/model labels", () => {
	assert.equal(sanitizeDisplayLabel("\u001b]8;;bad\u0007provider\n\u202emodel"), "provider model");
	assert.equal(sanitizeDisplayLabel("\u001b\u0007"), "unknown");
	assert.equal(sanitizeDisplayLabel("x".repeat(80)), `${"x".repeat(60)}…`);
});
