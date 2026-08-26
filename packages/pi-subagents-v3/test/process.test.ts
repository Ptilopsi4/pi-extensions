import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import {
	buildPiArgs,
	childCommunicationBridgePath,
	resolveTimeoutMs,
	runChild,
} from "../src/process.js";
import type { ChildRequest } from "../src/types.js";

let directory: string;
let previousPackageDirectory: string | undefined;

beforeEach(() => {
	directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-v3-process-"));
	previousPackageDirectory = process.env.PI_PACKAGE_DIR;
});

afterEach(() => {
	if (previousPackageDirectory === undefined) delete process.env.PI_PACKAGE_DIR;
	else process.env.PI_PACKAGE_DIR = previousPackageDirectory;
	rmSync(directory, { recursive: true, force: true });
});

test("buildPiArgs isolates the child and preserves selected communication tools", () => {
	const args = buildPiArgs(childRequest());
	assert.deepEqual(args.slice(0, 8), [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"-e",
	]);
	assert.equal(args[8], childCommunicationBridgePath());
	assert.equal(args[args.indexOf("--model") + 1], "test-provider/test-model");
	assert.equal(args[args.indexOf("--thinking") + 1], "medium");
	assert.ok(args.includes("--no-approve"));
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls,subagent-ask,subagent-wait");
	assert.doesNotMatch(args.join(" "), /\bbash\b|\bwrite\b|append-system-prompt/u);
	assert.equal(args.at(-1), "Task: task");

	const writable = buildPiArgs(
		childRequest({
			tools: ["read", "bash", "write", "subagent-ask", "subagent-wait"],
			thinkingLevel: "xhigh",
			projectTrusted: true,
		}),
	);
	assert.ok(writable.includes("--approve"));
	assert.equal(writable[writable.indexOf("--thinking") + 1], "xhigh");
	assert.equal(
		writable[writable.indexOf("--tools") + 1],
		"read,bash,write,subagent-ask,subagent-wait",
	);

	const noWorkTools = buildPiArgs(childRequest({ tools: [] }));
	assert.equal(noWorkTools[noWorkTools.indexOf("--tools") + 1], "subagent-ask,subagent-wait");
});

test("runChild classifies completed and partial subprocess output", async () => {
	installFakePi(`
const task = process.argv.at(-1) || "";
const message = (text, stopReason = "stop") => JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason }
});
if (task.includes("partial")) {
  console.log(message("partial evidence", "error"));
  console.error("child failed");
  process.exit(2);
}
console.log(message("completed evidence"));
`);
	const completed = await runChild(childRequest({ task: "complete" }));
	assert.equal(completed.state, "completed");
	assert.equal(completed.result, "completed evidence");

	const partial = await runChild(childRequest({ task: "partial" }));
	assert.equal(partial.state, "partial");
	assert.equal(partial.result, "partial evidence");
	assert.match(partial.error ?? "", /child failed/);
});

test("runChild requires a normal terminal result and preserves incomplete evidence", async () => {
	installFakePi(`
const task = process.argv.at(-1) || "";
const message = (text, stopReason) => JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason }
});
if (task.includes("length")) console.log(message("cut-off evidence", "length"));
else if (task.includes("nonterminal")) console.log(message("intermediate evidence", "toolUse"));
else console.log("{malformed");
`);
	const lengthLimited = await runChild(childRequest({ task: "length" }));
	assert.equal(lengthLimited.state, "partial");
	assert.equal(lengthLimited.result, "cut-off evidence");
	assert.match(lengthLimited.error ?? "", /model limit/i);
	assert.match(lengthLimited.limitations.join("\n"), /model output limit/i);

	const nonterminal = await runChild(childRequest({ task: "nonterminal" }));
	assert.equal(nonterminal.state, "partial");
	assert.equal(nonterminal.result, "intermediate evidence");
	assert.match(nonterminal.error ?? "", /without a terminal assistant result/i);

	const missing = await runChild(childRequest({ task: "missing" }));
	assert.equal(missing.state, "failed");
	assert.match(missing.error ?? "", /without a terminal assistant result/i);
	assert.match(missing.limitations.join("\n"), /malformed/i);
});

test("runChild bounds child result text below the complete tool-output budget", async () => {
	installFakePi(`
const text = "x".repeat(40 * 1024);
console.log(JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }
}));
`);
	const result = await runChild(childRequest());
	assert.equal(result.state, "completed");
	assert.equal(result.truncated, true);
	assert.ok(Buffer.byteLength(result.result ?? "", "utf8") <= 32 * 1024);
	assert.match(result.limitations.join("\n"), /truncated/i);
});

test("resolves optional execution timeouts with Pi bash semantics", () => {
	assert.equal(resolveTimeoutMs(undefined), undefined);
	assert.equal(resolveTimeoutMs(0.025), 25);
	assert.equal(resolveTimeoutMs(2_147_483.647), 2_147_483_647);
	assert.throws(() => resolveTimeoutMs(0), /finite number of seconds/);
	assert.throws(() => resolveTimeoutMs(Number.POSITIVE_INFINITY), /finite number of seconds/);
	assert.throws(() => resolveTimeoutMs(2_147_483.648), /maximum is 2147483\.647 seconds/);
});

test("runChild enforces an optional execution timeout and caller cancellation", async () => {
	installFakePi("setInterval(() => {}, 1000);\n");
	const timedOut = await runChild(childRequest({ timeout: 0.025 }));
	assert.equal(timedOut.state, "timed_out");

	const controller = new AbortController();
	const work = runChild(childRequest({ signal: controller.signal }));
	setTimeout(() => controller.abort(), 25);
	const cancelled = await work;
	assert.equal(cancelled.state, "cancelled");
});

function childRequest(overrides: Partial<ChildRequest> = {}): ChildRequest {
	return {
		task: "task",
		tools: ["read", "grep", "find", "ls"],
		model: "test-provider/test-model",
		thinkingLevel: "medium",
		cwd: directory,
		projectTrusted: false,
		communication: {
			host: "127.0.0.1",
			port: 31_337,
			token: "a".repeat(64),
		},
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
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			bin: { pi: "./fake-pi.mjs" },
		}),
	);
	process.env.PI_PACKAGE_DIR = packageDirectory;
}
