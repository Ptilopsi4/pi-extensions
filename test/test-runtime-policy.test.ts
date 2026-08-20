import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const maximumTestTimeoutMs = 5_000;

test("Vitest keeps every test within the repository timeout cap", () => {
	const config = readFileSync(path.join(root, "vitest.config.ts"), "utf8");
	assert.match(config, /testTimeout:\s*5_000/u);

	const violations: string[] = [];
	for (const file of testFiles()) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(/^\},\s*([0-9][0-9_]*)\s*\);/gmu)) {
			checkTimeout(file, source, match.index, match[1], violations);
		}
		for (const match of source.matchAll(
			/^\},\s*\{\s*timeout:\s*([0-9][0-9_]*)[\s\S]*?\}\s*\);/gmu,
		)) {
			checkTimeout(file, source, match.index, match[1], violations);
		}
	}
	assert.deepEqual(violations, []);
});

test("Vitest fixture commits use command-scoped unsigned Git configuration", () => {
	const fixture = mkdtempSync(path.join(os.tmpdir(), "pi-test-git-policy-"));
	try {
		git(fixture, ["init", "-q"]);
		git(fixture, ["config", "user.name", "Test"]);
		git(fixture, ["config", "user.email", "test@example.invalid"]);
		const origin = git(fixture, ["config", "--show-origin", "--get", "--bool", "commit.gpgsign"]);
		assert.match(origin, /^command line:\s+false$/u);

		writeFileSync(path.join(fixture, "fixture.txt"), "fixture\n");
		git(fixture, ["add", "fixture.txt"]);
		git(fixture, ["commit", "-qm", "unsigned fixture"]);
		assert.doesNotMatch(git(fixture, ["cat-file", "commit", "HEAD"]), /^gpgsig /mu);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

function testFiles(): string[] {
	return [
		...filesUnder(path.join(root, "test")),
		...readdirSync(path.join(root, "packages"), { withFileTypes: true }).flatMap((entry) =>
			entry.isDirectory() ? filesUnder(path.join(root, "packages", entry.name, "test")) : [],
		),
	].filter((file) => file.endsWith(".test.ts"));
}

function filesUnder(directory: string): string[] {
	try {
		return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			const entryPath = path.join(directory, entry.name);
			return entry.isDirectory() ? filesUnder(entryPath) : entry.isFile() ? [entryPath] : [];
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function checkTimeout(
	file: string,
	source: string,
	index: number,
	literal: string | undefined,
	violations: string[],
): void {
	const timeout = Number((literal ?? "").replaceAll("_", ""));
	if (Number.isFinite(timeout) && timeout <= maximumTestTimeoutMs) return;
	const line = source.slice(0, index).split("\n").length;
	violations.push(`${path.relative(root, file)}:${line} overrides the timeout with ${literal}`);
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
