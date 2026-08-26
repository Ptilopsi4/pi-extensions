import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string) {
	return readFileSync(resolve(root, relativePath), "utf8");
}

test("check and test remain separate CI gates", () => {
	const runChecks = read("scripts/run-checks.mjs");
	const checksMatch = /const checks = (\[[^\n]+\]);/u.exec(runChecks);
	assert.ok(checksMatch, "run-checks must declare its task list");
	assert.deepEqual(JSON.parse(checksMatch[1] ?? "[]"), [
		"biome:check",
		"check:boundaries",
		"typecheck",
	]);

	const manifest = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
	assert.match(manifest.scripts?.check ?? "", /run-checks\.mjs/u);
	assert.match(manifest.scripts?.test ?? "", /run-tests\.mjs/u);
	assert.doesNotMatch(manifest.scripts?.check ?? "", /npm (?:run )?test/u);

	const ciWorkflow = read(".github/workflows/ci.yml");
	const checkIndex = ciWorkflow.indexOf("run: npm run check");
	const testIndex = ciWorkflow.indexOf("run: npm test");
	assert.ok(checkIndex >= 0, "CI must run checks");
	assert.ok(testIndex > checkIndex, "CI must run tests after checks");

	const publishWorkflow = read(".github/workflows/publish.yml");
	assert.doesNotMatch(
		publishWorkflow,
		/\bnpm (?:run )?(?:check|typecheck|test)\b/u,
		"publish must rely on CI instead of rerunning tests or typechecks",
	);
});
