import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import {
	discoverAgentCatalog,
	discoverAgents,
	formatAgentCatalog,
	formatAgentList,
} from "../src/agents.js";
import subagents from "../src/subagents.js";
import { installSubagentsTestEnvironment, type SubagentTool } from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
writeFileSync(
	path.join(process.env.PI_CODING_AGENT_DIR ?? "", "pi-subagents.json"),
	JSON.stringify({ blocking: { enabled: true }, stateful: { enabled: true } }),
);
afterAll(restoreTestEnvironment);

test("subagent recursion guard rejects nested delegation before spawning", async () => {
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools[0] as SubagentTool;
	const originalDepth = process.env.PI_SUBAGENT_DEPTH;
	process.env.PI_SUBAGENT_DEPTH = "1";
	try {
		await assert.rejects(
			() =>
				tool.execute(
					"call",
					{ agent: "explorer", task: "nested" },
					undefined,
					undefined,
					createMockContext().ctx,
				),
			/recursion depth limit/,
		);
	} finally {
		if (originalDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = originalDepth;
	}
});

test("one-shot project agents require project trust even when confirmation is disabled", async () => {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-untrusted-"));
	const agentsDir = path.join(cwd, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });
	writeFileSync(
		path.join(agentsDir, "project.md"),
		"---\nname: project\ndescription: project agent\n---\nProject prompt.",
	);
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools[0] as SubagentTool;
	const spawn = mock.tools.find((candidate) => candidate.name === "subagent_spawn") as
		| SubagentTool
		| undefined;
	assert.ok(spawn);
	try {
		await assert.rejects(
			() =>
				tool.execute(
					"call",
					{
						agent: "project",
						task: "task",
						agentScope: "project",
						confirmProjectAgents: false,
					},
					undefined,
					undefined,
					createMockContext({ cwd, isProjectTrusted: () => false }).ctx,
				),
			/trusted project/,
		);
		await assert.rejects(
			() =>
				tool.execute(
					"call",
					{ agent: "missing", task: "task", agentScope: "project" },
					undefined,
					undefined,
					createMockContext({ cwd, isProjectTrusted: () => false }).ctx,
				),
			/trusted project/,
		);
		await assert.rejects(
			() =>
				spawn.execute(
					"call",
					{ agent: "missing", task: "task", agentScope: "project" },
					undefined,
					undefined,
					createMockContext({ cwd, isProjectTrusted: () => false }).ctx,
				),
			/trusted project/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("one-shot project confirmation renders project metadata as one safe line", async () => {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-project-confirm-"));
	const agentsDir = path.join(cwd, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });
	const agentName = "project\u001b[31m\nspoof";
	writeFileSync(
		path.join(agentsDir, "project.md"),
		`---\nname: "project\\u001b[31m\\nspoof"\ndescription: project agent\n---\nProject prompt.`,
	);
	let confirmation = "";
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools[0] as SubagentTool;
		const result = await tool.execute(
			"call",
			{ agent: agentName, task: "task", agentScope: "project" },
			undefined,
			undefined,
			createMockContext({
				cwd,
				hasUI: true,
				isProjectTrusted: () => true,
				confirm: async (title: string, message: string) => {
					confirmation = `${title}\n${message}`;
					return false;
				},
			}).ctx,
		);
		assert.match(result.content?.[0]?.text ?? "", /Canceled/);
		assert.equal(confirmation.includes("\u001b"), false);
		assert.doesNotMatch(confirmation, /\nspoof\nSource:/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("discoverAgents includes built-ins and lets project agents override by name", () => {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-test-"));
	const agentsDir = path.join(cwd, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });
	writeFileSync(
		path.join(agentsDir, "explorer.md"),
		[
			"---",
			"name: explorer",
			"description: Project-specific explorer",
			"tools: read,bash",
			"model: gpt-test",
			"thinkingLevel: high",
			"---",
			"Project explorer prompt.",
		].join("\n"),
	);

	const baseResult = discoverAgents(cwd, "project");
	const baseExplorer = baseResult.agents.find((agent) => agent.name === "explorer");
	assert.equal(baseExplorer?.thinkingLevel, "high");

	const result = discoverAgents(cwd, "project", {
		agents: { explorer: { timeoutMs: 1234, thinkingLevel: "low" } },
	});
	const explorer = result.agents.find((agent) => agent.name === "explorer");

	assert.equal(result.projectAgentsDir, agentsDir);
	assert.equal(explorer?.source, "project");
	assert.deepEqual(explorer?.tools, ["read", "bash"]);
	assert.equal(explorer?.model, "gpt-test");
	assert.equal(explorer?.thinkingLevel, "low");
	assert.equal(explorer?.timeoutMs, 1234);

	const cleared = discoverAgents(cwd, "project", { agents: { explorer: { thinkingLevel: null } } });
	assert.equal(cleared.agents.find((agent) => agent.name === "explorer")?.thinkingLevel, undefined);
	assert.ok(result.agents.some((agent) => agent.name === "worker" && agent.source === "built-in"));
});

test("removed built-in agent names are unavailable", () => {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-removed-agent-test-"));
	try {
		const names = discoverAgents(cwd, "project").agents.map((agent) => agent.name);

		assert.equal(names.includes("reviewer"), false);
		assert.equal(names.includes("scout"), false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("formatAgentList returns concise text and remaining count", () => {
	const agents = discoverAgents(process.cwd(), "project").agents;
	const formatted = formatAgentList(agents, 2);

	assert.match(formatted.text, /explorer \(built-in\)/);
	assert.equal(formatted.remaining, Math.max(0, agents.length - 2));
});

test("formatAgentCatalog advertises scope variants deterministically and within bounds", () => {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-catalog-format-"));
	try {
		const projectAgentsDir = path.join(cwd, ".pi", "agents");
		mkdirSync(projectAgentsDir, { recursive: true });
		writeFileSync(
			path.join(projectAgentsDir, "explorer.md"),
			"---\nname: explorer\ndescription: Project\n---\nProject prompt.",
		);
		writeFileSync(
			path.join(projectAgentsDir, "project.md"),
			"---\nname: project\ndescription: First\n---\nProject prompt.",
		);
		const user = discoverAgentCatalog(cwd, false).user;
		const worker = user.agents.find((agent) => agent.name === "worker");
		assert.ok(worker);
		user.agents = user.agents.map((agent) =>
			agent.name === "worker"
				? { ...agent, source: "user" as const, description: "User worker override" }
				: agent,
		);
		const project = discoverAgentCatalog(cwd, true).project;
		assert.ok(project);
		const first = formatAgentCatalog({ user, project }, { maxCharacters: 5_000 });
		const second = formatAgentCatalog({ user, project }, { maxCharacters: 5_000 });
		assert.equal(first.text, second.text);
		assert.match(first.text, /explorer \[source: built-in; agentScope: "user"\]/);
		assert.match(first.text, /capabilities: repository-search, code-evidence/);
		assert.match(first.text, /tools: read, grep, find, ls/);
		assert.match(first.text, /filesystem: read/);
		assert.match(first.text, /result formats: text, structured-v1, structured-v2/);
		assert.match(first.text, /use capability and tool identifiers exactly as shown/i);
		assert.match(first.text, /enforced.*readPaths.*writePaths.*network.*secrets.*unsupported/i);
		assert.match(
			first.text,
			/explorer \[source: project; requires agentScope: "project" or "both"/,
		);
		assert.match(first.text, /capabilities: undeclared/);
		assert.match(first.text, /tools: read, bash, edit, write/);
		assert.match(first.text, /filesystem: undeclared/);
		assert.match(first.text, /result formats: undeclared/);
		assert.match(first.text, /Project/);
		assert.match(first.text, /Same-name precedence/);
		assert.match(first.text, /project \[source: project/);
		assert.match(first.text, /worker \[source: user; agentScope: "user"/);
		assert.match(first.text, /worker \[source: built-in; requires agentScope: "project"/);
		assert.match(first.text, /both.*selects the user definition/);
		assert.ok(first.text.length <= 5_000);

		const incomplete = formatAgentCatalog({
			user: { ...user, omittedAgentDefinitions: 1 },
			project,
		});
		assert.doesNotMatch(incomplete.text, /source: built-in/);
		const failedDiscovery = formatAgentCatalog({
			user: { ...user, metadataDiscoveryIncomplete: true },
			project,
		});
		assert.match(failedDiscovery.text, /metadata discovery was incomplete/);

		writeFileSync(
			path.join(projectAgentsDir, "huge.md"),
			`---\nname: huge\ndescription: Huge\n---\n${"x".repeat(70 * 1024)}`,
		);
		const boundedProject = discoverAgentCatalog(cwd, true).project;
		const bounded = formatAgentCatalog(
			{ user, project: boundedProject },
			{ maxItems: 2, maxDescriptionLength: 8, maxCharacters: 2_000 },
		);
		assert.match(bounded.text, /additional agent definition.*omitted/);
		assert.doesNotMatch(bounded.text, /x{100}/);
		assert.ok(bounded.omitted > 0);
		assert.match(
			bounded.text,
			new RegExp(`\\[${bounded.omitted} additional agent definitions? omitted`),
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("session start refreshes detached limits and retains the last valid snapshot after read errors", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-session-limits-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const settingsPath = path.join(directory, "pi-subagents.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				stateful: {
					maxAgents: 3,
					maxActiveTurns: 2,
					maxChildrenPerAgent: 4,
					maxDepth: 1,
					maxStoredAgents: 6,
				},
			}),
		);
		const mock = createMockPi();
		subagents(mock.pi);
		const context = createMockContext();
		const start = async () => {
			for (const handler of mock.events.get("session_start") ?? []) {
				await handler({}, context.ctx);
			}
			return String(
				mock.tools.filter((tool) => tool.name === "subagent_spawn").at(-1)?.description ?? "",
			);
		};

		assert.match(await start(), /3 retained agents, 2 active turns, 4 direct children.*depth 1/i);
		writeFileSync(
			settingsPath,
			JSON.stringify({
				stateful: {
					maxAgents: 7,
					maxActiveTurns: 5,
					maxChildrenPerAgent: 6,
					maxDepth: 2,
					maxStoredAgents: 9,
				},
			}),
		);
		assert.match(await start(), /7 retained agents, 5 active turns, 6 direct children.*depth 2/i);

		writeFileSync(settingsPath, "{ malformed");
		assert.match(await start(), /7 retained agents, 5 active turns, 6 direct children.*depth 2/i);
		assert.match(context.notifications.at(-1)?.message ?? "", /malformed|invalid/i);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("session start refreshes every agent catalog and gates project metadata on trust", async () => {
	const agentDir = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-catalog-user-"));
	const trustedCwd = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-catalog-trusted-"));
	const untrustedCwd = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-catalog-untrusted-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		writeFileSync(
			path.join(agentDir, "pi-subagents.json"),
			JSON.stringify({ blocking: { enabled: true }, stateful: { enabled: true } }),
		);
		mkdirSync(path.join(agentDir, "agents"), { recursive: true });
		writeFileSync(
			path.join(agentDir, "agents", "api-reviewer.md"),
			"---\nname: api-reviewer\ndescription: Reviews API compatibility\n---\nReview APIs.",
		);
		writeFileSync(
			path.join(agentDir, "agents", "explorer.md"),
			"---\nname: explorer\ndescription: User explorer override\n---\nUser explorer.",
		);
		for (const cwd of [trustedCwd, untrustedCwd]) {
			mkdirSync(path.join(cwd, ".pi", "agents"), { recursive: true });
			writeFileSync(
				path.join(cwd, ".pi", "agents", "local.md"),
				"---\nname: local\ndescription: Project-only description\n---\nProject work.",
			);
			writeFileSync(
				path.join(cwd, ".pi", "agents", "explorer.md"),
				"---\nname: explorer\ndescription: Project explorer override\n---\nProject explorer.",
			);
		}
		const mock = createMockPi();
		subagents(mock.pi);
		const start = async (cwd: string, trusted: boolean) => {
			const context = createMockContext({ cwd, isProjectTrusted: () => trusted });
			for (const handler of mock.events.get("session_start") ?? []) {
				await handler({}, context.ctx);
			}
			return {
				blocking: String(
					mock.tools.filter((tool) => tool.name === "subagent").at(-1)?.description ?? "",
				),
				spawn: String(
					mock.tools.filter((tool) => tool.name === "subagent_spawn").at(-1)?.description ?? "",
				),
				consult: String(
					mock.tools.filter((tool) => tool.name === "subagent_consult").at(-1)?.description ?? "",
				),
			};
		};
		const untrusted = await start(untrustedCwd, false);
		for (const description of Object.values(untrusted)) {
			assert.match(description, /api-reviewer/);
			assert.match(description, /User explorer override/);
			assert.doesNotMatch(
				description,
				/Project-only description|Project explorer override|local \[source: project|explorer \[source: project/,
			);
		}
		const trusted = await start(trustedCwd, true);
		for (const description of Object.values(trusted)) {
			assert.match(description, /local \[source: project/);
			assert.match(description, /agentScope: "project" or "both"/);
			assert.match(description, /Project-only description/);
			assert.match(description, /Project explorer override/);
			assert.doesNotMatch(description, /untrusted/);
		}
		const untrustedAgain = await start(untrustedCwd, false);
		for (const description of Object.values(untrustedAgain)) {
			assert.doesNotMatch(
				description,
				/Project-only description|Project explorer override|local \[source: project|explorer \[source: project/,
			);
		}
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(trustedCwd, { recursive: true, force: true });
		rmSync(untrustedCwd, { recursive: true, force: true });
	}
});
