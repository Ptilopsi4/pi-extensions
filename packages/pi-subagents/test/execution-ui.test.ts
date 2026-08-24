import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import {
	applyAgentModel,
	applyAgentThinking,
	applyAgentTimeout,
	executionAgentScreen,
	executionModelScreen,
	resetAgentExecution,
} from "../src/execution-ui.js";
import { updateAgentSettingsPatch } from "../src/settings.js";
import { resolveStatefulLimits } from "../src/stateful-limits.js";
import { applyTransportSetting, transportSettingsScreen } from "../src/transport-ui.js";

function withAgentDir(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-execution-ui-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	return run(directory).finally(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(directory, { recursive: true, force: true });
	});
}

function runtime(retainedAgents = 0) {
	return {
		getRuntimeStatus: () => ({
			enabled: true,
			initialized: true,
			transport: "subprocess" as const,
			completionDelivery: "next-turn" as const,
			limits: resolveStatefulLimits(),
			activeAgents: 0,
			retainedAgents,
		}),
	};
}

test("per-agent execution screens expose defaults without profile presets", async () => {
	await withAgentDir(async () => {
		assert.match(
			JSON.stringify(
				executionAgentScreen({
					name: "explorer",
					description: "explorer",
					systemPrompt: "",
					source: "built-in",
					filePath: "built-in:explorer",
					thinkingLevel: "low",
				}),
			),
			/model.*Thinking.*low.*Time limit/i,
		);
		const catalogContext = createMockContext({
			modelRegistry: { getAvailable: () => [{ provider: "fake", id: "model" }] },
		});
		assert.match(
			JSON.stringify(
				executionModelScreen(
					{
						name: "explorer",
						description: "explorer",
						systemPrompt: "",
						source: "built-in",
						filePath: "built-in:explorer",
					},
					catalogContext.ctx,
				),
			),
			/fake\/model/,
		);
	});
});

test("per-agent execution controls validate, preserve tools, and restore agent defaults", async () => {
	await withAgentDir(async (directory) => {
		const context = createMockContext();
		const agent = {
			name: "explorer",
			description: "explorer",
			tools: ["read"],
			systemPrompt: "",
			source: "built-in" as const,
			filePath: "built-in:explorer",
		};
		updateAgentSettingsPatch({ explorer: { tools: ["read"] } });
		assert.equal(applyAgentThinking(agent, "high", context.ctx).kind, "back");
		assert.equal(applyAgentModel(agent, "provider/model", context.ctx).kind, "back");
		assert.equal(applyAgentTimeout(agent, "1234", context.ctx).kind, "back");
		assert.equal(applyAgentTimeout(agent, "0", context.ctx).kind, "rejected");
		let saved = JSON.parse(readFileSync(path.join(directory, "pi-subagents.json"), "utf8"));
		assert.equal(saved.agents.explorer.thinkingLevel, "high");
		assert.equal(saved.agents.explorer.model, "provider/model");
		assert.equal(saved.agents.explorer.timeoutMs, 1234);
		assert.equal(resetAgentExecution(agent, context.ctx).kind, "back");
		saved = JSON.parse(readFileSync(path.join(directory, "pi-subagents.json"), "utf8"));
		assert.deepEqual(saved.agents.explorer, { tools: ["read"] });
	});
});

test("transport setting protects saved subagents and applies after reload", async () => {
	await withAgentDir(async (directory) => {
		const blocked = createMockContext({ confirm: async () => true });
		const blockedResult = await applyTransportSetting(
			"rpc",
			blocked.ctx,
			runtime(1),
			new AbortController().signal,
			() => true,
		);
		assert.equal(blockedResult.kind, "rejected");
		assert.match(blocked.notifications.at(-1)?.message ?? "", /saved for follow-up/i);
		assert.equal(existsSync(path.join(directory, "pi-subagents.json")), false);

		const accepted = createMockContext({ confirm: async () => true });
		const result = await applyTransportSetting(
			"auto",
			accepted.ctx,
			runtime(),
			new AbortController().signal,
			() => true,
		);
		assert.equal(result.kind, "stay");
		const saved = JSON.parse(readFileSync(path.join(directory, "pi-subagents.json"), "utf8"));
		assert.equal(saved.stateful.transport, "auto");
		assert.match(accepted.notifications.at(-1)?.message ?? "", /reload/i);
		assert.match(JSON.stringify(transportSettingsScreen(runtime())), /Persistent process \(RPC\)/);
		assert.match(JSON.stringify(transportSettingsScreen(runtime())), /Automatic · Recommended/);
	});
});
