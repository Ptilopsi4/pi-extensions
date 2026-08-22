import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { startFreshWorkflowImplementation } from "../src/handoff.js";

const REQUEST = {
	plan: "# Approved\n\n- Implement\n- Verify",
	source: "plan_mode_complete" as const,
	retention: "keep" as const,
	stateEntryType: "plan-mode-state",
	isCurrent: () => true,
};

test("fresh handoff cancellation leaves the source plan untouched", async () => {
	let setups = 0;
	const { ctx, notifications } = createMockContext({
		mode: "tui",
		hasUI: true,
		model: { provider: "test", id: "model" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) },
		sessionManager: { getSessionFile: () => "/tmp/source.jsonl" },
		newSession: async () => {
			setups += 1;
			return { cancelled: true };
		},
	});

	const result = await startFreshWorkflowImplementation(ctx, REQUEST);

	assert.deepEqual(result, { kind: "cancelled" });
	assert.equal(setups, 1);
	assert.match(notifications.at(-1)?.message ?? "", /source plan remains available/u);
});

test("stale ownership after the idle wait prevents session replacement", async () => {
	let current = true;
	let replacements = 0;
	const { ctx } = createMockContext({
		mode: "tui",
		hasUI: true,
		model: { provider: "test", id: "model" },
		waitForIdle: async () => {
			current = false;
		},
		newSession: async () => {
			replacements += 1;
			return { cancelled: false };
		},
	});

	const result = await startFreshWorkflowImplementation(ctx, {
		...REQUEST,
		isCurrent: () => current,
	});

	assert.deepEqual(result, { kind: "stale" });
	assert.equal(replacements, 0);
});

test("destination setup failure recovers a safe unmanaged kickoff in the new editor", async () => {
	const replacement = createMockContext({ mode: "tui", hasUI: true });
	let delivered = false;
	const { ctx } = createMockContext({
		mode: "tui",
		hasUI: true,
		model: { provider: "test", id: "model" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) },
		sessionManager: { getSessionFile: () => "/tmp/source.jsonl" },
		newSession: async (options: {
			setup?: (sessionManager: { appendCustomEntry(): void }) => Promise<void>;
			withSession?: (ctx: unknown) => Promise<void>;
		}) => {
			await options.setup?.({
				appendCustomEntry() {
					throw new Error("session persistence failed");
				},
			});
			await options.withSession?.({
				...(replacement.ctx as object),
				async sendUserMessage() {
					delivered = true;
				},
			});
			return { cancelled: false };
		},
	});

	const result = await startFreshWorkflowImplementation(ctx, REQUEST);

	assert.deepEqual(result, { kind: "partial" });
	assert.equal(delivered, false);
	assert.match(replacement.editorText, /# Approved/u);
	assert.doesNotMatch(replacement.editorText, /Goal mode is active/u);
	assert.match(replacement.notifications.at(-1)?.message ?? "", /could not be saved/u);
});

test("second destination state failure compensates the already-saved Plan state", async () => {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const replacement = createMockContext({ mode: "tui", hasUI: true });
	const { ctx } = createMockContext({
		mode: "tui",
		hasUI: true,
		model: { provider: "test", id: "model" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) },
		sessionManager: { getSessionFile: () => "/tmp/source.jsonl" },
		newSession: async (options: {
			setup?: (sessionManager: {
				appendCustomEntry(type: string, data: unknown): void;
			}) => Promise<void>;
			withSession?: (ctx: unknown) => Promise<void>;
		}) => {
			let publication = 0;
			await options.setup?.({
				appendCustomEntry(customType, data) {
					publication += 1;
					if (publication === 2) throw new Error("goal persistence failed");
					entries.push({ customType, data });
				},
			});
			await options.withSession?.(replacement.ctx);
			return { cancelled: false };
		},
	});

	const result = await startFreshWorkflowImplementation(ctx, REQUEST);

	assert.deepEqual(result, { kind: "partial" });
	assert.deepEqual(
		entries.map((entry) => entry.customType),
		["plan-mode-state", "plan-mode-state"],
	);
	const compensated = entries.at(-1)?.data as { activeImplementation?: unknown };
	assert.equal(compensated.activeImplementation, undefined);
	assert.doesNotMatch(replacement.editorText, /Goal mode is active/u);
	assert.match(replacement.editorText, /# Approved/u);
});

test("kickoff failure keeps both destination states for manual recovery", async () => {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const replacement = createMockContext({ mode: "tui", hasUI: true });
	const { ctx } = createMockContext({
		mode: "tui",
		hasUI: true,
		model: { provider: "test", id: "model" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) },
		sessionManager: { getSessionFile: () => "/tmp/source.jsonl" },
		newSession: async (options: {
			setup?: (sessionManager: {
				appendCustomEntry(type: string, data: unknown): void;
			}) => Promise<void>;
			withSession?: (ctx: unknown) => Promise<void>;
		}) => {
			await options.setup?.({
				appendCustomEntry(customType, data) {
					entries.push({ customType, data });
				},
			});
			await options.withSession?.({
				...(replacement.ctx as object),
				async sendUserMessage() {
					throw new Error("kickoff rejected");
				},
			});
			return { cancelled: false };
		},
	});

	const result = await startFreshWorkflowImplementation(ctx, REQUEST);

	assert.deepEqual(result, { kind: "partial" });
	assert.deepEqual(
		entries.map((entry) => entry.customType),
		["plan-mode-state", "goal-state"],
	);
	assert.match(replacement.notifications.at(-1)?.message ?? "", /retained Goal/u);
});

test("fresh handoff rejects unsupported modes before replacing the session", async () => {
	const { ctx } = createMockContext({ mode: "print", hasUI: false });
	await assert.rejects(
		async () => startFreshWorkflowImplementation(ctx, REQUEST),
		/unavailable in print\/JSON mode/u,
	);
});
