import assert from "node:assert/strict";
import { test } from "vitest";
import { builtinTool, createMockContext, createMockPi } from "../../../test/support.js";
import workflow from "../src/index.js";
import planMode from "../src/plan/plan-mode.js";

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

function createWorkflow() {
	return createMockPi({
		activeTools: [...BASE_TOOLS, ...GOAL_TOOLS],
		allTools: [...BASE_TOOLS, ...GOAL_TOOLS].map(builtinTool),
	});
}

async function enterReadyPlan(mock: ReturnType<typeof createMockPi>, ctx: unknown) {
	await mock.commands.get("plan")?.handler("start", ctx as never);
	const complete = mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	await (complete.execute as (...args: unknown[]) => Promise<unknown>)(
		"complete-plan",
		{ plan: "# Lazy action plan" },
		undefined,
		undefined,
		ctx,
	);
}

test("canonical entry synchronously registers runtime surfaces without loading cold modules", async () => {
	const mock = createWorkflow();
	let menuLoads = 0;
	let handoffLoads = 0;
	workflow(mock.pi, {
		readSettings: () => ({ kind: "missing" }),
		loadWorkflowMenu: async () => {
			menuLoads += 1;
			return { showWorkflowMenu: async () => undefined as never };
		},
		loadFreshHandoff: async () => {
			handoffLoads += 1;
			return { startFreshWorkflowImplementation: async () => ({ kind: "started" }) };
		},
	});

	assert.deepEqual([...mock.commands.keys()], ["goal", "plan", "workflow"]);
	assert.deepEqual(
		mock.tools.map((tool) => tool.name),
		["goal_complete", "goal_blocked", "goal_wait", "plan_mode_question", "plan_mode_complete"],
	);
	assert.ok(mock.flags.has("plan"));
	for (const event of ["session_start", "session_shutdown", "context", "agent_end"]) {
		assert.ok((mock.events.get(event)?.length ?? 0) > 0, `expected ${event} registration`);
	}
	const context = createMockContext({ mode: "tui", hasUI: true });
	await emitAll(mock, "session_start", { reason: "startup" }, context.ctx);

	assert.equal(menuLoads, 0);
	assert.equal(handoffLoads, 0);
});

test("Workflow manager caches a successful load and retries a rejected load", async () => {
	const mock = createWorkflow();
	let loads = 0;
	let shows = 0;
	workflow(mock.pi, {
		readSettings: () => ({ kind: "missing" }),
		loadWorkflowMenu: async () => {
			loads += 1;
			if (loads === 1) throw new Error("temporary Workflow UI load failure");
			return {
				showWorkflowMenu: async () => {
					shows += 1;
					return undefined as never;
				},
			};
		},
	});
	const context = createMockContext({ mode: "tui", hasUI: true });
	await emitAll(mock, "session_start", { reason: "startup" }, context.ctx);
	const command = mock.commands.get("workflow");
	assert.ok(command);

	await assert.rejects(async () => command.handler("", context.ctx), /temporary Workflow UI/u);
	await command.handler("", context.ctx);
	await command.handler("", context.ctx);

	assert.equal(loads, 2);
	assert.equal(shows, 2);
});

test("session replacement while the Workflow manager loads prevents stale UI", async () => {
	const mock = createWorkflow();
	let releaseLoad!: () => void;
	let loadingStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		loadingStarted = resolve;
	});
	const loadGate = new Promise<void>((resolve) => {
		releaseLoad = resolve;
	});
	let shows = 0;
	workflow(mock.pi, {
		readSettings: () => ({ kind: "missing" }),
		loadWorkflowMenu: async () => {
			loadingStarted();
			await loadGate;
			return {
				showWorkflowMenu: async () => {
					shows += 1;
					return undefined as never;
				},
			};
		},
	});
	const context = createMockContext({ mode: "tui", hasUI: true });
	await emitAll(mock, "session_start", { reason: "startup" }, context.ctx);

	const pending = mock.commands.get("workflow")?.handler("", context.ctx);
	await started;
	await emitAll(mock, "session_shutdown", { reason: "new" }, context.ctx);
	releaseLoad();
	await pending;

	assert.equal(shows, 0);
});

test("session replacement while the fresh handoff loads prevents session replacement", async () => {
	const mock = createWorkflow();
	let releaseLoad!: () => void;
	let loadingStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		loadingStarted = resolve;
	});
	const loadGate = new Promise<void>((resolve) => {
		releaseLoad = resolve;
	});
	let handoffs = 0;
	workflow(mock.pi, {
		readSettings: () => ({ kind: "missing" }),
		loadFreshHandoff: async () => {
			loadingStarted();
			await loadGate;
			return {
				startFreshWorkflowImplementation: async () => {
					handoffs += 1;
					return { kind: "started" };
				},
			};
		},
	});
	const context = createMockContext({
		mode: "rpc",
		hasUI: true,
		select: async (_title: string, options: string[]) =>
			options.includes("Start fresh with Goal") ? "Start fresh with Goal" : undefined,
		newSession: async () => ({ cancelled: false }),
	});
	await emitAll(mock, "session_start", { reason: "startup" }, context.ctx);
	await mock.commands.get("plan")?.handler("start", context.ctx);
	const complete = mock.tools.find((tool) => tool.name === "plan_mode_complete");
	assert.ok(complete);
	await (complete.execute as (...args: unknown[]) => Promise<unknown>)(
		"plan-call",
		{ plan: "# Approved lazy handoff" },
		undefined,
		undefined,
		context.ctx,
	);

	const pending = mock.commands.get("plan")?.handler("", context.ctx);
	await started;
	await emitAll(mock, "session_shutdown", { reason: "new" }, context.ctx);
	releaseLoad();
	await pending;

	assert.equal(handoffs, 0);
});

test("Plan export loader retries rejection and caches a successful module", async () => {
	const mock = createMockPi({ activeTools: ["read"] });
	let loads = 0;
	let exports = 0;
	planMode(mock.pi, {
		loadPlanExport: async () => {
			loads += 1;
			if (loads === 1) throw new Error("temporary export module failure");
			return {
				exportStoredPlan: async () => {
					exports += 1;
					return true;
				},
			};
		},
	});
	const context = createMockContext({ hasUI: true });
	await mock.events.get("session_start")?.[0]?.({}, context.ctx);
	await enterReadyPlan(mock, context.ctx);

	await assert.rejects(
		mock.commands.get("plan")?.handler("export", context.ctx) as Promise<unknown>,
		/temporary export module failure/u,
	);
	await mock.commands.get("plan")?.handler("export", context.ctx);
	await mock.commands.get("plan")?.handler("export", context.ctx);

	assert.equal(loads, 2);
	assert.equal(exports, 2);
});

test("saved Plan preflight loader retries rejection and caches a successful module", async () => {
	const mock = createMockPi({ activeTools: ["read"] });
	let loads = 0;
	let preflights = 0;
	planMode(mock.pi, {
		loadSavedPlanPreflight: async () => {
			loads += 1;
			if (loads === 1) throw new Error("temporary preflight module failure");
			return {
				preflightSavedPlanImplementation: async () => {
					preflights += 1;
					return false;
				},
			};
		},
	});
	const context = createMockContext({ hasUI: true });
	await mock.events.get("session_start")?.[0]?.({}, context.ctx);
	await enterReadyPlan(mock, context.ctx);
	await mock.commands.get("plan")?.handler("save", context.ctx);

	await assert.rejects(
		mock.commands.get("plan")?.handler("implement", context.ctx) as Promise<unknown>,
		/temporary preflight module failure/u,
	);
	await mock.commands.get("plan")?.handler("implement", context.ctx);
	await mock.commands.get("plan")?.handler("implement", context.ctx);

	assert.equal(loads, 2);
	assert.equal(preflights, 2);
	assert.equal(mock.sentUserMessages.length, 0);
});

test("fresh implementation loader retries rejection and caches a successful module", async () => {
	const mock = createMockPi({ activeTools: ["read"] });
	let loads = 0;
	let starts = 0;
	planMode(mock.pi, {
		loadFreshImplementation: async () => {
			loads += 1;
			if (loads === 1) throw new Error("temporary fresh module failure");
			return {
				startFreshImplementationFromState: async () => {
					starts += 1;
					return { kind: "started" as const };
				},
			};
		},
	});
	const context = createMockContext({
		mode: "rpc",
		hasUI: true,
		select: async (_title: string, options: string[]) =>
			options.includes("Start fresh with Goal") ? "Start fresh with Goal" : undefined,
	});
	await mock.events.get("session_start")?.[0]?.({}, context.ctx);
	await enterReadyPlan(mock, context.ctx);

	await mock.commands.get("plan")?.handler("", context.ctx);
	await mock.commands.get("plan")?.handler("", context.ctx);
	await mock.commands.get("plan")?.handler("", context.ctx);

	assert.equal(loads, 2);
	assert.ok(starts >= 2);
});

test("session shutdown while Plan export code loads prevents file execution", async () => {
	const mock = createMockPi({ activeTools: ["read"] });
	let release!: () => void;
	let started!: () => void;
	const loading = new Promise<void>((resolve) => {
		started = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let exports = 0;
	planMode(mock.pi, {
		loadPlanExport: async () => {
			started();
			await gate;
			return {
				exportStoredPlan: async () => {
					exports += 1;
					return true;
				},
			};
		},
	});
	const context = createMockContext({ hasUI: true });
	await mock.events.get("session_start")?.[0]?.({}, context.ctx);
	await enterReadyPlan(mock, context.ctx);
	const pending = mock.commands.get("plan")?.handler("export", context.ctx);
	await loading;
	await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
	release();
	await pending;

	assert.equal(exports, 0);
});

test("session replacement while saved preflight code loads prevents authentication", async () => {
	const mock = createMockPi({ activeTools: ["read"] });
	let release!: () => void;
	let started!: () => void;
	const loading = new Promise<void>((resolve) => {
		started = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let preflights = 0;
	planMode(mock.pi, {
		loadSavedPlanPreflight: async () => {
			started();
			await gate;
			return {
				preflightSavedPlanImplementation: async () => {
					preflights += 1;
					return true;
				},
			};
		},
	});
	const context = createMockContext({ hasUI: true });
	await mock.events.get("session_start")?.[0]?.({}, context.ctx);
	await enterReadyPlan(mock, context.ctx);
	await mock.commands.get("plan")?.handler("save", context.ctx);
	const pending = mock.commands.get("plan")?.handler("implement", context.ctx);
	await loading;
	const replacement = createMockContext({ hasUI: true });
	await mock.events.get("session_start")?.[0]?.({ reason: "switch" }, replacement.ctx);
	release();
	await pending;

	assert.equal(preflights, 0);
	assert.equal(mock.sentUserMessages.length, 0);
});

test("session shutdown while fresh implementation code loads prevents replacement", async () => {
	const mock = createMockPi({ activeTools: ["read"] });
	let release!: () => void;
	let started!: () => void;
	const loading = new Promise<void>((resolve) => {
		started = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let starts = 0;
	planMode(mock.pi, {
		loadFreshImplementation: async () => {
			started();
			await gate;
			return {
				startFreshImplementationFromState: async () => {
					starts += 1;
					return { kind: "started" as const };
				},
			};
		},
	});
	const context = createMockContext({
		mode: "rpc",
		hasUI: true,
		select: async (_title: string, options: string[]) =>
			options.includes("Start fresh with Goal") ? "Start fresh with Goal" : undefined,
	});
	await mock.events.get("session_start")?.[0]?.({}, context.ctx);
	await enterReadyPlan(mock, context.ctx);
	const pending = mock.commands.get("plan")?.handler("", context.ctx);
	await loading;
	await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
	release();
	await pending;

	assert.equal(starts, 0);
});
