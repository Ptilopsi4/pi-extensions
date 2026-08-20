import assert from "node:assert/strict";
import { test } from "vitest";
import {
	captureRpcEvent,
	commitRpcInFlightUsage,
	createRpcTurnCapture,
	snapshotRpcUsage,
} from "../src/rpc-turn-capture.js";

function updateUsage(usage: unknown, delta = ""): Record<string, unknown> {
	return {
		type: "message_update",
		usage,
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
	};
}

function assistantStart(): Record<string, unknown> {
	return { type: "message_start", message: { role: "assistant", content: [] } };
}

function assistantEnd(usage?: unknown): Record<string, unknown> {
	return {
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			provider: "fake",
			model: "model",
			...(usage === undefined ? {} : { usage }),
			stopReason: "stop",
		},
	};
}

const firstUsage = {
	input: 10,
	output: 1,
	cacheRead: 2,
	cacheWrite: 3,
	totalTokens: 16,
	cost: { total: 0.1 },
};

const secondUsage = {
	input: 10,
	output: 4,
	cacheRead: 2,
	cacheWrite: 3,
	totalTokens: 19,
	cost: { total: 0.2 },
};

test("RPC capture replaces cumulative in-flight usage and deduplicates identical updates", () => {
	const capture = createRpcTurnCapture();
	assert.equal(captureRpcEvent(updateUsage(firstUsage, "a"), capture), true);
	assert.deepEqual(snapshotRpcUsage(capture), { ...firstUsage, cost: 0.1, turns: 0 });
	assert.equal(captureRpcEvent(updateUsage(firstUsage, "b"), capture), false);
	assert.equal(captureRpcEvent(updateUsage(secondUsage, "c"), capture), true);
	assert.deepEqual(snapshotRpcUsage(capture), { ...secondUsage, cost: 0.2, turns: 0 });
	assert.equal(capture.partial, "abc");
});

test("RPC capture reconciles one authoritative final usage without double counting", () => {
	const capture = createRpcTurnCapture();
	captureRpcEvent(updateUsage(firstUsage), capture);
	assert.equal(
		captureRpcEvent(
			assistantEnd({
				input: 12,
				output: 5,
				cacheRead: 2,
				cacheWrite: 3,
				totalTokens: 22,
				cost: { total: 0.3 },
			}),
			capture,
		),
		true,
	);
	assert.deepEqual(snapshotRpcUsage(capture), {
		input: 12,
		output: 5,
		cacheRead: 2,
		cacheWrite: 3,
		totalTokens: 22,
		cost: 0.3,
		turns: 1,
	});
});

test("RPC capture falls back to streaming usage when final usage is absent or invalid", () => {
	for (const usage of [undefined, {}, { input: -1, output: Number.POSITIVE_INFINITY }]) {
		const capture = createRpcTurnCapture();
		captureRpcEvent(updateUsage(firstUsage), capture);
		captureRpcEvent(assistantEnd(usage), capture);
		assert.deepEqual(snapshotRpcUsage(capture), {
			...firstUsage,
			cost: 0.1,
			turns: 1,
		});
	}
});

test("RPC capture treats valid zero final fields as authoritative over streaming usage", () => {
	const capture = createRpcTurnCapture();
	captureRpcEvent(updateUsage(firstUsage), capture);
	captureRpcEvent(assistantEnd({ input: 0, output: "bad", cost: { total: 0 } }), capture);
	assert.deepEqual(snapshotRpcUsage(capture), {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: 0,
		turns: 1,
	});
});

test("RPC capture ignores malformed fields and derives totals only when no valid total exists", () => {
	const capture = createRpcTurnCapture();
	assert.equal(
		captureRpcEvent(
			updateUsage({
				input: 4,
				output: "5",
				cacheRead: -1,
				cacheWrite: Number.MAX_SAFE_INTEGER + 1,
				totalTokens: Number.NaN,
				cost: { total: Number.NEGATIVE_INFINITY },
			}),
			capture,
		),
		true,
	);
	assert.deepEqual(snapshotRpcUsage(capture), {
		input: 4,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 4,
		cost: 0,
		turns: 0,
	});
	assert.equal(
		captureRpcEvent(
			updateUsage({ input: -1, output: Number.POSITIVE_INFINITY, cost: { total: "bad" } }),
			capture,
		),
		false,
	);
	assert.equal(captureRpcEvent(updateUsage({ input: 4, totalTokens: 0 }), capture), true);
	assert.equal(snapshotRpcUsage(capture).totalTokens, 0);
});

test("RPC capture aggregates multiple finalized assistant turns", () => {
	const capture = createRpcTurnCapture();
	captureRpcEvent(assistantStart(), capture);
	captureRpcEvent(
		updateUsage({ input: 3, output: 1, totalTokens: 4, cost: { total: 0.125 } }),
		capture,
	);
	captureRpcEvent(
		assistantEnd({ input: 3, output: 2, totalTokens: 5, cost: { total: 0.25 } }),
		capture,
	);
	captureRpcEvent(assistantStart(), capture);
	captureRpcEvent(
		updateUsage({ input: 7, output: 1, totalTokens: 8, cost: { total: 0.375 } }),
		capture,
	);
	captureRpcEvent(
		assistantEnd({ input: 7, output: 3, totalTokens: 10, cost: { total: 0.5 } }),
		capture,
	);
	assert.deepEqual(snapshotRpcUsage(capture), {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 15,
		cost: 0.75,
		turns: 2,
	});
});

test("RPC capture rolls interrupted usage into the next assistant attempt without adding a turn", () => {
	const capture = createRpcTurnCapture();
	captureRpcEvent(
		updateUsage({ input: 5, output: 2, totalTokens: 7, cost: { total: 0.25 } }),
		capture,
	);
	assert.equal(captureRpcEvent(assistantStart(), capture), false);
	assert.deepEqual(snapshotRpcUsage(capture), {
		input: 5,
		output: 2,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 7,
		cost: 0.25,
		turns: 0,
	});
	captureRpcEvent(
		updateUsage({ input: 3, output: 1, totalTokens: 4, cost: { total: 0.375 } }),
		capture,
	);
	captureRpcEvent(
		assistantEnd({ input: 3, output: 2, totalTokens: 5, cost: { total: 0.5 } }),
		capture,
	);
	assert.deepEqual(snapshotRpcUsage(capture), {
		input: 8,
		output: 4,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 12,
		cost: 0.75,
		turns: 1,
	});
});

test("RPC capture explicitly commits in-flight usage without mutating finalized-turn count", () => {
	const capture = createRpcTurnCapture();
	captureRpcEvent(updateUsage(firstUsage), capture);
	assert.equal(commitRpcInFlightUsage(capture), true);
	assert.equal(commitRpcInFlightUsage(capture), false);
	assert.deepEqual(snapshotRpcUsage(capture), { ...firstUsage, cost: 0.1, turns: 0 });
});

test("RPC capture does not count tool-result messages as assistant turns", () => {
	const capture = createRpcTurnCapture();
	captureRpcEvent(
		{
			type: "message_end",
			message: { role: "toolResult", content: [{ type: "text", text: "result" }] },
		},
		capture,
	);
	assert.deepEqual(snapshotRpcUsage(capture), {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: 0,
		turns: 0,
	});
});
