import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package declares one source extension and one bundled operating skill", () => {
	const manifest = JSON.parse(
		readFileSync(path.join(packageDirectory, "package.json"), "utf8"),
	) as {
		files: string[];
		pi: { extensions: string[]; skills: string[] };
		piExtension: { lifecycle: string };
	};
	assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
	assert.deepEqual(manifest.pi.skills, ["./skills"]);
	assert.equal(manifest.piExtension.lifecycle, "experimental");
	assert.ok(manifest.files.includes("src"));
	assert.ok(manifest.files.includes("skills"));
});

test("bundled skill documents every minimal-runtime operating responsibility", () => {
	const skill = readFileSync(
		path.join(packageDirectory, "skills", "subagents-v2", "SKILL.md"),
		"utf8",
	);
	for (const evidence of [
		/prefer direct work/i,
		/subagent-v2-consult/i,
		/self-contained tasks/i,
		/shortest realistic execution deadline/i,
		/parallel tool batch/i,
		/subagent-v2-wait/i,
		/wait timeout does not cancel/i,
		/subagent-v2-inspect/i,
		/subagent-v2-cancel/i,
		/partial.*failed.*timed_out.*cancelled/is,
		/worker's statements.*claims rather than proof/is,
		/disjoint.*ownership/is,
		/workspace isolation/i,
	]) {
		assert.match(skill, evidence);
	}
	for (const nonGoal of [
		"retained conversations",
		"follow-up turns",
		"mailboxes",
		"chains",
		"panels",
		"workflows",
		"nested subagents",
	]) {
		assert.match(skill, new RegExp(nonGoal, "i"));
	}
});
