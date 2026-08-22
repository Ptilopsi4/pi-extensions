import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import planMode from "../src/plan/plan-mode.js";

async function linkedPlanFixture() {
	const mock = createMockPi({ activeTools: ["read", "edit"] });
	const handle = planMode(mock.pi, {
		readSettings: async () => ({ kind: "missing" }),
		implementationPlanRetention: "keep",
	});
	const context = createMockContext();
	await mock.events.get("session_start")?.[0]?.({}, context.ctx);
	await mock.commands.get("plan")?.handler("start", context.ctx);
	const complete = mock.tools.find((tool) => tool.name === "plan_mode_complete")?.execute as
		| ((...args: unknown[]) => Promise<unknown>)
		| undefined;
	assert.ok(complete);
	await complete(
		"complete",
		{ plan: "# Lifecycle Plan\n\nKeep this exact contract." },
		undefined,
		undefined,
		context.ctx,
	);
	await mock.commands.get("plan")?.handler("implement", context.ctx);
	const implementationId = handle.getState().activeImplementation?.id;
	assert.ok(implementationId);
	assert.equal(handle.linkImplementationToGoal(implementationId, "goal-1"), true);
	return { context, handle, mock };
}

test("every nonterminal Goal state retains and relinks the exact Plan", async () => {
	const { context, handle, mock } = await linkedPlanFixture();
	for (const [index, status] of [
		"active",
		"paused",
		"blocked",
		"usage_limited",
		"budget_limited",
	] as const) {
		const goalId = `goal-${index + 2}`;
		handle.handleGoalState({ goalId, status });
		assert.equal(handle.getState().activeImplementation?.goalId, goalId);
		const transformed = (await mock.events.get("context")?.[0]?.(
			{
				messages: [
					{ role: "compactionSummary", content: `Recovered ${status} work.` },
					{ role: "user", content: "Continue when permitted." },
				],
			},
			context.ctx,
		)) as { messages: unknown[] };
		assert.match(JSON.stringify(transformed.messages), /Lifecycle Plan/u);
	}
});

test("terminal Goal state clears matching and newly rotated linked IDs", async () => {
	for (const [goalId, status] of [
		["goal-1", "cleared"],
		["goal-rotated-at-terminal", "complete"],
	] as const) {
		const { handle } = await linkedPlanFixture();
		handle.handleGoalState({ goalId, status });
		assert.equal(handle.getState().activeImplementation, undefined);
	}
});
