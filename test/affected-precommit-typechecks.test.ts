import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, test } from "vitest";

interface TypecheckSelection {
	mode: "affected" | "full" | "skip";
	buildWorkspaceNames: string[];
	workspaceDirectories: string[];
	workspaceNames: string[];
	reason: string;
}

interface SelectorModule {
	selectStagedTypechecks(root: string, changedFiles: string[]): TypecheckSelection;
	stagedFiles(root: string): string[];
}

interface TestSelectorModule {
	selectAffectedTests(
		root: string,
		changedFiles: string[],
	): {
		mode: "affected" | "full" | "skip";
		includeRootTests: boolean;
		workspaceDirectories: string[];
	};
}

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const selectorUrl = pathToFileURL(
	path.join(repositoryRoot, "scripts", "select-staged-typechecks.mjs"),
).href;
const testSelectorUrl = pathToFileURL(
	path.join(repositoryRoot, "scripts", "select-affected-tests.mjs"),
).href;
let fixtureRoot: string;
let selector: SelectorModule;
let testSelector: TestSelectorModule;

beforeAll(async () => {
	selector = (await import(selectorUrl)) as SelectorModule;
	testSelector = (await import(testSelectorUrl)) as TestSelectorModule;
	fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "pi-precommit-selection-"));
	writeWorkspace("library", { name: "@fixture/library", scripts: { build: "build" } });
	writeWorkspace("feature", {
		dependencies: { "@fixture/library": "workspace:*" },
		name: "@fixture/feature",
		scripts: { build: "build" },
	});
	writeWorkspace("app", {
		devDependencies: { "@fixture/feature": "workspace:*" },
		name: "@fixture/app",
		scripts: { build: "build" },
	});
	writeWorkspace("unrelated", {
		name: "@fixture/unrelated",
		scripts: { build: "build" },
	});
});

afterAll(() => {
	rmSync(fixtureRoot, { recursive: true, force: true });
});

test("a staged workspace selects transitive dependents and required build dependencies", () => {
	const selection = selector.selectStagedTypechecks(fixtureRoot, ["packages/feature/src/index.ts"]);

	assert.equal(selection.mode, "affected");
	assert.deepEqual(selection.workspaceNames, ["@fixture/feature", "@fixture/app"]);
	assert.deepEqual(selection.workspaceDirectories, ["app", "feature"]);
	assert.deepEqual(selection.buildWorkspaceNames, [
		"@fixture/library",
		"@fixture/feature",
		"@fixture/app",
	]);
});

test("a staged shared library selects all transitive dependents but not unrelated workspaces", () => {
	const selection = selector.selectStagedTypechecks(fixtureRoot, ["packages/library/src/index.ts"]);

	assert.equal(selection.mode, "affected");
	assert.deepEqual(selection.workspaceNames, [
		"@fixture/library",
		"@fixture/feature",
		"@fixture/app",
	]);
	assert.doesNotMatch(selection.workspaceNames.join(" "), /unrelated/u);
});

test("documentation-only staging skips workspace typechecks", () => {
	const selection = selector.selectStagedTypechecks(fixtureRoot, [
		"README.md",
		"packages/feature/docs/usage.md",
		"packages/feature/LICENSE",
	]);

	assert.equal(selection.mode, "skip");
	assert.deepEqual(selection.workspaceNames, []);
	assert.deepEqual(selection.buildWorkspaceNames, []);
});

test("shared root inputs and removed workspaces fall back to all workspaces", () => {
	for (const changedFiles of [
		["package-lock.json"],
		["tsconfig.json"],
		["biome.json"],
		["scripts/run-typechecks.mjs"],
		["packages/removed/src/index.ts"],
		["../outside.ts"],
	]) {
		const selection = selector.selectStagedTypechecks(fixtureRoot, changedFiles);
		assert.equal(selection.mode, "full", changedFiles.join(", "));
		assert.deepEqual(selection.workspaceNames, [
			"@fixture/library",
			"@fixture/feature",
			"@fixture/app",
			"@fixture/unrelated",
		]);
	}
});

test("the existing affected-test selector retains reverse-dependent behavior", () => {
	const selection = testSelector.selectAffectedTests(fixtureRoot, [
		"packages/feature/src/index.ts",
	]);

	assert.equal(selection.mode, "affected");
	assert.equal(selection.includeRootTests, true);
	assert.deepEqual(selection.workspaceDirectories, ["app", "feature"]);
});

test("staged file discovery excludes unstaged changes", () => {
	const gitRoot = mkdtempSync(path.join(os.tmpdir(), "pi-precommit-git-"));
	try {
		git(gitRoot, ["init", "-q"]);
		writeFileSync(path.join(gitRoot, "staged.ts"), "export const staged = 1;\n");
		writeFileSync(path.join(gitRoot, "unstaged.ts"), "export const unstaged = 1;\n");
		git(gitRoot, ["add", "."]);
		git(gitRoot, ["-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);

		writeFileSync(path.join(gitRoot, "staged.ts"), "export const staged = 2;\n");
		writeFileSync(path.join(gitRoot, "unstaged.ts"), "export const unstaged = 2;\n");
		git(gitRoot, ["add", "staged.ts"]);

		assert.deepEqual(selector.stagedFiles(gitRoot), ["staged.ts"]);
	} finally {
		rmSync(gitRoot, { recursive: true, force: true });
	}
});

test("the pre-commit hook narrows typechecks without narrowing the repository gate", () => {
	const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
		scripts: Record<string, string>;
	};
	assert.match(manifest.scripts.precommit, /run-typechecks\.mjs --staged/u);
	assert.doesNotMatch(manifest.scripts.typecheck, /--staged/u);
});

function writeWorkspace(directoryName: string, manifest: Record<string, unknown>) {
	const workspaceRoot = path.join(fixtureRoot, "packages", directoryName);
	mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
	writeFileSync(path.join(workspaceRoot, "package.json"), `${JSON.stringify(manifest)}\n`);
	writeFileSync(path.join(workspaceRoot, "src", "index.ts"), "export {};\n");
}

function git(cwd: string, args: string[]) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}
