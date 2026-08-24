import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "vitest";
import {
	ASYNC_SUBAGENT_BENCHMARK_VERSION,
	type AsyncSubagentBenchmarkTrialRecord,
	analyzeBenchmarkEvents,
	BenchmarkDeadlineError,
	createAlternatingTrialPlan,
	parseAsyncSubagentBenchmarkArgs,
	parseBenchmarkJsonLines,
	percentile,
	redactBenchmarkValue,
	runAfterReadinessWithDeadline,
	scoreBenchmarkEvidence,
	summarizeAsyncSubagentBenchmark,
} from "../src/async-subagent-benchmark.js";

const execFileAsync = promisify(execFile);

function assistant(content: unknown[]): Record<string, unknown> {
	return { type: "message_end", message: { role: "assistant", content } };
}

function toolResult(toolName: string, details?: Record<string, unknown>): Record<string, unknown> {
	return {
		type: "message_end",
		message: { role: "toolResult", toolName, isError: false, content: [], details },
	};
}

function trial(
	arm: "sync" | "async",
	overrides: Partial<AsyncSubagentBenchmarkTrialRecord> = {},
): AsyncSubagentBenchmarkTrialRecord {
	return {
		version: ASYNC_SUBAGENT_BENCHMARK_VERSION,
		pairIndex: 0,
		orderIndex: arm === "sync" ? 0 : 1,
		arm,
		outcome: "completed",
		readinessMs: 5,
		elapsedMs: arm === "sync" ? 10 : 20,
		cost: arm === "sync" ? 1 : 2,
		startedAt: "2026-01-01T00:00:00.000Z",
		completedAt: "2026-01-01T00:00:01.000Z",
		completionObserved: true,
		evidenceScore: 1,
		matchedEvidence: [
			"registry-wait-race",
			"completion-id-deduplication",
			"session-shutdown-cleanup",
		],
		prematureFinalCount: 0,
		events: [],
		...overrides,
	};
}

test("benchmark argument and JSONL parsers reject ambiguous input", () => {
	assert.deepEqual(
		parseAsyncSubagentBenchmarkArgs([
			"--mode",
			"extended",
			"--model",
			"provider/model",
			"--thinking",
			"high",
			"--timeout-ms",
			"123",
			"--readiness-timeout-ms",
			"45",
			"--output",
			"result.json",
			"--run",
		]),
		{
			mode: "extended",
			model: "provider/model",
			thinkingLevel: "high",
			timeoutMs: 123,
			readinessTimeoutMs: 45,
			outputPath: "result.json",
			run: true,
			piCommand: "pi",
		},
	);
	assert.deepEqual(parseBenchmarkJsonLines('{"type":"one"}\r\n{"type":"two"}\n'), [
		{ type: "one" },
		{ type: "two" },
	]);
	assert.throws(() => parseAsyncSubagentBenchmarkArgs(["--mode", "quick"]), /--model is required/i);
	assert.throws(() => parseBenchmarkJsonLines('{"ok":true}\nnot-json\n'), /line 2/i);
});

test("event analysis scores evidence, completion visibility, and premature finals", () => {
	const finalText = [
		"packages/pi-subagents/src/registry.ts uses Promise.race.",
		"packages/pi-subagents/src/completion-delivery.ts tracks completionId.",
		"packages/pi-subagents/src/stateful-registration.ts handles session_shutdown.",
		'BENCHMARK_RESULT_JSON: {"complete":true}',
	].join("\n");
	const events = [
		assistant([{ type: "toolCall", id: "spawn", name: "subagent_spawn", arguments: {} }]),
		toolResult("subagent_spawn"),
		assistant([
			{
				type: "text",
				text: "packages/pi-subagents/src/registry.ts already proves Promise.race before the child result.",
			},
		]),
		toolResult("subagent_await"),
		assistant([{ type: "text", text: finalText }]),
	];
	assert.deepEqual(analyzeBenchmarkEvents("async", events), {
		completionObserved: true,
		evidenceScore: 1,
		matchedEvidence: [
			"registry-wait-race",
			"completion-id-deduplication",
			"session-shutdown-cleanup",
		],
		prematureFinalCount: 1,
		finalAnswer: finalText,
		resultMarker: { complete: true },
	});
	assert.deepEqual(scoreBenchmarkEvidence("packages/pi-subagents/src/registry.ts Promise.race"), {
		score: 0.333,
		matched: ["registry-wait-race"],
	});
	assert.equal(
		analyzeBenchmarkEvents("async", [toolResult("subagent_await", { timedOut: true })])
			.completionObserved,
		false,
	);
	assert.equal(
		analyzeBenchmarkEvents("async", [
			assistant([{ type: "toolCall", id: "spawn", name: "subagent_spawn", arguments: {} }]),
			assistant([{ type: "text", text: "The required inspection is still in progress." }]),
		]).prematureFinalCount,
		0,
	);
});

test("paired order alternates without changing quick and extended sample counts", () => {
	const quick = createAlternatingTrialPlan("quick");
	assert.equal(quick.length, 6);
	assert.deepEqual(
		quick.map(({ pairIndex, arm }) => [pairIndex, arm]),
		[
			[0, "sync"],
			[0, "async"],
			[1, "async"],
			[1, "sync"],
			[2, "sync"],
			[2, "async"],
		],
	);
	assert.equal(createAlternatingTrialPlan("extended").length, 20);
});

test("hard work deadline starts only after readiness and reports timeout", async () => {
	const readyThenFast = await runAfterReadinessWithDeadline(
		delay(20),
		async () => {
			await delay(2);
			return "ok";
		},
		10,
	);
	assert.equal(readyThenFast, "ok");
	await assert.rejects(
		() => runAfterReadinessWithDeadline(Promise.resolve(), () => delay(30), 5),
		BenchmarkDeadlineError,
	);
});

test("statistics summarize coverage, outcomes, latency, P95, and available cost", () => {
	assert.equal(percentile([40, 10, 30, 20], 0.5), 25);
	assert.equal(percentile([40, 10, 30, 20], 0.95), 38.5);
	const summary = summarizeAsyncSubagentBenchmark([
		trial("sync", { pairIndex: 0, elapsedMs: 10, cost: 1 }),
		trial("async", { pairIndex: 0, elapsedMs: 20, cost: 2, prematureFinalCount: 1 }),
		trial("sync", {
			pairIndex: 1,
			orderIndex: 1,
			outcome: "timed-out",
			completionObserved: false,
			evidenceScore: 0,
			elapsedMs: 40,
			cost: null,
		}),
		trial("async", { pairIndex: 1, orderIndex: 0, elapsedMs: 30, cost: 4 }),
	]);
	assert.equal(summary.pairs, 2);
	assert.deepEqual(summary.arms.sync, {
		trials: 2,
		completionCoverage: 0.5,
		evidenceScore: 0.5,
		prematureFinalCount: 0,
		terminalOutcomes: {
			completed: 1,
			"invalid-output": 0,
			"timed-out": 1,
			"readiness-timeout": 0,
			"process-error": 0,
			"protocol-error": 0,
		},
		latencyMs: { median: 10, p95: 10 },
		cost: { available: 1, total: 1, median: 1, p95: 1 },
	});
	assert.deepEqual(summary.arms.async.latencyMs, { median: 25, p95: 29.5 });
	assert.deepEqual(summary.arms.async.cost, {
		available: 2,
		total: 6,
		median: 3,
		p95: 3.9,
	});
	assert.equal(summary.arms.async.prematureFinalCount, 1);
});

test("manual runner handles RPC lifecycle and cleans isolated agent directories", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-async-benchmark-script-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	const output = path.join(root, "result.json");
	const sourceAgentDir = path.join(root, "source-agent");
	await writeFile(
		fakePi,
		[
			"#!/usr/bin/env node",
			'import fs from "node:fs";',
			'import readline from "node:readline";',
			'const settings=JSON.parse(fs.readFileSync(process.env.PI_CODING_AGENT_DIR+"/pi-subagents.json","utf8"));',
			"const asyncArm=settings.blocking?.enabled===false;",
			'const finalText=["packages/pi-subagents/src/registry.ts uses Promise.race.","packages/pi-subagents/src/completion-delivery.ts tracks completionId.","packages/pi-subagents/src/stateful-registration.ts handles session_shutdown.",\'BENCHMARK_RESULT_JSON: {"complete":true}\'].join("\\n");',
			'const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");',
			"const lines=readline.createInterface({input:process.stdin});",
			'lines.on("line",(line)=>{const request=JSON.parse(line);if(request.type==="get_state"){send({id:request.id,type:"response",success:true,data:{}});return;}if(request.type==="prompt"){if(asyncArm){send({type:"message_end",message:{role:"custom",customType:"pi-subagent-completion",content:"done",details:{completionId:"completion:fake"}}});}else{send({type:"message_end",message:{role:"toolResult",toolName:"subagent",isError:false,content:[],details:{}}});}send({type:"message_end",message:{role:"assistant",content:[{type:"text",text:finalText}]}});send({id:request.id,type:"response",success:true,data:{}});return;}if(request.type==="get_session_stats"){send({id:request.id,type:"response",success:true,data:{cost:0.01}});}});',
		].join("\n"),
		{ mode: 0o700 },
	);
	await mkdir(sourceAgentDir);
	try {
		await execFileAsync(
			process.execPath,
			[
				"scripts/benchmark-async-subagents.ts",
				"--run",
				"--mode",
				"quick",
				"--model",
				"fake/model",
				"--pi",
				fakePi,
				"--timeout-ms",
				"1000",
				"--readiness-timeout-ms",
				"1000",
				"--output",
				output,
			],
			{
				cwd: path.resolve(import.meta.dirname, "../../.."),
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: sourceAgentDir,
					TMPDIR: root,
				},
				timeout: 4_000,
			},
		);
		const result = JSON.parse(await readFile(output, "utf8")) as {
			rawRecords: unknown[];
			summary: { pairs: number; arms: { sync: { trials: number }; async: { trials: number } } };
		};
		assert.equal(result.rawRecords.length, 6);
		assert.equal(result.summary.pairs, 3);
		assert.equal(result.summary.arms.sync.trials, 3);
		assert.equal(result.summary.arms.async.trials, 3);
		assert.equal(
			(await readdir(root)).some((name) => name.startsWith("pi-subagent-benchmark-")),
			false,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("manual runner cleans credential directories when its pane receives SIGHUP", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-async-benchmark-sighup-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	const output = path.join(root, "result.json");
	const sourceAgentDir = path.join(root, "source-agent");
	await mkdir(sourceAgentDir);
	await writeFile(
		fakePi,
		[
			"#!/usr/bin/env node",
			'import readline from "node:readline";',
			'const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");',
			"const lines=readline.createInterface({input:process.stdin});",
			'lines.on("line",(line)=>{const request=JSON.parse(line);if(request.type==="get_state")send({id:request.id,type:"response",success:true,data:{}});});',
		].join("\n"),
		{ mode: 0o700 },
	);
	const runner = spawn(
		process.execPath,
		[
			"scripts/benchmark-async-subagents.ts",
			"--run",
			"--mode",
			"quick",
			"--model",
			"fake/model",
			"--pi",
			fakePi,
			"--timeout-ms",
			"1000",
			"--readiness-timeout-ms",
			"1000",
			"--output",
			output,
		],
		{
			cwd: path.resolve(import.meta.dirname, "../../.."),
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: sourceAgentDir,
				TMPDIR: root,
			},
			stdio: "ignore",
		},
	);
	try {
		const deadline = Date.now() + 1_000;
		while (
			!(await readdir(root)).some((name) => name.startsWith("pi-subagent-benchmark-")) &&
			Date.now() < deadline
		) {
			await delay(10);
		}
		assert.equal(
			(await readdir(root)).some((name) => name.startsWith("pi-subagent-benchmark-")),
			true,
		);
		runner.kill("SIGHUP");
		const [code] = (await once(runner, "exit")) as [number | null, NodeJS.Signals | null];
		assert.equal(code, 129);
		assert.equal(
			(await readdir(root)).some((name) => name.startsWith("pi-subagent-benchmark-")),
			false,
		);
	} finally {
		if (runner.exitCode === null) runner.kill("SIGKILL");
		await rm(root, { recursive: true, force: true });
	}
});

test("raw record redaction removes credentials, private blocks, and home paths", () => {
	const redacted = redactBenchmarkValue({
		authorization: "Bearer secret",
		text: `path=${process.env.HOME}/repo <private>hidden</private> API_TOKEN=abc`,
	}) as Record<string, unknown>;
	assert.equal(redacted.authorization, "[redacted]");
	assert.equal(redacted.text, "path=$HOME/repo [private content omitted] API_TOKEN=[redacted]");
});
