import assert from "node:assert/strict";
import {
	chmod,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import {
	createUsageSettingsRuntime,
	DEFAULT_USAGE_SETTINGS,
	loadUsageSettings,
	normalizeUsageSettings,
} from "../src/settings.js";

const temporaryDirectories: string[] = [];

async function tempSettingsPath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-usage-settings-test-"));
	temporaryDirectories.push(directory);
	return join(directory, "pi-usage.json");
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("normalizes the default-enabled xAI setting and rejects invalid values", () => {
	assert.deepEqual(normalizeUsageSettings({}), DEFAULT_USAGE_SETTINGS);
	assert.deepEqual(normalizeUsageSettings({ codexFastMode: true }), {
		codexFastMode: true,
		xaiUsage: true,
	});
	assert.deepEqual(normalizeUsageSettings({ xaiUsage: false }), {
		codexFastMode: false,
		xaiUsage: false,
	});
	assert.equal(normalizeUsageSettings({ codexFastMode: "true" }), undefined);
	assert.equal(normalizeUsageSettings({ xaiUsage: "true" }), undefined);
	assert.equal(normalizeUsageSettings([]), undefined);
});

test("missing loads are side-effect free and valid loads preserve unknown fields", async () => {
	const path = await tempSettingsPath();
	const missing = await loadUsageSettings(path);
	assert.equal(missing.kind, "missing");
	assert.equal((await readdir(join(path, ".."))).length, 0);

	await writeFile(path, '{"codexFastMode":true,"future":"kept"}\n');
	const loaded = await loadUsageSettings(path);
	assert.equal(loaded.kind, "loaded");
	assert.equal(loaded.settings.codexFastMode, true);
	assert.equal(loaded.settings.xaiUsage, true);
	assert.equal(loaded.document?.future, "kept");
});

test("malformed, invalid, oversized, and symbolic-link settings stay read-only", async () => {
	const malformedPath = await tempSettingsPath();
	await writeFile(malformedPath, "{invalid");
	const malformed = await loadUsageSettings(malformedPath);
	assert.equal(malformed.kind, "invalid");
	const runtime = createUsageSettingsRuntime(malformedPath);
	await runtime.reload();
	await assert.rejects(runtime.update({ codexFastMode: true }), /Cannot overwrite an invalid/);
	assert.equal(await readFile(malformedPath, "utf8"), "{invalid");

	const invalidPath = await tempSettingsPath();
	await writeFile(invalidPath, '{"codexFastMode":"yes"}\n');
	assert.equal((await loadUsageSettings(invalidPath)).kind, "invalid");

	const invalidXaiPath = await tempSettingsPath();
	await writeFile(invalidXaiPath, '{"xaiUsage":1}\n');
	assert.equal((await loadUsageSettings(invalidXaiPath)).kind, "invalid");

	const oversizedPath = await tempSettingsPath();
	await writeFile(oversizedPath, JSON.stringify({ padding: "x".repeat(70 * 1024) }));
	assert.match((await loadUsageSettings(oversizedPath)).issue ?? "", /64 KiB/);

	const target = await tempSettingsPath();
	const link = await tempSettingsPath();
	await writeFile(target, "{}");
	await symlink(target, link);
	assert.match((await loadUsageSettings(link)).issue ?? "", /symbolic links/);
});

test("the first explicit save creates a private file and preserves unknown fields", async () => {
	const path = await tempSettingsPath();
	const runtime = createUsageSettingsRuntime(path);
	await runtime.update({ codexFastMode: true, xaiUsage: false });
	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
		codexFastMode: true,
		xaiUsage: false,
	});
	if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);

	await writeFile(path, '{"codexFastMode":true,"future":"kept"}\n');
	if (process.platform !== "win32") await chmod(path, 0o644);
	await runtime.update({ codexFastMode: false, xaiUsage: false });
	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
		codexFastMode: false,
		xaiUsage: false,
		future: "kept",
	});
	if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("serialized updates reread the latest document and leave no temporary files", async () => {
	const path = await tempSettingsPath();
	await writeFile(path, '{"codexFastMode":false,"external":"first"}\n');
	const runtime = createUsageSettingsRuntime(path);
	await runtime.reload();
	await writeFile(path, '{"codexFastMode":false,"external":"newer"}\n');
	await Promise.all([
		runtime.update({ codexFastMode: true, xaiUsage: true }),
		runtime.update({ codexFastMode: false, xaiUsage: false }),
	]);
	await runtime.flush();
	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
		codexFastMode: false,
		xaiUsage: false,
		external: "newer",
	});
	assert.deepEqual(
		(await readdir(join(path, ".."))).filter((name) => name.endsWith(".tmp")),
		[],
	);
});

test("reload waits for queued writes and observes the latest durable xAI value", async () => {
	const path = await tempSettingsPath();
	const runtime = createUsageSettingsRuntime(path);
	const update = runtime.update({ xaiUsage: false });
	const reload = runtime.reload();
	await update;
	const reloaded = await reload;
	assert.equal(reloaded.settings.xaiUsage, false);
	assert.equal(JSON.parse(await readFile(path, "utf8")).xaiUsage, false);
});

test("aborted saves retain prior runtime state", async () => {
	const abortedPath = await tempSettingsPath();
	const abortedRuntime = createUsageSettingsRuntime(abortedPath);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		abortedRuntime.update({ codexFastMode: true, xaiUsage: false }, controller.signal),
		/aborted/i,
	);
	assert.equal(abortedRuntime.get().settings.codexFastMode, false);
	assert.equal(abortedRuntime.get().settings.xaiUsage, true);
	assert.equal((await loadUsageSettings(abortedPath)).kind, "missing");
});

test("failed saves retain prior runtime state, clean up, and do not poison retries", async () => {
	const path = await tempSettingsPath();
	let rejectRename = true;
	const runtime = createUsageSettingsRuntime({
		path,
		operations: {
			rename: async (source, destination) => {
				if (rejectRename) throw new Error("rename rejected");
				await rename(source, destination);
			},
		},
	});
	await assert.rejects(runtime.update({ codexFastMode: true, xaiUsage: false }), /rename rejected/);
	assert.equal(runtime.get().settings.codexFastMode, false);
	assert.equal(runtime.get().settings.xaiUsage, true);
	assert.equal((await loadUsageSettings(path)).kind, "missing");
	assert.deepEqual(
		(await readdir(join(path, ".."))).filter((name) => name.endsWith(".tmp")),
		[],
	);

	rejectRename = false;
	await runtime.update({ codexFastMode: true });
	assert.equal(runtime.get().settings.codexFastMode, true);
});
