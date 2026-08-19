import assert from "node:assert/strict";
import type { KeyId } from "@earendil-works/pi-tui";
import { test } from "vitest";
import { builtinTool, createMockContext, createMockPi } from "../../../test/support.js";
import { serializeGoalState } from "../src/goal/persistence.js";
import { createGoal } from "../src/goal/runtime.js";
import { DEFAULT_GOAL_SETTINGS } from "../src/goal/settings.js";
import { startFreshWorkflowImplementation, WORKFLOW_GOAL_OBJECTIVE } from "../src/handoff.js";
import type { WorkflowSettingsLoadResult } from "../src/settings.js";
import workflow from "../src/workflow.js";

const BASE_TOOLS = ["read", "bash", "edit", "write"];
const GOAL_TOOLS = ["goal_complete", "goal_blocked", "goal_wait"];

async function emitAll(
	mock: ReturnType<typeof createMockPi>,
	name: string,
	event: unknown,
	ctx: unknown,
) {
	for (const handler of mock.events.get(name) ?? []) await handler(event, ctx);
}

function setup(
	readSettings: NonNullable<Parameters<typeof workflow>[1]>["readSettings"] = () => ({
		kind: "missing",
	}),
	contextOptions: Parameters<typeof createMockContext>[0] = {},
) {
	const mock = createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	workflow(mock.pi, { readSettings });
	const context = createMockContext({ mode: "tui", hasUI: true, ...contextOptions });
	return { mock, ...context };
}

async function transformContext(
	fixture: ReturnType<typeof setup>,
	messages: unknown[],
): Promise<unknown[]> {
	let transformedMessages = messages;
	for (const handler of fixture.mock.events.get("context") ?? []) {
		const transformed = (await handler({ messages: transformedMessages }, fixture.ctx)) as
			| { messages?: unknown[] }
			| undefined;
		transformedMessages = transformed?.messages ?? transformedMessages;
	}
	return transformedMessages;
}

async function startLinkedWorkflow(fixture: ReturnType<typeof setup>, plan = "# Approved") {
	await emitAll(fixture.mock, "session_start", { reason: "startup" }, fixture.ctx);
	await fixture.mock.commands.get("plan")?.handler("start", fixture.ctx);
	const complete = fixture.mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	await (complete.execute as (...args: unknown[]) => Promise<unknown>)(
		"plan-call",
		{ plan },
		undefined,
		undefined,
		fixture.ctx,
	);
	await fixture.mock.commands.get("plan")?.handler("implement", fixture.ctx);
}

test("workflow registers one manager plus the compatible Plan and Goal surfaces", () => {
	const { mock } = setup();

	assert.deepEqual([...mock.commands.keys()], ["goal", "plan", "workflow"]);
	assert.deepEqual(
		mock.tools.map((tool) => tool.name),
		["goal_complete", "goal_blocked", "goal_wait", "plan_mode_question", "plan_mode_complete"],
	);
	assert.ok(mock.flags.has("plan"));
});

test("workflow command is menu-only with observable mode handling", async () => {
	const { mock } = setup();
	const tui = createMockContext({
		mode: "tui",
		hasUI: true,
		select: async (_title: string, options: string[]) =>
			options.find((option) => option.startsWith("Close")),
	});
	await emitAll(mock, "session_start", { reason: "startup" }, tui.ctx);
	await mock.commands.get("workflow")?.handler("", tui.ctx);
	assert.ok(tui.notifications.some((notice) => /experimental/i.test(notice.message)));

	await mock.commands.get("workflow")?.handler("unknown", tui.ctx);
	assert.match(tui.notifications.at(-1)?.message ?? "", /does not accept arguments/u);

	const print = createMockContext({ mode: "print", hasUI: false });
	await assert.rejects(
		async () => mock.commands.get("workflow")?.handler("", print.ctx),
		/requires TUI or RPC/u,
	);
});

test("an approved Plan starts Goal with one exact combined implementation request", async () => {
	const { mock, ctx } = setup();
	await emitAll(mock, "session_start", { reason: "startup" }, ctx);
	await mock.commands.get("plan")?.handler("start", ctx);

	const complete = mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	const execute = complete.execute as (...args: unknown[]) => Promise<unknown>;
	await execute(
		"plan-call",
		{ plan: "# Ship it\n\n- Implement\n- Verify" },
		undefined,
		undefined,
		ctx,
	);
	await emitAll(mock, "agent_settled", {}, ctx);
	await mock.commands.get("plan")?.handler("implement", ctx);

	assert.equal(mock.sentUserMessages.length, 1);
	const handoff = mock.sentUserMessages[0]?.text ?? "";
	assert.match(handoff, /^Plan mode is now disabled\./u);
	assert.match(handoff, /# Ship it\n\n- Implement\n- Verify/u);
	assert.match(handoff, /Goal mode is active\. Complete this goal fully:/u);
	assert.match(handoff, /<goal_id>\n[^\n]+\n<\/goal_id>/u);
	assert.match(handoff, /pi-goal-prompt:/u);
	let messages: unknown[] = [{ role: "user", content: [{ type: "text", text: handoff }] }];
	for (const handler of mock.events.get("context") ?? []) {
		const transformed = (await handler({ messages }, ctx)) as { messages?: unknown[] } | undefined;
		messages = transformed?.messages ?? messages;
	}
	assert.equal(
		messages.some(
			(message) =>
				(message as { role?: string }).role === "user" &&
				JSON.stringify(message).includes("# Ship it"),
		),
		true,
	);
	assert.equal(
		messages.some(
			(message) =>
				(message as { customType?: string }).customType === "plan-mode-implementation-context",
		),
		false,
	);

	const planState = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: { goalId?: string; plan?: string } };
	const goalState = mock.entries.filter((entry) => entry.customType === "goal-state").at(-1)
		?.data as { goal?: { id?: string; status?: string; text?: string } };
	assert.equal(planState.activeImplementation?.plan, "# Ship it\n\n- Implement\n- Verify");
	assert.equal(planState.activeImplementation?.goalId, goalState.goal?.id);
	assert.equal(goalState.goal?.status, "active");
	assert.equal(goalState.goal?.text, "Implement and verify the approved Plan-mode plan.");
});

test("Plan-only actions do not execute until Implement starts Goal", async () => {
	const fixture = setup(undefined, {
		model: { provider: "test", id: "model" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) },
	});
	await emitAll(fixture.mock, "session_start", { reason: "startup" }, fixture.ctx);
	await fixture.mock.commands.get("plan")?.handler("start", fixture.ctx);
	const complete = fixture.mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	await (complete.execute as (...args: unknown[]) => Promise<unknown>)(
		"plan-call",
		{ plan: "# Saved before execution" },
		undefined,
		undefined,
		fixture.ctx,
	);
	await fixture.mock.commands.get("plan")?.handler("save", fixture.ctx);
	assert.equal(fixture.mock.entries.filter((entry) => entry.customType === "goal-state").length, 0);
	const saved = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { savedPlan?: { plan?: string } };
	assert.equal(saved.savedPlan?.plan, "# Saved before execution");

	await fixture.mock.commands.get("plan")?.handler("implement", fixture.ctx);
	const activeGoal = fixture.mock.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data as { goal?: { status?: string } };
	assert.equal(activeGoal.goal?.status, "active");
	const linkedPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: { goalId?: string } };
	assert.ok(linkedPlan.activeImplementation?.goalId);
});

test("paused and resumed Goal states retain and relink the approved Plan", async () => {
	const { mock, ctx } = setup();
	await emitAll(mock, "session_start", { reason: "startup" }, ctx);
	await mock.commands.get("plan")?.handler("start", ctx);
	const planComplete = mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(planComplete);
	await (planComplete.execute as (...args: unknown[]) => Promise<unknown>)(
		"plan-call",
		{ plan: "# Resume safely" },
		undefined,
		undefined,
		ctx,
	);
	await mock.commands.get("plan")?.handler("implement", ctx);
	const initialPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: { goalId?: string } };
	const initialGoalId = initialPlan.activeImplementation?.goalId;
	assert.ok(initialGoalId);

	await mock.commands.get("goal")?.handler("pause", ctx);
	const pausedPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: { goalId?: string } };
	assert.equal(pausedPlan.activeImplementation?.goalId, initialGoalId);

	await mock.commands.get("goal")?.handler("resume", ctx);
	const resumedGoalState = mock.entries.filter((entry) => entry.customType === "goal-state").at(-1)
		?.data as { goal?: { id?: string } } | undefined;
	const resumedGoal = resumedGoalState?.goal;
	const resumedPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: { goalId?: string } };
	assert.notEqual(resumedGoal?.id, initialGoalId);
	assert.equal(resumedPlan.activeImplementation?.goalId, resumedGoal?.id);
});

test("stopped Goal ID rotation keeps Plan cleanup linked", async () => {
	const fixture = setup();
	await startLinkedWorkflow(fixture, "# Edit safely");
	await fixture.mock.commands.get("goal")?.handler("pause", fixture.ctx);
	await fixture.mock.commands
		.get("goal")
		?.handler("edit Implement and verify the approved Plan-mode plan.", fixture.ctx);
	await fixture.mock.commands.get("goal")?.handler("clear", fixture.ctx);

	const finalPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
});

test("budget-only Goal edits retain and relink the exact Plan", async () => {
	const fixture = setup();
	await startLinkedWorkflow(fixture, "# Keep through budget edit");
	const initialPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: { goalId?: string } };
	const initialGoalId = initialPlan.activeImplementation?.goalId;
	assert.ok(initialGoalId);

	await fixture.mock.commands
		.get("goal")
		?.handler(`edit --tokens 20 ${WORKFLOW_GOAL_OBJECTIVE}`, fixture.ctx);

	const editedGoal = fixture.mock.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data as { goal?: { id?: string; text?: string; tokenBudget?: number } };
	const retainedPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: { goalId?: string; plan?: string } };
	assert.notEqual(editedGoal.goal?.id, initialGoalId);
	assert.equal(editedGoal.goal?.text, WORKFLOW_GOAL_OBJECTIVE);
	assert.equal(editedGoal.goal?.tokenBudget, 20);
	assert.equal(retainedPlan.activeImplementation?.goalId, editedGoal.goal?.id);
	assert.equal(retainedPlan.activeImplementation?.plan, "# Keep through budget edit");
	const compactedContext = await transformContext(fixture, [
		{ role: "compactionSummary", content: "Budget changed after earlier work." },
		{ role: "user", content: "Continue within the updated budget." },
	]);
	assert.match(JSON.stringify(compactedContext), /Keep through budget edit/u);

	await fixture.mock.commands.get("goal")?.handler("clear", fixture.ctx);
	const clearedPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: unknown };
	assert.equal(clearedPlan.activeImplementation, undefined);
});

test("failed resume relinks the restored Goal so clear still removes Plan", async () => {
	const fixture = setup();
	await startLinkedWorkflow(fixture, "# Resume rollback");
	await fixture.mock.commands.get("goal")?.handler("pause", fixture.ctx);
	fixture.mock.rawPi.sendUserMessage = () => {
		throw new Error("delivery failed");
	};
	await fixture.mock.commands.get("goal")?.handler("resume", fixture.ctx);
	await fixture.mock.commands.get("goal")?.handler("clear", fixture.ctx);

	const finalPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
});

test("failed Goal edit restores both the previous Goal and linked Plan", async () => {
	const fixture = setup();
	await startLinkedWorkflow(fixture, "# Edit rollback");
	fixture.mock.rawPi.sendUserMessage = () => {
		throw new Error("delivery failed");
	};
	await fixture.mock.commands.get("goal")?.handler("edit Different objective", fixture.ctx);

	const restoredPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: { goalId?: string } };
	const restoredGoal = fixture.mock.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data as { goal?: { id?: string; status?: string; text?: string } };
	assert.equal(restoredGoal.goal?.status, "paused");
	assert.equal(restoredGoal.goal?.text, "Implement and verify the approved Plan-mode plan.");
	assert.equal(restoredPlan.activeImplementation?.goalId, restoredGoal.goal?.id);
});

test("successful Goal objective supersession clears the linked Plan", async () => {
	const fixture = setup();
	await startLinkedWorkflow(fixture, "# Superseded");
	await fixture.mock.commands.get("goal")?.handler("edit Unrelated objective", fixture.ctx);
	const finalPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
});

test("legacy short retention cannot detach a Plan from its linked Goal", async () => {
	for (const retention of ["clear-on-start", "clear-after-first-run"] as const) {
		const fixture = setup(() => ({
			kind: "loaded",
			settings: {
				planHandoff: "review",
				plan: { thinkingLevel: "inherit", implementationPlanRetention: retention },
				goal: structuredClone(DEFAULT_GOAL_SETTINGS),
			},
		}));
		await startLinkedWorkflow(fixture, `# Retain through Goal\n\nPolicy: ${retention}`);

		const compactedContext = await transformContext(fixture, [
			{ role: "compactionSummary", content: "Earlier implementation work was compacted." },
			{ role: "user", content: "Continue the linked Goal." },
		]);
		assert.equal(
			compactedContext.filter(
				(message) =>
					(message as { customType?: string }).customType === "plan-mode-implementation-context",
			).length,
			1,
		);
		assert.match(JSON.stringify(compactedContext), /Retain through Goal/u);
		const repeatedContext = await transformContext(fixture, [
			{ role: "branchSummary", content: "A branch summary remains first." },
			...compactedContext,
		]);
		assert.equal(
			repeatedContext.filter(
				(message) =>
					(message as { customType?: string }).customType === "plan-mode-implementation-context",
			).length,
			1,
		);
		const firstNonSummary = repeatedContext.findIndex(
			(message) =>
				!["branchSummary", "compactionSummary"].includes((message as { role?: string }).role ?? ""),
		);
		assert.equal(
			(repeatedContext[firstNonSummary] as { customType?: string }).customType,
			"plan-mode-implementation-context",
		);

		await fixture.mock.commands.get("goal")?.handler("pause", fixture.ctx);
		const pausedContext = await transformContext(fixture, [
			{ role: "compactionSummary", content: "Paused after compaction." },
			{ role: "user", content: "Inspect the paused workflow." },
		]);
		assert.match(JSON.stringify(pausedContext), /Retain through Goal/u);
		await fixture.mock.commands.get("goal")?.handler("resume", fixture.ctx);
		await emitAll(fixture.mock, "agent_settled", {}, fixture.ctx);
		const retainedPlan = fixture.mock.entries
			.filter((entry) => entry.customType === "plan-mode-state")
			.at(-1)?.data as { activeImplementation?: { goalId?: string; retention?: string } };
		assert.ok(retainedPlan.activeImplementation?.goalId);
		assert.equal(retainedPlan.activeImplementation.retention, "keep");

		await fixture.mock.commands.get("goal")?.handler("clear", fixture.ctx);
		const laterContext = await transformContext(fixture, [
			{ role: "compactionSummary", content: "Goal ended." },
			{ role: "user", content: "Start unrelated work." },
		]);
		assert.doesNotMatch(JSON.stringify(laterContext), /Retain through Goal/u);
	}
});

test("plan exit cannot detach an active linked Goal", async () => {
	const fixture = setup();
	await startLinkedWorkflow(fixture, "# Keep linked");

	await fixture.mock.commands.get("plan")?.handler("exit", fixture.ctx);

	const retainedPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: { goalId?: string } };
	assert.ok(retainedPlan.activeImplementation?.goalId);
	assert.match(fixture.notifications.at(-1)?.message ?? "", /linked Goal.*\/goal clear/iu);
	const retainedGoal = fixture.mock.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data as { goal?: { status?: string } };
	assert.equal(retainedGoal.goal?.status, "active");

	const print = createMockContext({ mode: "print", hasUI: false });
	await assert.rejects(
		async () => fixture.mock.commands.get("plan")?.handler("exit", print.ctx),
		/linked Goal.*\/goal clear/iu,
	);
});

test("Goal completion clears the linked implementation Plan", async () => {
	const { mock, ctx, statuses } = setup();
	await emitAll(mock, "session_start", { reason: "startup" }, ctx);
	await mock.commands.get("plan")?.handler("start", ctx);
	const planComplete = mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(planComplete);
	await (planComplete.execute as (...args: unknown[]) => Promise<unknown>)(
		"plan-call",
		{ plan: "# Finish cleanly" },
		undefined,
		undefined,
		ctx,
	);
	await mock.commands.get("plan")?.handler("implement", ctx);
	const activeGoalState = mock.entries.filter((entry) => entry.customType === "goal-state").at(-1)
		?.data as { goal?: { id?: string } } | undefined;
	const activeGoal = activeGoalState?.goal;
	assert.ok(activeGoal?.id);
	const goalComplete = mock.tools.find((tool) => tool.name === "goal_complete");
	assert.ok(goalComplete);

	await (goalComplete.execute as (...args: unknown[]) => Promise<unknown>)(
		"goal-call",
		{ goal_id: activeGoal.id, summary: "Implemented and verified every approved requirement." },
		undefined,
		undefined,
		ctx,
	);

	const finalPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
	assert.equal(statuses.get("workflow:plan"), undefined);
	assert.equal(statuses.get("workflow:goal"), "complete");
});

test("an explicitly configured automatic handoff starts Goal at the settled boundary", async () => {
	const mock = createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	workflow(mock.pi, {
		readSettings: () => ({
			kind: "loaded",
			settings: {
				planHandoff: "automatic",
				plan: { thinkingLevel: "inherit" },
				goal: structuredClone(DEFAULT_GOAL_SETTINGS),
			},
		}),
	});
	const { ctx } = createMockContext({ mode: "tui", hasUI: true });
	await emitAll(mock, "session_start", { reason: "startup" }, ctx);
	await mock.commands.get("plan")?.handler("start", ctx);
	const complete = mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	const execute = complete.execute as (...args: unknown[]) => Promise<unknown>;
	await execute("plan-call", { plan: "# Automatic" }, undefined, undefined, ctx);

	await emitAll(mock, "agent_settled", {}, ctx);

	assert.equal(mock.sentUserMessages.length, 1);
	assert.match(mock.sentUserMessages[0]?.text ?? "", /# Automatic/u);
	const goalState = mock.entries.filter((entry) => entry.customType === "goal-state").at(-1)
		?.data as { goal?: { status?: string } };
	assert.equal(goalState.goal?.status, "active");
});

test("fresh handoff creates linked Plan and Goal state before one destination kickoff", async () => {
	const destinationEntries: Array<{ customType: string; data: unknown }> = [];
	const destinationMessages: string[] = [];
	const replacement = createMockContext({ mode: "tui", hasUI: true });
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		model: { provider: "test", id: "model" },
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test", headers: {} }),
		},
		sessionManager: {
			getSessionFile: () => "/tmp/source.jsonl",
			getBranch: () => [],
			getEntries: () => [],
		},
		newSession: async (options: {
			setup?: (sessionManager: {
				appendCustomEntry(type: string, data: unknown): void;
			}) => Promise<void>;
			withSession?: (ctx: unknown) => Promise<void>;
		}) => {
			await options.setup?.({
				appendCustomEntry(customType, data) {
					destinationEntries.push({ customType, data });
				},
			});
			await options.withSession?.({
				...(replacement.ctx as object),
				async sendUserMessage(text: string) {
					destinationMessages.push(text);
				},
			});
			return { cancelled: false };
		},
	});

	const result = await startFreshWorkflowImplementation(context.ctx, {
		plan: "# Fresh Goal",
		source: "plan_mode_complete",
		retention: "keep",
		stateEntryType: "plan-mode-state",
		isCurrent: () => true,
	});

	assert.deepEqual(result, { kind: "started" });
	assert.equal(destinationMessages.length, 1);
	assert.match(destinationMessages[0] ?? "", /# Fresh Goal/u);
	assert.match(destinationMessages[0] ?? "", /Goal mode is active/u);
	const planState = destinationEntries.find((entry) => entry.customType === "plan-mode-state")
		?.data as { activeImplementation?: { goalId?: string; plan?: string } };
	const goalState = destinationEntries.find((entry) => entry.customType === "goal-state")?.data as {
		goal?: { id?: string; status?: string };
	};
	assert.equal(planState.activeImplementation?.plan, "# Fresh Goal");
	assert.equal(planState.activeImplementation?.goalId, goalState.goal?.id);
	assert.equal(goalState.goal?.status, "active");
});

test("the combined runtime prevents Plan and Goal from competing for one session", async () => {
	const first = setup();
	await emitAll(first.mock, "session_start", { reason: "startup" }, first.ctx);
	await first.mock.commands.get("goal")?.handler("finish the release", first.ctx);
	const goalMessages = first.mock.sentUserMessages.length;
	await first.mock.commands.get("plan")?.handler("start", first.ctx);
	assert.equal(first.mock.sentUserMessages.length, goalMessages);
	assert.match(first.notifications.at(-1)?.message ?? "", /clear.*Goal.*Plan/i);
	assert.equal(first.statuses.get("workflow:plan"), undefined);
	assert.match(first.statuses.get("workflow:goal") ?? "", /^active/u);

	const second = setup();
	await emitAll(second.mock, "session_start", { reason: "startup" }, second.ctx);
	await second.mock.commands.get("plan")?.handler("start", second.ctx);
	await second.mock.commands.get("goal")?.handler("start unrelated work", second.ctx);
	assert.equal(second.mock.entries.filter((entry) => entry.customType === "goal-state").length, 0);
	await second.mock.commands.get("goal")?.handler("", second.ctx);
	assert.equal(second.mock.entries.filter((entry) => entry.customType === "goal-state").length, 0);
	assert.match(second.notifications.at(-1)?.message ?? "", /finish or exit Plan mode/i);
	assert.equal(second.statuses.get("workflow:plan"), "plan active");
});

test("linked workflow keeps ordered queue add available and clears Plan after prioritize", async () => {
	const mock = createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	const goalSettings = structuredClone(DEFAULT_GOAL_SETTINGS);
	goalSettings.experimental.goals = true;
	workflow(mock.pi, {
		readSettings: () => ({
			kind: "loaded",
			settings: {
				planHandoff: "review",
				plan: { thinkingLevel: "inherit" },
				goal: goalSettings,
			},
		}),
	});
	const context = createMockContext({ mode: "tui", hasUI: true });
	const fixture = { mock, ...context };
	await startLinkedWorkflow(fixture, "# Queue compatible");

	await mock.commands.get("goal")?.handler("add follow-up verification", context.ctx);
	const queuedState = mock.entries.filter((entry) => entry.customType === "goal-state").at(-1)
		?.data as { queue?: Array<{ text?: string }> };
	assert.deepEqual(
		queuedState.queue?.map((goal) => goal.text),
		["follow-up verification"],
	);

	await mock.commands.get("goal")?.handler("prioritize urgent fix", context.ctx);
	const finalPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
});

test("skipping a linked Goal into the ordered queue clears the old Plan", async () => {
	const mock = createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	const goalSettings = structuredClone(DEFAULT_GOAL_SETTINGS);
	goalSettings.experimental.goals = true;
	workflow(mock.pi, {
		readSettings: () => ({
			kind: "loaded",
			settings: {
				planHandoff: "review",
				plan: { thinkingLevel: "inherit" },
				goal: goalSettings,
			},
		}),
	});
	const context = createMockContext({ mode: "tui", hasUI: true });
	await startLinkedWorkflow({ mock, ...context }, "# Skip safely");
	await mock.commands.get("goal")?.handler("add next objective", context.ctx);
	await mock.commands.get("goal")?.handler("skip", context.ctx);

	const finalPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
	const activeGoal = mock.entries.filter((entry) => entry.customType === "goal-state").at(-1)
		?.data as { goal?: { text?: string } };
	assert.equal(activeGoal.goal?.text, "next objective");
});

test("linkage persistence failure rolls back provisional Goal ownership and tools", async () => {
	const fixture = setup();
	await emitAll(fixture.mock, "session_start", { reason: "startup" }, fixture.ctx);
	await fixture.mock.commands.get("plan")?.handler("start", fixture.ctx);
	const complete = fixture.mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	await (complete.execute as (...args: unknown[]) => Promise<unknown>)(
		"plan-call",
		{ plan: "# Link atomically" },
		undefined,
		undefined,
		fixture.ctx,
	);
	const appendEntry = fixture.mock.rawPi.appendEntry.bind(fixture.mock.rawPi);
	fixture.mock.rawPi.appendEntry = (customType, data) => {
		const activeImplementation = (data as { activeImplementation?: { goalId?: string } })
			.activeImplementation;
		if (customType === "plan-mode-state" && activeImplementation?.goalId) {
			throw new Error("link persistence failed");
		}
		appendEntry(customType, data);
	};

	await fixture.mock.commands.get("plan")?.handler("implement", fixture.ctx);
	fixture.mock.rawPi.appendEntry = appendEntry;
	await fixture.mock.commands.get("plan")?.handler("exit", fixture.ctx);
	await fixture.mock.commands.get("plan")?.handler("start", fixture.ctx);

	assert.equal(fixture.statuses.get("workflow:plan"), "plan active");
	assert.equal(fixture.mock.entries.filter((entry) => entry.customType === "goal-state").length, 0);
	assert.deepEqual(fixture.mock.rawPi.getActiveTools().sort(), [
		"bash",
		"plan_mode_complete",
		"plan_mode_question",
		"read",
	]);
});

test("linked restore activates Goal tools and upgrades legacy short retention", async () => {
	const mock = createMockPi({
		activeTools: [...BASE_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	workflow(mock.pi, { readSettings: () => ({ kind: "missing" }) });
	const restoredGoal = createGoal(
		"Implement and verify the approved Plan-mode plan.",
		undefined,
		0,
		"fresh-goal",
	);
	const branch = [
		{
			type: "custom",
			customType: "plan-mode-state",
			data: {
				enabled: false,
				awaitingAction: false,
				activeImplementation: {
					id: "fresh-implementation",
					goalId: restoredGoal.id,
					plan: "# Fresh",
					source: "plan_mode_complete",
					startedAt: 1,
					retention: "clear-on-start",
				},
			},
		},
		{
			type: "custom",
			customType: "goal-state",
			data: serializeGoalState(restoredGoal, [], undefined),
		},
	];
	const restored = createMockContext({
		mode: "tui",
		hasUI: true,
		sessionManager: {
			getSessionId: () => "fresh",
			getSessionName: () => undefined,
			getBranch: () => branch,
			getEntries: () => branch,
		},
	});

	await emitAll(mock, "session_start", { reason: "startup" }, restored.ctx);

	for (const tool of GOAL_TOOLS) assert.ok(mock.rawPi.getActiveTools().includes(tool));
	assert.match(restored.statuses.get("workflow:goal") ?? "", /^active/u);
	const migratedPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: { retention?: string } };
	assert.equal(migratedPlan.activeImplementation?.retention, "keep");
	const context = await transformContext({ mock, ...restored }, [
		{ role: "compactionSummary", content: "Restored after compaction." },
		{ role: "user", content: "Continue." },
	]);
	assert.match(JSON.stringify(context), /# Fresh/u);
	await emitAll(mock, "agent_settled", {}, restored.ctx);
	const retainedPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: { goalId?: string } };
	assert.equal(retainedPlan.activeImplementation?.goalId, restoredGoal.id);
});

test("Goal restore cannot mutate stale Plan state before the new Plan session is ready", async () => {
	const fixture = setup();
	await startLinkedWorkflow(fixture, "# Session A");
	await emitAll(fixture.mock, "session_shutdown", {}, fixture.ctx);
	const planEntryCount = fixture.mock.entries.filter(
		(entry) => entry.customType === "plan-mode-state",
	).length;
	const restoredGoal = createGoal(
		"Implement and verify the approved Plan-mode plan.",
		undefined,
		0,
		"session-b-goal",
	);
	const branch = [
		{
			type: "custom",
			customType: "plan-mode-state",
			data: {
				enabled: false,
				awaitingAction: false,
				activeImplementation: {
					id: "session-b-plan",
					goalId: restoredGoal.id,
					plan: "# Session B",
					source: "plan_mode_complete",
					startedAt: 2,
					retention: "keep",
				},
			},
		},
		{
			type: "custom",
			customType: "goal-state",
			data: serializeGoalState(restoredGoal, [], undefined),
		},
	];
	const replacement = createMockContext({
		mode: "tui",
		hasUI: true,
		sessionManager: {
			getSessionId: () => "session-b",
			getSessionName: () => undefined,
			getBranch: () => branch,
			getEntries: () => branch,
		},
	});
	const startHandlers = fixture.mock.events.get("session_start") ?? [];
	await startHandlers[0]?.({ reason: "switch" }, replacement.ctx);
	assert.equal(
		fixture.mock.entries.filter((entry) => entry.customType === "plan-mode-state").length,
		planEntryCount,
	);
	for (const handler of startHandlers.slice(1)) {
		await handler({ reason: "switch" }, replacement.ctx);
	}
	await fixture.mock.commands.get("goal")?.handler("clear", replacement.ctx);
	const finalPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
});

test("session restore keeps a newer Goal and clears an older unlinked implementation Plan", async () => {
	const mock = createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	workflow(mock.pi, { readSettings: () => ({ kind: "missing" }) });
	const restoredGoal = createGoal("newer unrelated work", undefined, 0, "newer-goal");
	const branch = [
		{
			type: "custom",
			customType: "plan-mode-state",
			data: {
				enabled: false,
				awaitingAction: false,
				activeImplementation: {
					id: "older-unlinked-plan",
					plan: "# Stale standalone plan",
					source: "plan_mode_complete",
					startedAt: 1,
					retention: "keep",
				},
			},
		},
		{
			type: "custom",
			customType: "goal-state",
			data: serializeGoalState(restoredGoal, [], undefined),
		},
	];
	const restored = createMockContext({
		mode: "tui",
		hasUI: true,
		sessionManager: {
			getSessionId: () => "newer-goal-conflict",
			getSessionName: () => undefined,
			getBranch: () => branch,
			getEntries: () => branch,
		},
	});

	await emitAll(mock, "session_start", { reason: "startup" }, restored.ctx);

	const finalPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
	assert.match(restored.statuses.get("workflow:goal") ?? "", /^active/u);
	let messages: unknown[] = [{ role: "user", content: [{ type: "text", text: "continue" }] }];
	for (const handler of mock.events.get("context") ?? []) {
		const transformed = (await handler({ messages }, restored.ctx)) as
			| { messages?: unknown[] }
			| undefined;
		messages = transformed?.messages ?? messages;
	}
	assert.doesNotMatch(JSON.stringify(messages), /Stale standalone plan/u);
});

test("session restore recovers a newer unlinked implementation as ready and clears an older Goal", async () => {
	const mock = createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	workflow(mock.pi, { readSettings: () => ({ kind: "missing" }) });
	const restoredGoal = createGoal("older unrelated work", undefined, 0, "older-goal");
	const branch = [
		{
			type: "custom",
			customType: "goal-state",
			data: serializeGoalState(restoredGoal, [], undefined),
		},
		{
			type: "custom",
			customType: "plan-mode-state",
			data: {
				enabled: false,
				awaitingAction: false,
				activeImplementation: {
					id: "newer-unlinked-plan",
					plan: "# Current standalone plan",
					source: "plan_mode_complete",
					startedAt: 2,
					retention: "keep",
				},
			},
		},
	];
	const appendEntry = mock.rawPi.appendEntry.bind(mock.rawPi);
	mock.rawPi.appendEntry = (customType, data) => {
		appendEntry(customType, data);
		branch.push({ type: "custom", customType, data } as (typeof branch)[number]);
	};
	const restored = createMockContext({
		mode: "tui",
		hasUI: true,
		sessionManager: {
			getSessionId: () => "newer-plan-conflict",
			getSessionName: () => undefined,
			getBranch: () => branch,
			getEntries: () => branch,
		},
	});

	await emitAll(mock, "session_start", { reason: "startup" }, restored.ctx);

	const finalGoal = mock.entries.filter((entry) => entry.customType === "goal-state").at(-1)
		?.data as { goal?: unknown };
	assert.equal(finalGoal.goal, null);
	assert.equal(restored.statuses.get("workflow:goal"), undefined);
	assert.equal(restored.statuses.get("workflow:plan"), "plan ready");
	const recoveredPlan = mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { enabled?: boolean; latestPlan?: string; activeImplementation?: unknown };
	assert.equal(recoveredPlan.enabled, true);
	assert.equal(recoveredPlan.latestPlan, "# Current standalone plan");
	assert.equal(recoveredPlan.activeImplementation, undefined);
	let messages: unknown[] = [{ role: "user", content: [{ type: "text", text: "continue" }] }];
	for (const handler of mock.events.get("context") ?? []) {
		const transformed = (await handler({ messages }, restored.ctx)) as
			| { messages?: unknown[] }
			| undefined;
		messages = transformed?.messages ?? messages;
	}
	assert.doesNotMatch(JSON.stringify(messages), /ACTIVE IMPLEMENTATION PLAN/u);
});

test("session restore clears a stale Plan linked to a superseding objective", async () => {
	const mock = createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	workflow(mock.pi, { readSettings: () => ({ kind: "missing" }) });
	const supersedingGoal = createGoal("urgent unrelated work", undefined, 0, "urgent-goal");
	const branch = [
		{
			type: "custom",
			customType: "plan-mode-state",
			data: {
				enabled: false,
				awaitingAction: false,
				activeImplementation: {
					id: "stale-plan",
					goalId: supersedingGoal.id,
					plan: "# Old plan",
					source: "plan_mode_complete",
					startedAt: 1,
					retention: "keep",
				},
			},
		},
		{
			type: "custom",
			customType: "goal-state",
			data: serializeGoalState(supersedingGoal, [], undefined),
		},
	];
	const restored = createMockContext({
		mode: "tui",
		hasUI: true,
		sessionManager: {
			getSessionId: () => "superseded",
			getSessionName: () => undefined,
			getBranch: () => branch,
			getEntries: () => branch,
		},
	});

	await emitAll(mock, "session_start", { reason: "startup" }, restored.ctx);

	const finalPlan = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
});

test("session restore reconciles an orphaned linked Plan without a Goal", async () => {
	const fixture = setup();
	const branch = [
		{
			type: "custom",
			customType: "plan-mode-state",
			data: {
				enabled: false,
				awaitingAction: false,
				activeImplementation: {
					id: "implementation-1",
					goalId: "missing-goal",
					plan: "# Orphan",
					source: "plan_mode_complete",
					startedAt: 1,
					retention: "keep",
				},
			},
		},
	];
	const restored = createMockContext({
		mode: "tui",
		hasUI: true,
		sessionManager: {
			getSessionId: () => "restored",
			getSessionName: () => undefined,
			getBranch: () => branch,
			getEntries: () => branch,
		},
	});
	await emitAll(fixture.mock, "session_start", { reason: "startup" }, restored.ctx);

	const finalPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: unknown };
	assert.equal(finalPlan.activeImplementation, undefined);
	assert.equal(restored.statuses.get("workflow:plan"), undefined);
});

test("session replacement during Goal delivery cannot roll back through a stale Plan context", async () => {
	const fixture = setup();
	await emitAll(fixture.mock, "session_start", { reason: "startup" }, fixture.ctx);
	await fixture.mock.commands.get("plan")?.handler("start", fixture.ctx);
	const complete = fixture.mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	await (complete.execute as (...args: unknown[]) => Promise<unknown>)(
		"plan-call",
		{ plan: "# Do not cross sessions" },
		undefined,
		undefined,
		fixture.ctx,
	);
	let deliveryStarted = false;
	let finishDelivery: (() => void) | undefined;
	fixture.mock.rawPi.sendUserMessage = (() => {
		deliveryStarted = true;
		return new Promise<void>((resolve) => {
			finishDelivery = resolve;
		});
	}) as never;

	const implementation = fixture.mock.commands.get("plan")?.handler("implement", fixture.ctx);
	for (let attempt = 0; attempt < 20 && !deliveryStarted; attempt += 1) await Promise.resolve();
	assert.equal(deliveryStarted, true);
	await emitAll(fixture.mock, "session_shutdown", {}, fixture.ctx);
	const entriesAfterShutdown = fixture.mock.entries.length;
	finishDelivery?.();
	await implementation;

	assert.equal(fixture.mock.entries.length, entriesAfterShutdown);
});

test("reload clears a persisted phantom Goal when rollback publication failed", async () => {
	const fixture = setup();
	await emitAll(fixture.mock, "session_start", { reason: "startup" }, fixture.ctx);
	await fixture.mock.commands.get("plan")?.handler("start", fixture.ctx);
	const complete = fixture.mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	await (complete.execute as (...args: unknown[]) => Promise<unknown>)(
		"plan-call",
		{ plan: "# Recover after persistence failure" },
		undefined,
		undefined,
		fixture.ctx,
	);
	fixture.mock.rawPi.sendUserMessage = () => {
		throw new Error("delivery failed");
	};
	const appendEntry = fixture.mock.rawPi.appendEntry.bind(fixture.mock.rawPi);
	let rejectedClear = false;
	fixture.mock.rawPi.appendEntry = (customType, data) => {
		if (
			!rejectedClear &&
			customType === "goal-state" &&
			(data as { goal?: unknown }).goal === null
		) {
			rejectedClear = true;
			throw new Error("clear persistence failed");
		}
		appendEntry(customType, data);
	};

	await fixture.mock.commands.get("plan")?.handler("implement", fixture.ctx);
	fixture.mock.rawPi.appendEntry = appendEntry;
	assert.equal(rejectedClear, true);
	const branch = fixture.mock.entries.map((entry) => ({ type: "custom", ...entry }));
	const restoredMock = createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
	workflow(restoredMock.pi, { readSettings: () => ({ kind: "missing" }) });
	const restored = createMockContext({
		mode: "tui",
		hasUI: true,
		sessionManager: {
			getSessionId: () => "recovery",
			getSessionName: () => undefined,
			getBranch: () => branch,
			getEntries: () => branch,
		},
	});

	await emitAll(restoredMock, "session_start", { reason: "startup" }, restored.ctx);

	const recoveredGoal = restoredMock.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data as { goal?: unknown };
	assert.equal(recoveredGoal.goal, null);
	assert.equal(restored.statuses.get("workflow:goal"), undefined);
	assert.equal(restored.statuses.get("workflow:plan"), "plan ready");
});

test("a failed Goal kickoff restores the ready Plan and clears provisional Goal state", async () => {
	const { mock, ctx, statuses } = setup();
	await emitAll(mock, "session_start", { reason: "startup" }, ctx);
	await mock.commands.get("plan")?.handler("start", ctx);
	const complete = mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	const execute = complete.execute as (...args: unknown[]) => Promise<unknown>;
	await execute("plan-call", { plan: "# Recoverable" }, undefined, undefined, ctx);
	mock.rawPi.sendUserMessage = () => {
		throw new Error("delivery failed");
	};

	await mock.commands.get("plan")?.handler("implement", ctx);

	const planState = mock.entries.filter((entry) => entry.customType === "plan-mode-state").at(-1)
		?.data as { enabled?: boolean; latestPlan?: string; awaitingAction?: boolean };
	const goalState = mock.entries.filter((entry) => entry.customType === "goal-state").at(-1)
		?.data as { goal?: unknown };
	assert.equal(planState.enabled, true);
	assert.equal(planState.latestPlan, "# Recoverable");
	assert.equal(planState.awaitingAction, true);
	assert.equal(goalState.goal, null);
	assert.equal(statuses.get("workflow:plan"), "plan ready");
	assert.equal(statuses.get("workflow:goal"), undefined);
});

function workflowSettingsWithShortcut(toggleShortcut: KeyId): () => WorkflowSettingsLoadResult {
	return () => ({
		kind: "loaded",
		settings: {
			planHandoff: "review",
			plan: { thinkingLevel: "inherit", toggleShortcut },
			goal: structuredClone(DEFAULT_GOAL_SETTINGS),
		},
	});
}

test("Plan mode has no workflow shortcut unless settings configure one", async () => {
	const { mock, ctx } = setup();
	await emitAll(mock, "session_start", { reason: "startup" }, ctx);
	assert.equal(mock.shortcuts.size, 0);
});

test("the configured workflow shortcut toggles Plan mode", async () => {
	const { mock, ctx, statuses, notifications } = setup(
		workflowSettingsWithShortcut("ctrl+shift+p"),
	);
	await emitAll(mock, "session_start", { reason: "startup" }, ctx);
	const toggle = mock.shortcuts.get("ctrl+shift+p");
	assert.ok(toggle, "the configured shortcut should be registered");
	assert.equal(mock.shortcuts.has("ctrl+alt+p"), false);

	await toggle.handler(ctx);
	assert.equal(statuses.get("workflow:plan"), "plan active");
	assert.match(notifications.at(-1)?.message ?? "", /Plan mode enabled/);

	await toggle.handler(ctx);
	assert.equal(statuses.get("workflow:plan"), undefined);
	assert.match(notifications.at(-1)?.message ?? "", /Plan mode disabled/);
});

test("the workflow shortcut cannot start Plan mode while a Goal is active", async () => {
	const fixture = setup(workflowSettingsWithShortcut("ctrl+alt+p"));
	await emitAll(fixture.mock, "session_start", { reason: "startup" }, fixture.ctx);
	await fixture.mock.commands.get("goal")?.handler("finish the release", fixture.ctx);
	const toggle = fixture.mock.shortcuts.get("ctrl+alt+p");
	assert.ok(toggle);

	await toggle.handler(fixture.ctx);
	assert.equal(fixture.statuses.get("workflow:plan"), undefined);
	assert.match(fixture.notifications.at(-1)?.message ?? "", /clear.*Goal.*Plan/i);
	assert.match(fixture.statuses.get("workflow:goal") ?? "", /^active/u);
});

test("the workflow shortcut cannot detach a linked Goal from its Plan", async () => {
	const fixture = setup(workflowSettingsWithShortcut("ctrl+alt+p"));
	await startLinkedWorkflow(fixture, "# Keep linked");
	const toggle = fixture.mock.shortcuts.get("ctrl+alt+p");
	assert.ok(toggle);

	await toggle.handler(fixture.ctx);
	const retainedPlan = fixture.mock.entries
		.filter((entry) => entry.customType === "plan-mode-state")
		.at(-1)?.data as { activeImplementation?: { goalId?: string } };
	assert.ok(retainedPlan.activeImplementation?.goalId);
	assert.match(fixture.notifications.at(-1)?.message ?? "", /clear.*Goal.*Plan/i);
});
