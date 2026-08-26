import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import type { ManagedAgent, TurnOutcome } from "../src/registry.js";
import { registerStatefulSubagents } from "../src/stateful.js";
import type { SubagentTransport } from "../src/transport.js";

class ControlledTransport implements SubagentTransport {
	readonly kind = "fake" as const;
	readonly pending: Array<{
		agent: ManagedAgent;
		resolve: (outcome: TurnOutcome) => void;
	}> = [];

	runTurn(agent: ManagedAgent, _task: string, signal: AbortSignal): Promise<TurnOutcome> {
		return new Promise((resolve) => {
			const pending = { agent, resolve };
			this.pending.push(pending);
			signal.addEventListener(
				"abort",
				() => {
					this.remove(pending);
					resolve({ output: "", exitCode: 130, aborted: true });
				},
				{ once: true },
			);
		});
	}

	complete(output: string): void {
		const pending = this.pending.shift();
		if (!pending) throw new Error("No pending subagent turn");
		pending.resolve({ output, exitCode: 0 });
	}

	private remove(pending: (typeof this.pending)[number]): void {
		const index = this.pending.indexOf(pending);
		if (index >= 0) this.pending.splice(index, 1);
	}
}

async function waitForPending(transport: ControlledTransport): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (transport.pending.length === 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(transport.pending.length, 1);
}

test("subagent_await blocks one retained turn without interrupting on timeout or cancellation", async () => {
	const originalDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-await-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const transport = new ControlledTransport();
		const mock = createMockPi();
		registerStatefulSubagents(mock.pi, {
			loadTransport: async () => transport,
		});
		const context = createMockContext();
		await mock.events.get("session_start")?.[0]?.({}, context.ctx);
		const execute = async (
			name: string,
			params: Record<string, unknown>,
			signal = new AbortController().signal,
		) => {
			const tool = mock.tools.find((candidate) => candidate.name === name) as {
				execute: (...args: unknown[]) => Promise<unknown>;
			};
			assert.ok(tool, `${name} must be registered`);
			return tool.execute("call", params, signal, undefined, context.ctx) as Promise<{
				content: Array<{ text: string }>;
				details: {
					agent: { id: string; state: string };
					timedOut?: boolean;
					timeoutMs?: number;
					output?: string;
				};
			}>;
		};

		const spawned = await execute("subagent_spawn", {
			agent: "explorer",
			task: "first",
		});
		const agentId = spawned.details.agent.id;
		await waitForPending(transport);
		const settling = execute("subagent_await", { agentId, timeoutMs: 1_000 });
		transport.complete("FIRST_AWAIT_OUTPUT");
		const settled = await settling;
		assert.equal(settled.details.timedOut, false);
		assert.equal(settled.details.timeoutMs, 1_000);
		assert.equal(settled.details.agent.state, "completed");
		assert.equal(settled.details.output, "FIRST_AWAIT_OUTPUT");
		assert.match(settled.content[0]?.text ?? "", /FIRST_AWAIT_OUTPUT/);

		await execute("subagent_send", { agentId, task: "second" });
		await waitForPending(transport);
		const timedOut = await execute("subagent_await", { agentId, timeoutMs: 5 });
		assert.equal(timedOut.details.timedOut, true);
		assert.equal(timedOut.details.agent.state, "running");
		assert.equal(transport.pending.length, 1, "wait timeout must not interrupt the child");

		const cancellation = new AbortController();
		const cancelledWait = execute(
			"subagent_await",
			{ agentId, timeoutMs: 1_000 },
			cancellation.signal,
		);
		cancellation.abort();
		await assert.rejects(cancelledWait, /wait was aborted/i);
		assert.equal(transport.pending.length, 1, "wait cancellation must not interrupt the child");

		transport.complete("SECOND_AWAIT_OUTPUT");
		const immediate = await execute("subagent_await", { agentId });
		assert.equal(immediate.details.timedOut, false);
		assert.equal(immediate.details.timeoutMs, 30_000);
		assert.equal(immediate.details.output, "SECOND_AWAIT_OUTPUT");
		await assert.rejects(
			() => execute("subagent_await", { agentId: "sa_unknown" }),
			/Unknown subagent/,
		);

		await execute("subagent_send", { agentId, task: "third" });
		await waitForPending(transport);
		const staleWait = execute("subagent_await", { agentId, timeoutMs: 1_000 });
		const shutdown = mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
		await assert.rejects(staleWait, /owner was replaced or aborted/i);
		await shutdown;
		assert.equal(transport.pending.length, 0);
	} finally {
		if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalDir;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("subagent_await is exposed whenever retained agents are enabled", () => {
	const enabled = createMockPi();
	registerStatefulSubagents(enabled.pi);
	assert.equal(
		enabled.tools.some((tool) => tool.name === "subagent_await"),
		true,
	);

	const disabled = createMockPi();
	registerStatefulSubagents(disabled.pi, { settings: { enabled: false } });
	assert.equal(
		disabled.tools.some((tool) => tool.name === "subagent_await"),
		false,
	);
});
