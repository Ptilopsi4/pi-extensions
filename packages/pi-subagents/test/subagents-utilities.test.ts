import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import {
	buildPiArgs,
	formatTokens,
	formatUsageStats,
	parsePositiveInteger,
	resolveSubagentThinkingLevel,
	sameToolSet,
	uniqueToolNames,
} from "../src/subagents.js";
import { installSubagentsTestEnvironment } from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
afterAll(restoreTestEnvironment);

test("subagent formatting and set helpers are deterministic", () => {
	assert.equal(parsePositiveInteger("42ms"), 42);
	assert.equal(parsePositiveInteger("0"), undefined);
	assert.equal(formatTokens(1530), "1.5k");
	assert.equal(
		formatUsageStats(
			{ input: 1500, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.0123, turns: 2 },
			"gpt",
		),
		"2 turns ↑1.5k ↓20 $0.0123 gpt",
	);
	assert.equal(
		formatUsageStats(
			{ input: 1500, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.0123, turns: 2 },
			"gpt",
			"high",
		),
		"2 turns ↑1.5k ↓20 $0.0123 gpt requested-thinking:high",
	);
	assert.equal(
		formatUsageStats(
			{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			"requested-alias",
			"high",
			"actual-provider",
			"actual-model",
		),
		"actual-provider/actual-model requested-thinking:high",
	);
	assert.deepEqual(uniqueToolNames(["read", "read", "bash"]), ["read", "bash"]);
	assert.equal(sameToolSet(["read", "bash"], ["bash", "read"]), true);
});

test("subagent thinking levels resolve by local, top-level, then agent default", () => {
	const agents = [{ name: "explorer", thinkingLevel: "low" }, { name: "reviewer" }] as const;

	assert.equal(resolveSubagentThinkingLevel(agents, "explorer", "medium", "high"), "high");
	assert.equal(resolveSubagentThinkingLevel(agents, "explorer", "medium"), "medium");
	assert.equal(resolveSubagentThinkingLevel(agents, "explorer"), "low");
	assert.equal(resolveSubagentThinkingLevel(agents, "reviewer"), undefined);
	assert.equal(resolveSubagentThinkingLevel(agents, "missing", "minimal"), "minimal");
});

test("buildPiArgs passes thinking only when requested", () => {
	assert.deepEqual(buildPiArgs({ task: "do it" }), [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"Task: do it",
	]);
	assert.deepEqual(
		buildPiArgs({
			model: "sonnet",
			thinkingLevel: "high",
			tools: ["read", "bash"],
			systemPromptPath: "/tmp/prompt.md",
			task: "review code",
		}),
		[
			"--mode",
			"json",
			"-p",
			"--no-session",
			"--model",
			"sonnet",
			"--thinking",
			"high",
			"--tools",
			"read,bash",
			"--append-system-prompt",
			"/tmp/prompt.md",
			"Task: review code",
		],
	);
	assert.deepEqual(buildPiArgs({ thinkingLevel: "off", tools: [], task: "no tools" }), [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--thinking",
		"off",
		"--no-tools",
		"Task: no tools",
	]);
});
