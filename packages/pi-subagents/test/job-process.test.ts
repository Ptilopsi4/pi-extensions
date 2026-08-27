import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { buildPiArgs, resolveTimeoutMs, runChild } from "../src/job-process.js";
import type { ChildRequest } from "../src/job-types.js";

let directory: string;
let previousPackageDirectory: string | undefined;
let previousDepth: string | undefined;
let previousPeer: Record<string, string | undefined>;

beforeEach(() => {
	directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-job-process-"));
	previousPackageDirectory = process.env.PI_PACKAGE_DIR;
	previousDepth = process.env.PI_SUBAGENT_DEPTH;
	previousPeer = {
		PI_SUBAGENT_PEER_HOST: process.env.PI_SUBAGENT_PEER_HOST,
		PI_SUBAGENT_PEER_PORT: process.env.PI_SUBAGENT_PEER_PORT,
		PI_SUBAGENT_PEER_TOKEN: process.env.PI_SUBAGENT_PEER_TOKEN,
	};
});

afterEach(() => {
	restore("PI_PACKAGE_DIR", previousPackageDirectory);
	restore("PI_SUBAGENT_DEPTH", previousDepth);
	for (const [name, value] of Object.entries(previousPeer)) restore(name, value);
	rmSync(directory, { recursive: true, force: true });
});

test("child arguments isolate prompt resources and preserve exact tool semantics", () => {
	const defaults = buildPiArgs(request());
	assert.deepEqual(defaults.slice(0, 7), [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
	]);
	assert.equal(defaults[defaults.indexOf("--tools") + 1], "read,grep,find,ls");
	assert.equal(defaults.at(-1), "Task: task");
	assert.ok(defaults.includes("--no-approve"));
	assert.equal(defaults.includes("-e"), false);
	assert.doesNotMatch(defaults.join(" "), /bridge|broker|subagent_ask|subagent_reply/u);

	const writable = buildPiArgs(
		request({ tools: ["read", "bash", "powershell", "edit", "write"], projectTrusted: true }),
	);
	assert.equal(writable[writable.indexOf("--tools") + 1], "read,bash,powershell,edit,write");
	assert.ok(writable.includes("--approve"));
	const none = buildPiArgs(request({ tools: [] }));
	assert.ok(none.includes("--no-builtin-tools"));
	assert.equal(none.includes("--tools"), false);
});

test("timeout conversion uses finite positive seconds through the timer maximum", () => {
	assert.equal(resolveTimeoutMs(undefined), undefined);
	assert.equal(resolveTimeoutMs(0.025), 25);
	assert.equal(resolveTimeoutMs(2_147_483.647), 2_147_483_647);
	for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483.648]) {
		assert.throws(() => resolveTimeoutMs(invalid), /Invalid timeout/u);
	}
});

test("child environment increments depth and removes legacy broker credentials", async () => {
	process.env.PI_SUBAGENT_DEPTH = "2";
	process.env.PI_SUBAGENT_PEER_HOST = "127.0.0.1";
	process.env.PI_SUBAGENT_PEER_PORT = "31337";
	process.env.PI_SUBAGENT_PEER_TOKEN = "secret";
	installFakePi(`
const text = JSON.stringify({
  depth: process.env.PI_SUBAGENT_DEPTH,
  host: process.env.PI_SUBAGENT_PEER_HOST,
  port: process.env.PI_SUBAGENT_PEER_PORT,
  token: process.env.PI_SUBAGENT_PEER_TOKEN,
});
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } }));
`);
	const child = await runChild(request());
	assert.deepEqual(JSON.parse(child.result ?? ""), { depth: "3" });
});

test("process runner classifies completed, partial, and missing terminal output", async () => {
	installFakePi(`
const task = process.argv.at(-1) || "";
const event = (text, stopReason) => JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason } });
if (task.includes("controls")) console.log(event("done\\u001b[31m\\u202e", "stop"));
else if (task.includes("complete")) console.log(event("done", "stop"));
else if (task.includes("length")) console.log(event("partial evidence", "length"));
else if (task.includes("malformed")) { console.log("{bad"); process.exit(0); }
else { console.log(event("failed evidence", "error")); console.error("child failed"); process.exit(2); }
`);
	const completed = await runChild(request({ task: "complete" }));
	assert.equal(completed.state, "completed");
	assert.equal(completed.result, "done");
	const controls = await runChild(request({ task: "controls" }));
	assert.equal(controls.result, "done\u001b[31m\u202e");
	const limited = await runChild(request({ task: "length" }));
	assert.equal(limited.state, "partial");
	assert.match(limited.limitations.join("\n"), /model output limit/u);
	const failed = await runChild(request({ task: "failed" }));
	assert.equal(failed.state, "partial");
	assert.match(failed.error ?? "", /child failed/u);
	const malformed = await runChild(request({ task: "malformed" }));
	assert.equal(malformed.state, "failed");
	assert.match(malformed.limitations.join("\n"), /malformed/u);
	const launchError = await runChild(request({ cwd: path.join(directory, "missing-cwd") }));
	assert.equal(launchError.state, "failed");
	assert.match(launchError.error ?? "", /ENOENT|no such file|spawn/iu);
});

test("process runner bounds multibyte output, line count, and stderr tail", async () => {
	installFakePi(`
const task = process.argv.at(-1) || "";
if (task.includes("stderr")) { console.error("e".repeat(20 * 1024)); process.exit(2); }
const text = task.includes("lines") ? Array.from({length: 2100}, (_, i) => "line" + i).join("\\n") : "界".repeat(20 * 1024);
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } }));
`);
	const multibyte = await runChild(request({ task: "multibyte" }));
	assert.equal(multibyte.state, "completed");
	assert.equal(multibyte.truncated, true);
	assert.ok(Buffer.byteLength(multibyte.result ?? "", "utf8") <= 32 * 1024);
	assert.equal((multibyte.result ?? "").includes("�"), false);
	const lines = await runChild(request({ task: "lines" }));
	assert.equal(lines.truncated, true);
	assert.ok((lines.result ?? "").split("\n").length <= 2_000);
	const stderr = await runChild(request({ task: "stderr" }));
	assert.equal(stderr.state, "failed");
	assert.ok(Buffer.byteLength(stderr.error ?? "", "utf8") <= 8 * 1024);
});

test("process runner handles timeout, caller cancellation, and pre-abort", async () => {
	installFakePi("setInterval(() => {}, 1000);\n");
	assert.equal((await runChild(request({ timeout: 0.025 }))).state, "timed_out");
	const controller = new AbortController();
	const work = runChild(request({ signal: controller.signal }));
	setTimeout(() => controller.abort(), 25);
	assert.equal((await work).state, "cancelled");
	const pre = new AbortController();
	pre.abort();
	assert.equal((await runChild(request({ signal: pre.signal }))).state, "cancelled");
});

function request(overrides: Partial<ChildRequest> = {}): ChildRequest {
	return {
		task: "task",
		tools: ["read", "grep", "find", "ls"],
		model: "test/test-model",
		thinkingLevel: "medium",
		cwd: directory,
		projectTrusted: false,
		signal: new AbortController().signal,
		...overrides,
	};
}

function installFakePi(source: string): void {
	const packageDirectory = path.join(directory, "pi-core");
	mkdirSync(packageDirectory, { recursive: true });
	writeFileSync(path.join(packageDirectory, "fake-pi.mjs"), source);
	writeFileSync(
		path.join(packageDirectory, "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-coding-agent", bin: { pi: "./fake-pi.mjs" } }),
	);
	process.env.PI_PACKAGE_DIR = packageDirectory;
}

function restore(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}
