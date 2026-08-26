import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { BROKER_ENV } from "../src/message-broker.js";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package declares one source extension and one bundled operating skill", () => {
	const manifest = JSON.parse(
		readFileSync(path.join(packageDirectory, "package.json"), "utf8"),
	) as {
		name: string;
		files: string[];
		pi: { extensions: string[]; skills: string[] };
		piExtension: { lifecycle: string };
		peerDependencies: Record<string, string>;
		repository: { directory: string };
	};
	assert.equal(manifest.name, "@narumitw/pi-subagents-v3");
	assert.equal(manifest.repository.directory, "packages/pi-subagents-v3");
	assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
	assert.deepEqual(manifest.pi.skills, ["./skills"]);
	assert.equal(manifest.piExtension.lifecycle, "experimental");
	assert.equal(manifest.peerDependencies["@earendil-works/pi-ai"], "*");
	assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
	assert.ok(manifest.files.includes("src"));
	assert.ok(manifest.files.includes("skills"));
	assert.ok(manifest.files.includes("docs"));
});

test("bundled skill documents every minimal-runtime operating responsibility", () => {
	const skill = readFileSync(
		path.join(packageDirectory, "skills", "subagents-v3", "SKILL.md"),
		"utf8",
	);
	for (const evidence of [
		/prefer direct work/i,
		/subagent-spawn/i,
		/default of `read`, `grep`, `find`, and `ls`/i,
		/select only from `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`/i,
		/smallest sufficient tool set/i,
		/`bash` and `powershell` as unrestricted command execution/i,
		/inherits the main agent's effective provider and model/i,
		/omit `thinkingLevel` to follow the main agent/i,
		/self-contained tasks/i,
		/shortest realistic execution deadline/i,
		/parallel tool batch/i,
		/subagent-wait/i,
		/wait timeout does not cancel/i,
		/subagent-inspect/i,
		/subagent-cancel/i,
		/subagent-ask/i,
		/subagent-reply/i,
		/not.*user request.*permission/is,
		/partial.*failed.*timed_out.*cancelled/is,
		/writer's statements.*claims rather than proof/is,
		/disjoint.*ownership/is,
		/workspace isolation/i,
	]) {
		assert.match(skill, evidence);
	}
	for (const nonGoal of [
		"retained conversations",
		"user-directed follow-up turns",
		"mailboxes",
		"chains",
		"panels",
		"workflows",
		"nested subagents",
	]) {
		assert.match(skill, new RegExp(nonGoal, "i"));
	}
});

test("Pi's Jiti loader resolves the package entry and child bridge", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-v3-loader-"));
	const agentDir = path.join(root, "agent");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		mkdirSync(agentDir, { recursive: true });
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env[BROKER_ENV.host] = "127.0.0.1";
		process.env[BROKER_ENV.port] = "31337";
		process.env[BROKER_ENV.token] = "a".repeat(64);
		const mainLoader = new DefaultResourceLoader({
			cwd: packageDirectory,
			agentDir,
			settingsManager: SettingsManager.inMemory({}),
			additionalExtensionPaths: [path.join(packageDirectory, "src", "index.ts")],
		});
		await mainLoader.reload();
		const loadedMain = mainLoader.getExtensions();
		assert.deepEqual(loadedMain.errors, []);
		assert.equal(loadedMain.extensions.length, 1);
		const main = loadedMain.extensions[0];
		assert.ok(main?.handlers.has("session_start"));
		assert.ok(main?.handlers.has("session_shutdown"));
		assert.deepEqual(
			[...(main?.tools.keys() ?? [])],
			["subagent-spawn", "subagent-inspect", "subagent-cancel", "subagent-wait", "subagent-reply"],
		);

		const childLoader = new DefaultResourceLoader({
			cwd: packageDirectory,
			agentDir,
			settingsManager: SettingsManager.inMemory({}),
			additionalExtensionPaths: [
				path.join(packageDirectory, "src", "child-communication-bridge.ts"),
			],
		});
		await childLoader.reload();
		const loadedChild = childLoader.getExtensions();
		assert.deepEqual(loadedChild.errors, []);
		assert.equal(loadedChild.extensions.length, 1);
		assert.deepEqual(
			[...(loadedChild.extensions[0]?.tools.keys() ?? [])],
			["subagent-ask", "subagent-wait"],
		);
		assert.equal(process.env[BROKER_ENV.host], undefined);
		assert.equal(process.env[BROKER_ENV.port], undefined);
		assert.equal(process.env[BROKER_ENV.token], undefined);
	} finally {
		delete process.env[BROKER_ENV.host];
		delete process.env[BROKER_ENV.port];
		delete process.env[BROKER_ENV.token];
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
});
