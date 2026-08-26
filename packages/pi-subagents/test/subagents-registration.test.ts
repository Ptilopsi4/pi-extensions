import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";
import { createMockPi } from "../../../test/support.js";
import subagents from "../src/subagents.js";
import { installSubagentsTestEnvironment } from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
afterAll(restoreTestEnvironment);

const ENABLED_TOOLS = [
	"subagent_spawn",
	"subagent_send",
	"subagent_await",
	"subagent_manage",
	"subagent_mailbox",
	"subagent_inspect",
];

test("subagents registers one stable retained-agent surface and management command", () => {
	const mock = createMockPi();
	subagents(mock.pi);

	assert.deepEqual(
		mock.tools.map((candidate) => candidate.name),
		ENABLED_TOOLS,
	);
	assert.equal(
		mock.tools.some((candidate) => candidate.name === "subagent"),
		false,
	);
	assert.equal(
		mock.tools.some((candidate) => candidate.name === "subagent_consult"),
		false,
	);
	assert.deepEqual(
		[...mock.commands.keys()].filter((name) => name.startsWith("subagents")),
		["subagents"],
	);
	assert.deepEqual(mock.commands.get("subagents")?.getArgumentCompletions?.("s"), [
		{ value: "settings", label: "settings", description: "Open grouped subagent settings" },
		{ value: "status", label: "status", description: "Show detailed subagent diagnostics" },
	]);

	const spawn = mock.tools.find((candidate) => candidate.name === "subagent_spawn");
	assert.ok(spawn);
	const guidelines = Array.isArray(spawn.promptGuidelines)
		? (spawn.promptGuidelines as string[])
		: [];
	assert.match(guidelines.join("\n"), /subagent_await/i);
	assert.doesNotMatch(
		`${spawn.description}\n${spawn.promptSnippet}\n${guidelines.join("\n")}`,
		/\bsubagent_consult\b|deprecated blocking|blocking chain|fan-in|panel|workflow semantics/i,
	);
});

test("disabled retained agents expose inspection only and ignore legacy blocking settings", () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-disabled-surface-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		writeFileSync(
			path.join(directory, "pi-subagents.json"),
			JSON.stringify({
				blocking: { enabled: true, maxParallelTasks: 64 },
				consult: { resources: "all" },
				stateful: { enabled: false },
			}),
		);
		const mock = createMockPi();
		subagents(mock.pi);
		assert.deepEqual(
			mock.tools.map((candidate) => candidate.name),
			["subagent_inspect"],
		);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});
