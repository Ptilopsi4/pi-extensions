import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { createStatefulTransport } from "../src/create-stateful-transport.js";
import subagents from "../src/index.js";
import type { ManagedAgent, TurnOutcome } from "../src/registry.js";
import type { SubagentTransport } from "../src/transport.js";
import { installSubagentsTestEnvironment } from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
afterAll(restoreTestEnvironment);

async function emitAll(
	mock: ReturnType<typeof createMockPi>,
	name: string,
	event: unknown,
	ctx = createMockContext().ctx,
): Promise<void> {
	for (const handler of mock.events.get(name) ?? []) await handler(event, ctx);
}

function managedAgent(): ManagedAgent {
	return {
		id: "sa_lazy",
		agent: "explorer",
		rootId: "sa_lazy",
		depth: 0,
		children: [],
		state: "running",
		createdAt: 1,
		updatedAt: 1,
		cwd: process.cwd(),
		history: [],
		mailbox: [],
	};
}

class FakeTransport implements SubagentTransport {
	readonly kind = "fake" as const;
	turns = 0;
	shutdowns = 0;

	async runTurn(): Promise<TurnOutcome> {
		this.turns += 1;
		return { output: "done", exitCode: 0 };
	}

	async shutdown(): Promise<void> {
		this.shutdowns += 1;
	}
}

test("Subagents idle startup registers every surface without loading deferred implementations", async () => {
	const mock = createMockPi();
	const loads = {
		blocking: 0,
		config: 0,
		consult: 0,
		inspect: 0,
		transport: 0,
	};
	subagents(mock.pi, {
		loadBlockingExecution: async () => {
			loads.blocking += 1;
			return {} as never;
		},
		loadStatefulTransport: async () => {
			loads.transport += 1;
			return new FakeTransport();
		},
		config: {
			loadConfigUi: async () => {
				loads.config += 1;
				return {} as never;
			},
		},
		consult: {
			loadExecution: async () => {
				loads.consult += 1;
				return {} as never;
			},
		},
		inspect: {
			loadExecution: async () => {
				loads.inspect += 1;
				return {} as never;
			},
		},
	});
	const context = createMockContext();
	await emitAll(mock, "session_start", { reason: "startup" }, context.ctx);

	assert.deepEqual(loads, {
		blocking: 0,
		config: 0,
		consult: 0,
		inspect: 0,
		transport: 0,
	});
	assert.deepEqual(
		[...new Set(mock.tools.map((tool) => tool.name))],
		[
			"subagent",
			"subagent_spawn",
			"subagent_send",
			"subagent_manage",
			"subagent_mailbox",
			"subagent_inspect",
			"subagent_consult",
		],
	);
	assert.ok(mock.commands.has("subagents"));
	await emitAll(mock, "session_shutdown", { reason: "quit" }, context.ctx);
});

test("Subagents direct status stays lightweight and manager UI loads once on demand", async () => {
	const mock = createMockPi();
	let loads = 0;
	let shows = 0;
	subagents(mock.pi, {
		config: {
			loadConfigUi: async () => {
				loads += 1;
				return {
					showSubagentManager: async () => {
						shows += 1;
					},
					showSubagentSettings: async () => undefined,
				};
			},
		},
	});
	const context = createMockContext({ mode: "tui", hasUI: true });
	await emitAll(mock, "session_start", { reason: "startup" }, context.ctx);
	const command = mock.commands.get("subagents");
	assert.ok(command);
	await command.handler("status", context.ctx);
	assert.equal(loads, 0);
	await command.handler("", context.ctx);
	await command.handler("", context.ctx);
	assert.equal(loads, 1);
	assert.equal(shows, 2);
	await emitAll(mock, "session_shutdown", { reason: "quit" }, context.ctx);
});

test("Subagents direct status ignores stale lazy status loads", async () => {
	const mock = createMockPi();
	let statusLoadingStarted!: () => void;
	const statusLoading = new Promise<void>((resolve) => {
		statusLoadingStarted = resolve;
	});
	let releaseStatus!: () => void;
	const statusGate = new Promise<void>((resolve) => {
		releaseStatus = resolve;
	});
	let shows = 0;
	subagents(mock.pi, {
		config: {
			loadConfigStatus: async () => {
				statusLoadingStarted();
				await statusGate;
				return {
					showSubagentHelp: () => {
						shows += 1;
					},
					showSubagentStatus: () => {
						shows += 1;
					},
				};
			},
		},
	});
	const context = createMockContext({ mode: "tui", hasUI: true });
	await emitAll(mock, "session_start", { reason: "startup" }, context.ctx);
	const command = mock.commands.get("subagents");
	assert.ok(command);
	const running = command.handler("status", context.ctx);
	await statusLoading;
	await emitAll(mock, "session_shutdown", { reason: "quit" }, context.ctx);
	releaseStatus();
	await running;
	assert.equal(shows, 0);
});

test("blocking execution caches a successful module and retries a rejected load", async () => {
	const mock = createMockPi();
	let loads = 0;
	let executions = 0;
	subagents(mock.pi, {
		loadBlockingExecution: async () => {
			loads += 1;
			if (loads === 1) throw new Error("temporary blocking loader failure");
			return {
				executeSubagent: async () => {
					executions += 1;
					return {
						content: [{ type: "text" as const, text: "done" }],
						details: {
							mode: "single" as const,
							agentScope: "user" as const,
							projectAgentsDir: null,
							results: [],
						},
					};
				},
			} as never;
		},
	});
	const tool = mock.tools.find((candidate) => candidate.name === "subagent") as
		| { execute: (...args: unknown[]) => Promise<unknown> }
		| undefined;
	assert.ok(tool);
	const context = createMockContext();
	await assert.rejects(
		() =>
			tool.execute(
				"first",
				{ agent: "explorer", task: "inspect" },
				undefined,
				undefined,
				context.ctx,
			),
		/temporary blocking loader failure/u,
	);
	await tool.execute(
		"second",
		{ agent: "explorer", task: "inspect" },
		undefined,
		undefined,
		context.ctx,
	);
	await tool.execute(
		"third",
		{ agent: "explorer", task: "inspect" },
		undefined,
		undefined,
		context.ctx,
	);

	assert.equal(loads, 2);
	assert.equal(executions, 2);
});

test("blocking execution cancellation waits for a pending import and starts no stale work", async () => {
	const mock = createMockPi();
	let startLoading!: () => void;
	const loadingStarted = new Promise<void>((resolve) => {
		startLoading = resolve;
	});
	let releaseLoading!: () => void;
	const loadingGate = new Promise<void>((resolve) => {
		releaseLoading = resolve;
	});
	let executions = 0;
	subagents(mock.pi, {
		loadBlockingExecution: async () => {
			startLoading();
			await loadingGate;
			return {
				executeSubagent: async () => {
					executions += 1;
					throw new Error("stale execution started");
				},
			} as never;
		},
	});
	const tool = mock.tools.find((candidate) => candidate.name === "subagent") as
		| { execute: (...args: unknown[]) => Promise<unknown> }
		| undefined;
	assert.ok(tool);
	const context = createMockContext();
	const running = tool.execute(
		"pending",
		{ agent: "explorer", task: "inspect" },
		undefined,
		undefined,
		context.ctx,
	);
	void running.catch(() => undefined);
	await loadingStarted;
	let shutdownSettled = false;
	const shutdown = emitAll(mock, "session_shutdown", { reason: "quit" }, context.ctx).then(() => {
		shutdownSettled = true;
	});
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(shutdownSettled, false);
	releaseLoading();
	await shutdown;
	await assert.rejects(running, (error) => error instanceof Error && error.name === "AbortError");
	assert.equal(executions, 0);
});

test("stateful transport loads once on first turn and stays unloaded on idle shutdown", async () => {
	let loads = 0;
	const implementation = new FakeTransport();
	const transport = createStatefulTransport({
		kind: "subprocess",
		modelRegistry: {} as never,
		getParentRuntime: () => ({ model: undefined, thinkingLevel: "off" }),
		getSettings: () => undefined,
		loadTransport: async () => {
			loads += 1;
			return implementation;
		},
	});
	const idle = createStatefulTransport({
		kind: "subprocess",
		modelRegistry: {} as never,
		getParentRuntime: () => ({ model: undefined, thinkingLevel: "off" }),
		getSettings: () => undefined,
		loadTransport: async () => {
			throw new Error("idle shutdown loaded a transport");
		},
	});

	await idle.shutdown?.();
	assert.equal(loads, 0);
	await transport.runTurn(managedAgent(), "first", new AbortController().signal);
	await transport.runTurn(managedAgent(), "second", new AbortController().signal);
	assert.equal(loads, 1);
	assert.equal(implementation.turns, 2);
	await transport.shutdown?.();
	assert.equal(implementation.shutdowns, 1);
});

test("stateful transport retries a rejected implementation load", async () => {
	let loads = 0;
	const implementation = new FakeTransport();
	const transport = createStatefulTransport({
		kind: "subprocess",
		modelRegistry: {} as never,
		getParentRuntime: () => ({ model: undefined, thinkingLevel: "off" }),
		getSettings: () => undefined,
		loadTransport: async () => {
			loads += 1;
			if (loads === 1) throw new Error("temporary transport loader failure");
			return implementation;
		},
	});
	await assert.rejects(
		() => transport.runTurn(managedAgent(), "first", new AbortController().signal),
		/temporary transport loader failure/u,
	);
	await transport.runTurn(managedAgent(), "second", new AbortController().signal);
	assert.equal(loads, 2);
	assert.equal(implementation.turns, 1);
	await transport.shutdown?.();
});

test("stateful transport cancellation during loading starts no turn", async () => {
	let releaseLoading!: (transport: SubagentTransport) => void;
	const loading = new Promise<SubagentTransport>((resolve) => {
		releaseLoading = resolve;
	});
	const implementation = new FakeTransport();
	const transport = createStatefulTransport({
		kind: "subprocess",
		modelRegistry: {} as never,
		getParentRuntime: () => ({ model: undefined, thinkingLevel: "off" }),
		getSettings: () => undefined,
		loadTransport: () => loading,
	});
	const controller = new AbortController();
	const running = transport.runTurn(managedAgent(), "first", controller.signal);
	void running.catch(() => undefined);
	await Promise.resolve();
	controller.abort(new DOMException("turn cancelled", "AbortError"));
	releaseLoading(implementation);

	await assert.rejects(
		running,
		(error) =>
			error instanceof DOMException &&
			error.name === "AbortError" &&
			error.message === "turn cancelled",
	);
	assert.equal(implementation.turns, 0);
	await transport.shutdown?.();
});

test("stateful transport cancellation wins over a loader rejection", async () => {
	let rejectLoading!: (error: Error) => void;
	const loading = new Promise<SubagentTransport>((_resolve, reject) => {
		rejectLoading = reject;
	});
	const transport = createStatefulTransport({
		kind: "subprocess",
		modelRegistry: {} as never,
		getParentRuntime: () => ({ model: undefined, thinkingLevel: "off" }),
		getSettings: () => undefined,
		loadTransport: () => loading,
	});
	const controller = new AbortController();
	const running = transport.runTurn(managedAgent(), "first", controller.signal);
	void running.catch(() => undefined);
	await Promise.resolve();
	controller.abort(new DOMException("turn cancelled", "AbortError"));
	rejectLoading(new Error("loader failed after cancellation"));

	await assert.rejects(
		running,
		(error) =>
			error instanceof DOMException &&
			error.name === "AbortError" &&
			error.message === "turn cancelled",
	);
	await transport.shutdown?.();
});

test("stateful transport rejects an already-cancelled turn without loading", async () => {
	let loads = 0;
	const transport = createStatefulTransport({
		kind: "subprocess",
		modelRegistry: {} as never,
		getParentRuntime: () => ({ model: undefined, thinkingLevel: "off" }),
		getSettings: () => undefined,
		loadTransport: async () => {
			loads += 1;
			return new FakeTransport();
		},
	});
	const controller = new AbortController();
	controller.abort(new DOMException("turn cancelled", "AbortError"));

	await assert.rejects(
		() => transport.runTurn(managedAgent(), "first", controller.signal),
		(error) => error instanceof DOMException && error.name === "AbortError",
	);
	assert.equal(loads, 0);
	await transport.shutdown?.();
});

test("stateful transport shutdown disposes an implementation that resolves after closure", async () => {
	let releaseLoading!: (transport: SubagentTransport) => void;
	const loading = new Promise<SubagentTransport>((resolve) => {
		releaseLoading = resolve;
	});
	const implementation = new FakeTransport();
	const transport = createStatefulTransport({
		kind: "subprocess",
		modelRegistry: {} as never,
		getParentRuntime: () => ({ model: undefined, thinkingLevel: "off" }),
		getSettings: () => undefined,
		loadTransport: () => loading,
	});
	const running = transport.runTurn(managedAgent(), "first", new AbortController().signal);
	void running.catch(() => undefined);
	await Promise.resolve();
	const shutdown = transport.shutdown?.();
	releaseLoading(implementation);
	await shutdown;
	await assert.rejects(running, /shut down while loading/u);
	assert.equal(implementation.turns, 0);
	assert.equal(implementation.shutdowns, 1);
});
