import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { registerStatefulSubagents } from "../src/stateful.js";
import type { WorkspaceManager } from "../src/workspace.js";

test("requirement reconciliation persistence failure remains observable without leaking startup", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-requirement-save-failure-"));
	const originalDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	writeFileSync(path.join(root, "pi-subagents-state"), "blocks state directory creation");
	try {
		const mock = createMockPi();
		const controller = registerStatefulSubagents(mock.pi);
		const context = createMockContext({ hasUI: true });
		await mock.events.get("session_start")?.[0]?.({ reason: "fork" }, context.ctx);
		assert.equal(controller.getRuntimeStatus().initialized, true);
		assert.equal(
			context.notifications.some(
				(notification) =>
					notification.level === "warning" &&
					/requirement reconciliation could not be persisted yet/i.test(notification.message),
			),
			true,
		);
		await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
		assert.equal(controller.getRuntimeStatus().initialized, false);
	} finally {
		if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalDir;
		rmSync(root, { recursive: true, force: true });
	}
});

test("stateful worktree spawn revalidates session ownership and cleans stale work", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-stale-worktree-"));
	const agentDir = path.join(root, "agent-home");
	const workspace = path.join(root, "workspace");
	const generated = path.join(root, "generated");
	mkdirSync(agentDir);
	mkdirSync(workspace);
	mkdirSync(generated);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	let beginCreate: (() => void) | undefined;
	const createStarted = new Promise<void>((resolve) => {
		beginCreate = resolve;
	});
	let finishCreate:
		| ((value: {
				mode: "worktree";
				path: string;
				rootPath: string;
				repositoryRoot: string;
		  }) => void)
		| undefined;
	const created = new Promise<{
		mode: "worktree";
		path: string;
		rootPath: string;
		repositoryRoot: string;
	}>((resolve) => {
		finishCreate = resolve;
	});
	let cleaned = 0;
	let childCreates = 0;
	const workspaceManager = {
		async create() {
			beginCreate?.();
			return created;
		},
		async cleanup() {
			cleaned++;
		},
		async cleanupAll() {},
	} as unknown as WorkspaceManager;
	try {
		const mock = createMockPi();
		const controller = registerStatefulSubagents(mock.pi, {
			settings: { transport: "in-process" },
			workspaceManager,
			createInProcessSession: async () => {
				childCreates++;
				throw new Error("stale spawn must not create a child");
			},
		});
		const first = createMockContext({ cwd: workspace, isProjectTrusted: () => true });
		await mock.events.get("session_start")?.[0]?.({}, first.ctx);
		const spawn = mock.tools.find((tool) => tool.name === "subagent_spawn") as
			| { execute: (...args: unknown[]) => Promise<unknown> }
			| undefined;
		assert.ok(spawn);
		const pending = spawn.execute(
			"worktree",
			{ agent: "explorer", task: "inspect", workspaceMode: "worktree" },
			undefined,
			undefined,
			first.ctx,
		);
		await createStarted;
		const replacement = createMockContext({ cwd: workspace, isProjectTrusted: () => true });
		await mock.events.get("session_start")?.[0]?.({}, replacement.ctx);
		finishCreate?.({
			mode: "worktree",
			path: generated,
			rootPath: generated,
			repositoryRoot: workspace,
		});
		await assert.rejects(pending, (error) => error instanceof Error && error.name === "AbortError");
		assert.equal(cleaned, 1);
		assert.equal(childCreates, 0);
		assert.deepEqual(controller.listAgents(), []);
		await mock.events.get("session_shutdown")?.[0]?.({}, replacement.ctx);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test("stale idempotent spawn cleanup cannot delete a replacement session attempt", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-idempotent-replacement-"));
	const agentDir = path.join(root, "agent-home");
	const workspace = path.join(root, "workspace");
	mkdirSync(agentDir);
	mkdirSync(workspace);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	let createCalls = 0;
	const createResolvers: Array<
		(value: { mode: "worktree"; path: string; rootPath: string; repositoryRoot: string }) => void
	> = [];
	const workspaceManager = {
		create: async () => {
			createCalls++;
			if (createCalls > 2) throw new Error("duplicate worktree creation");
			return await new Promise<{
				mode: "worktree";
				path: string;
				rootPath: string;
				repositoryRoot: string;
			}>((resolve) => createResolvers.push(resolve));
		},
		async cleanup() {},
		async cleanupAll() {},
	} as unknown as WorkspaceManager;
	try {
		const mock = createMockPi();
		registerStatefulSubagents(mock.pi, {
			settings: { transport: "in-process" },
			workspaceManager,
			createInProcessSession: async () => {
				const messages: unknown[] = [];
				return {
					sessionId: "idempotent-replacement",
					messages,
					prompt: async () => {
						messages.push({
							role: "assistant",
							content: [{ type: "text", text: "done" }],
							stopReason: "stop",
						});
					},
					subscribe: () => () => undefined,
					abort: async () => undefined,
					dispose: () => undefined,
					getActiveToolNames: () => ["read", "grep", "find", "ls", "bash"],
				};
			},
		});
		const firstContext = createMockContext({ cwd: workspace, isProjectTrusted: () => true });
		await mock.events.get("session_start")?.[0]?.({}, firstContext.ctx);
		const spawn = mock.tools.find((tool) => tool.name === "subagent_spawn") as {
			execute: (...args: unknown[]) => Promise<unknown>;
		};
		const spawnParams = {
			agent: "explorer",
			task: "same request",
			workspaceMode: "worktree" as const,
			idempotencyKey: "replacement-key",
		};
		const first = spawn.execute("first", spawnParams, undefined, undefined, firstContext.ctx);
		while (createCalls < 1) await new Promise<void>((resolve) => setImmediate(resolve));

		const replacementContext = createMockContext({ cwd: workspace, isProjectTrusted: () => true });
		await mock.events.get("session_start")?.[0]?.({}, replacementContext.ctx);
		const second = spawn.execute(
			"second",
			spawnParams,
			undefined,
			undefined,
			replacementContext.ctx,
		) as Promise<{ content: Array<{ text: string }>; details: { agent: { id: string } } }>;
		while (createCalls < 2) await new Promise<void>((resolve) => setImmediate(resolve));

		createResolvers[0]?.({
			mode: "worktree",
			path: path.join(root, "first-worktree"),
			rootPath: path.join(root, "first-worktree"),
			repositoryRoot: workspace,
		});
		await assert.rejects(first, (error) => error instanceof Error && error.name === "AbortError");

		const third = spawn.execute(
			"third",
			spawnParams,
			undefined,
			undefined,
			replacementContext.ctx,
		) as Promise<{ content: Array<{ text: string }>; details: { agent: { id: string } } }>;
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(createCalls, 2, "the retry must join the replacement session's pending spawn");
		createResolvers[1]?.({
			mode: "worktree",
			path: path.join(root, "second-worktree"),
			rootPath: path.join(root, "second-worktree"),
			repositoryRoot: workspace,
		});
		const [secondResult, thirdResult] = await Promise.all([second, third]);
		assert.equal(thirdResult.details.agent.id, secondResult.details.agent.id);
		assert.match(
			secondResult.content[0]?.text ?? "",
			/current response must not depend.*next-turn delivery.*not wake an idle root/i,
		);
		assert.doesNotMatch(secondResult.content[0]?.text ?? "", /end the response/i);
		await mock.events.get("session_shutdown")?.[0]?.({}, replacementContext.ctx);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test("stateful completion delivery routes nested results to the direct parent without root duplication", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-parent-completion-"));
	const agentDir = path.join(root, "agent-home");
	mkdirSync(agentDir);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const mock = createMockPi();
		const controller = registerStatefulSubagents(mock.pi, {
			settings: { transport: "in-process" },
			loadTransport: async () => ({
				kind: "fake",
				async runTurn(_agent, task) {
					return { output: `done:${task}`, exitCode: 0 };
				},
			}),
		});
		const context = createMockContext({ cwd: root, isProjectTrusted: () => true });
		await mock.events.get("session_start")?.[0]?.({}, context.ctx);
		const spawn = mock.tools.find((tool) => tool.name === "subagent_spawn") as {
			execute: (...args: unknown[]) => Promise<{
				details: { agent: { id: string; taskPath: string } };
			}>;
		};
		const parent = await spawn.execute(
			"parent",
			{ agent: "worker", taskName: "parent", task: "parent" },
			undefined,
			undefined,
			context.ctx,
		);
		while (controller.listAgents()[0]?.state === "running") {
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
		const child = await spawn.execute(
			"child",
			{
				agent: "worker",
				taskName: "child",
				task: "child",
				parentId: parent.details.agent.taskPath,
			},
			undefined,
			undefined,
			context.ctx,
		);
		while (
			controller.listAgents().find((agent) => agent.id === child.details.agent.id)?.state ===
			"running"
		) {
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
		const manage = mock.tools.find((tool) => tool.name === "subagent_manage") as {
			execute: (...args: unknown[]) => Promise<unknown>;
		};
		await manage.execute(
			"close-child",
			{ action: "close", agentId: child.details.agent.taskPath },
			undefined,
			undefined,
			context.ctx,
		);
		await vi.runOnlyPendingTimersAsync();
		assert.equal(
			mock.sentMessages.some(({ message }) =>
				String((message as { content?: unknown }).content ?? "").includes(
					`Agent ID: ${child.details.agent.id}`,
				),
			),
			false,
		);
		const retainedParent = controller
			.listAgents()
			.find((agent) => agent.id === parent.details.agent.id);
		const nestedMessage = retainedParent?.mailbox.find(
			(message) => message.senderId === child.details.agent.id,
		);
		assert.equal(nestedMessage?.completionId?.startsWith("completion:"), true);
		assert.match(nestedMessage?.content ?? "", /done:child/);
		await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
	} finally {
		vi.useRealTimers();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test("stateful clear and session replacement serialize active-child cleanup before the new runtime", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-runtime-replacement-"));
	const agentDir = path.join(root, "agent-home");
	const workspace = path.join(root, "workspace");
	mkdirSync(agentDir);
	mkdirSync(workspace);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	let childStarted: (() => void) | undefined;
	const started = new Promise<void>((resolve) => {
		childStarted = resolve;
	});
	let finishPrompt: (() => void) | undefined;
	let aborts = 0;
	let disposals = 0;
	try {
		const mock = createMockPi();
		const controller = registerStatefulSubagents(mock.pi, {
			settings: { transport: "in-process" },
			createInProcessSession: async () => {
				const messages: unknown[] = [];
				return {
					sessionId: "active-child",
					messages,
					prompt: async () => {
						childStarted?.();
						await new Promise<void>((resolve) => {
							finishPrompt = resolve;
						});
					},
					subscribe: () => () => undefined,
					abort: async () => {
						aborts++;
						finishPrompt?.();
					},
					dispose: () => {
						disposals++;
					},
					getActiveToolNames: () => ["read", "grep", "find", "ls", "bash"],
				};
			},
		});
		const first = createMockContext({ cwd: workspace, isProjectTrusted: () => true });
		await mock.events.get("session_start")?.[0]?.({}, first.ctx);
		const spawn = mock.tools.find((tool) => tool.name === "subagent_spawn") as
			| { execute: (...args: unknown[]) => Promise<unknown> }
			| undefined;
		assert.ok(spawn);
		await spawn.execute(
			"active",
			{ agent: "explorer", task: "wait" },
			undefined,
			undefined,
			first.ctx,
		);
		await started;
		const replacement = createMockContext({
			cwd: workspace,
			isProjectTrusted: () => true,
			sessionManager: {
				getSessionId: () => "replacement-session",
				getSessionName: () => undefined,
				getBranch: () => [],
				getEntries: () => [],
			},
		});
		const clearing = controller.clearAgents();
		const replacing = mock.events.get("session_start")?.[0]?.({}, replacement.ctx);
		await Promise.all([clearing, replacing]);
		assert.ok(aborts >= 1);
		assert.equal(disposals, 1);
		assert.deepEqual(controller.listAgents(), []);
		await mock.events.get("session_shutdown")?.[0]?.({}, replacement.ctx);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});
