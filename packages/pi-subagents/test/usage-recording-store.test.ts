import assert from "node:assert/strict";
import {
	chmod,
	lstat,
	mkdtemp,
	readdir,
	readFile,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { encodeEvent, UsageEventStore } from "../src/usage-recording-store.js";

const FIRST_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_ID = "00000000-0000-4000-8000-000000000002";

test("usage event stores isolate writers and publish private newline frames", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-usage-store-"));
	const root = path.join(directory, "usage");
	const first = new UsageEventStore(root, { createId: () => FIRST_ID });
	const second = new UsageEventStore(root, { createId: () => SECOND_ID });
	try {
		await Promise.all([
			first.append({ schemaVersion: 1, eventType: "tool_start", data: { tool: "subagent" } }),
			second.append({ schemaVersion: 1, eventType: "tool_end", data: { isError: false } }),
		]);
		await Promise.all([first.close(), second.close()]);
		const entries = (await readdir(root)).sort();
		assert.deepEqual(entries, [`runtime-${FIRST_ID}.jsonl`, `runtime-${SECOND_ID}.jsonl`]);
		for (const entry of entries) {
			const filePath = path.join(root, entry);
			const contents = await readFile(filePath, "utf8");
			assert.ok(contents.endsWith("\n"));
			assert.doesNotThrow(() => JSON.parse(contents.trim()));
			if (process.platform !== "win32") {
				assert.equal((await lstat(filePath)).mode & 0o777, 0o600);
			}
		}
		if (process.platform !== "win32") assert.equal((await lstat(root)).mode & 0o777, 0o700);
	} finally {
		await first.close().catch(() => undefined);
		await second.close().catch(() => undefined);
		await import("node:fs/promises").then(({ rm }) =>
			rm(directory, { recursive: true, force: true }),
		);
	}
});

test("usage retention prunes only old validated writer files", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-usage-prune-"));
	const root = path.join(directory, "usage");
	const now = Date.UTC(2026, 7, 24);
	const store = new UsageEventStore(root, { createId: () => FIRST_ID, now: () => now });
	try {
		await store.append({ schemaVersion: 1, eventType: "study_exposure", data: {} });
		const oldWriter = path.join(root, `runtime-${SECOND_ID}.jsonl`);
		const unrelated = path.join(root, "keep.txt");
		await writeFile(oldWriter, "{}\n", { mode: 0o600 });
		await writeFile(unrelated, "keep", { mode: 0o600 });
		const old = new Date(now - 31 * 24 * 60 * 60 * 1000);
		await utimes(oldWriter, old, old);
		await utimes(unrelated, old, old);
		await store.prune(30);
		assert.deepEqual((await readdir(root)).sort(), ["keep.txt", `runtime-${FIRST_ID}.jsonl`]);
	} finally {
		await store.close().catch(() => undefined);
		await import("node:fs/promises").then(({ rm }) =>
			rm(directory, { recursive: true, force: true }),
		);
	}
});

test("usage storage rejects linked roots and oversized frames", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-usage-link-"));
	const outside = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-usage-outside-"));
	const linked = path.join(directory, "usage");
	try {
		await chmod(outside, 0o700);
		await symlink(outside, linked, "dir");
		const store = new UsageEventStore(linked, { createId: () => FIRST_ID });
		await assert.rejects(() => store.append({ eventType: "tool_start" }), /regular directory/i);
		await store.close();
		assert.throws(() => encodeEvent({ data: "x".repeat(9 * 1024) }), /storage bound/i);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(directory, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});
