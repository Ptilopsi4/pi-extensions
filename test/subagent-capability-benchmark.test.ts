import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
	analyzeCapabilityEvents,
	CAPABILITY_RESULT_PREFIX,
	CAPABILITY_TASKS,
	type CapabilityTrialRecord,
	createCapabilityFixture,
	createCapabilityTrialPlan,
	parseCapabilityBenchmarkArgs,
	projectCapabilityEvents,
	SUBAGENT_CAPABILITY_BENCHMARK_VERSION,
	scoreCapabilityEvidence,
	summarizeCapabilityBenchmark,
	trialSucceeded,
} from "./support/subagent-capability-benchmark.js";

const execFileAsync = promisify(execFile);

function assistant(text: string): Record<string, unknown> {
	return {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text }] },
	};
}

function toolResult(
	toolName: string,
	details: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		type: "message_end",
		message: { role: "toolResult", toolName, isError: false, details, content: [] },
	};
}

test("argument parsing fixes model and bounded paired repetitions", () => {
	assert.deepEqual(
		parseCapabilityBenchmarkArgs([
			"--model",
			"provider/model",
			"--thinking",
			"high",
			"--repetitions",
			"3",
			"--timeout-ms",
			"500",
			"--output",
			"result.json",
			"--run",
		]),
		{
			model: "provider/model",
			thinkingLevel: "high",
			repetitions: 3,
			timeoutMs: 500,
			readinessTimeoutMs: 15_000,
			piCommand: "pi",
			outputPath: "result.json",
			run: true,
		},
	);
	assert.throws(() => parseCapabilityBenchmarkArgs([]), /--model is required/i);
	assert.throws(
		() => parseCapabilityBenchmarkArgs(["--model", "p/m", "--repetitions", "11"]),
		/1 through 10/i,
	);
});

test("trial plan pairs every task and alternates arm order", () => {
	const plan = createCapabilityTrialPlan(1);
	assert.equal(plan.length, CAPABILITY_TASKS.length * 2);
	assert.deepEqual(
		plan.map(({ taskId, arm }) => [taskId, arm]),
		[
			["single-research", "pi-subagents"],
			["single-research", "pi-subagents-v2"],
			["parallel-research", "pi-subagents-v2"],
			["parallel-research", "pi-subagents"],
			["consult-review", "pi-subagents"],
			["consult-review", "pi-subagents-v2"],
			["worker-fix", "pi-subagents-v2"],
			["worker-fix", "pi-subagents"],
		],
	);
	for (let pairIndex = 0; pairIndex < CAPABILITY_TASKS.length; pairIndex++) {
		assert.equal(plan.filter((trial) => trial.pairIndex === pairIndex).length, 2);
	}
});

test("event analysis requires the correct tools, completion order, marker, and full rubric", () => {
	const task = CAPABILITY_TASKS[0];
	const final = [
		"src/queue.ts defines RETRY_ATTEMPTS as 4.",
		"src/delivery.ts defines COMPLETION_CHANNEL as steer.",
		"src/shutdown.ts defines stop-delivery, abort-children, await-streams.",
		`${CAPABILITY_RESULT_PREFIX} {"taskId":"single-research","complete":true}`,
	].join("\n");
	const valid = analyzeCapabilityEvents("pi-subagents-v2", task, [
		toolResult("subagent-v2-start"),
		toolResult("subagent-v2-wait", { timedOut: false, state: "completed" }),
		assistant(final),
	]);
	assert.equal(valid.evidenceScore, 1);
	assert.equal(valid.toolCompliance, true);
	assert.equal(valid.completionObserved, true);
	assert.equal(valid.prematureFinal, false);
	assert.equal(trialSucceeded(valid, "completed", null), true);

	const premature = analyzeCapabilityEvents("pi-subagents-v2", task, [
		toolResult("subagent-v2-start"),
		assistant(final),
		toolResult("subagent-v2-wait", { state: "completed" }),
	]);
	assert.equal(premature.prematureFinal, true);
	assert.equal(premature.completionObserved, false);
	assert.equal(trialSucceeded(premature, "completed", null), false);

	const timedOut = analyzeCapabilityEvents("pi-subagents-v2", task, [
		toolResult("subagent-v2-start"),
		toolResult("subagent-v2-wait", { timedOut: true, state: "running" }),
		assistant(final),
	]);
	assert.equal(timedOut.toolCompliance, false);
	assert.equal(timedOut.completionObserved, false);
});

test("fixed rubrics normalize numeric separators and keep writer verification independent", () => {
	const parallelTask = CAPABILITY_TASKS[1];
	assert.deepEqual(
		scoreCapabilityEvidence("src/protocol.ts MAX_FRAME_BYTES 49_152", parallelTask.evidence),
		{
			score: 0.25,
			matched: ["frame-limit"],
		},
	);
	const task = CAPABILITY_TASKS[3];
	assert.deepEqual(scoreCapabilityEvidence("src/math.mjs clamp pass", task.evidence), {
		score: 0.333,
		matched: ["clamp-fixed"],
	});
	const analysis = {
		matchedEvidence: task.evidence.map((item) => item.id),
		evidenceScore: 1,
		toolCompliance: true,
		completionObserved: true,
		prematureFinal: false,
		toolCounts: { start: 1, wait: 1, consult: 0 },
	};
	assert.equal(trialSucceeded(analysis, "completed", true), true);
	assert.equal(trialSucceeded(analysis, "completed", false), false);
});

test("generated mutation fixture starts failing deterministic tests", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "subagent-capability-fixture-"));
	try {
		createCapabilityFixture(directory, "fixture-test");
		await assert.rejects(
			() =>
				execFileAsync(process.execPath, ["--test", "test/math.test.mjs"], {
					cwd: directory,
				}),
			/Command failed/,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("persisted event projection keeps evaluation evidence and removes streaming noise", () => {
	assert.deepEqual(
		projectCapabilityEvents([
			{ type: "message_update", delta: "private streaming detail" },
			{ type: "message_end", message: { role: "user", content: "prompt duplicate" } },
			toolResult("subagent-v2-wait", { state: "completed" }),
			{
				type: "message_end",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "private reasoning", thinkingSignature: "opaque" },
						{ type: "text", text: "final evidence" },
					],
				},
			},
			{ type: "turn_end", usage: { input: 100 } },
			{
				type: "response",
				id: "stats",
				command: "get_session_stats",
				success: true,
				data: { cost: 1 },
			},
		]),
		[
			toolResult("subagent-v2-wait", { state: "completed" }),
			assistant("final evidence"),
			{ type: "turn_end" },
			{
				type: "response",
				id: "stats",
				command: "get_session_stats",
				success: true,
				data: { cost: 1 },
			},
		],
	);
});

test("summary keeps quality, protocol, latency, and non-comparable cost separate", () => {
	const base: CapabilityTrialRecord = {
		version: SUBAGENT_CAPABILITY_BENCHMARK_VERSION,
		pairIndex: 0,
		repetition: 0,
		orderIndex: 0,
		arm: "pi-subagents",
		taskId: "single-research",
		outcome: "completed",
		success: true,
		fixturePassed: null,
		readinessMs: 10,
		elapsedMs: 100,
		parentVisibleCost: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
		completedAt: "2026-01-01T00:00:01.000Z",
		matchedEvidence: ["a"],
		evidenceScore: 1,
		toolCompliance: true,
		completionObserved: true,
		prematureFinal: false,
		toolCounts: { start: 1, wait: 1, consult: 0 },
		events: [],
	};
	const summary = summarizeCapabilityBenchmark([
		base,
		{
			...base,
			orderIndex: 1,
			arm: "pi-subagents-v2",
			success: false,
			evidenceScore: 0.5,
			toolCompliance: false,
			completionObserved: false,
			parentVisibleCost: 0.5,
		},
	]);
	assert.equal(summary.costComparable, false);
	assert.equal(summary.arms["pi-subagents"].successRate, 1);
	assert.equal(summary.arms["pi-subagents-v2"].successRate, 0);
	assert.equal(summary.arms["pi-subagents-v2"].meanEvidenceScore, 0.5);
});

test("manual runner executes paired RPC trials and cleans private temporary directories", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "subagent-capability-runner-"));
	const fakePi = path.join(directory, "fake-pi.mjs");
	const output = path.join(directory, "result.json");
	writeFileSync(
		fakePi,
		[
			"#!/usr/bin/env node",
			'import fs from "node:fs";',
			'import readline from "node:readline";',
			'const extension=process.argv[process.argv.indexOf("-e")+1]||"";',
			'const v2=extension.includes("v2");',
			'const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");',
			"const lines=readline.createInterface({input:process.stdin});",
			'const final=(taskId)=>["src/queue.ts RETRY_ATTEMPTS 4","src/delivery.ts COMPLETION_CHANNEL steer","src/shutdown.ts stop-delivery abort-children await-streams","src/protocol.ts PROTOCOL_VERSION job-v3 MAX_FRAME_BYTES 49152","src/retention.ts MAX_TERMINAL_JOBS 32 RETENTION_HOURS 24","src/review.ts startsWith owner path.join traversal slice(0, 8) token","src/math.mjs clamp pass isEven pass","node --test test/math.test.mjs pass","CAPABILITY_BENCHMARK_RESULT: "+JSON.stringify({taskId,complete:true})].join("\\n");',
			'lines.on("line",(line)=>{const request=JSON.parse(line);if(request.type==="get_state"){send({id:request.id,type:"response",success:true,data:{}});return;}if(request.type==="get_session_stats"){send({id:request.id,type:"response",success:true,data:{cost:0.01}});return;}if(request.type!=="prompt")return;send({id:request.id,type:"response",success:true,data:{}});const taskId=/Task ID: ([a-z-]+)/.exec(request.message)?.[1]||"unknown";const tool=(name)=>send({type:"message_end",message:{role:"toolResult",toolName:name,isError:false,details:{state:"completed",timedOut:false},content:[]}});if(taskId==="consult-review")tool(v2?"subagent-v2-consult":"subagent_consult");else{const count=taskId==="parallel-research"?2:1;for(let index=0;index<count;index++)tool(v2?"subagent-v2-start":"subagent_spawn");if(taskId==="worker-fix")fs.writeFileSync("src/math.mjs","export function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }\\nexport function isEven(value) { return value % 2 === 0; }\\n");for(let index=0;index<count;index++)tool(v2?"subagent-v2-wait":"subagent_await");}send({type:"message_end",message:{role:"assistant",content:[{type:"text",text:final(taskId)}]}});});',
		].join("\n"),
		{ mode: 0o700 },
	);
	try {
		await execFileAsync(
			process.execPath,
			[
				"scripts/benchmark-subagent-capabilities.ts",
				"--run",
				"--model",
				"provider/model",
				"--pi",
				fakePi,
				"--output",
				output,
			],
			{
				cwd: path.resolve(import.meta.dirname, ".."),
				env: { ...process.env, TMPDIR: directory },
				timeout: 4_000,
			},
		);
		const result = JSON.parse(readFileSync(output, "utf8")) as {
			rawRecords: Array<{ success: boolean }>;
			summary: { arms: Record<string, { successes: number }> };
		};
		assert.equal(result.rawRecords.length, 8);
		assert.ok(result.rawRecords.every((record) => record.success));
		assert.equal(result.summary.arms["pi-subagents"].successes, 4);
		assert.equal(result.summary.arms["pi-subagents-v2"].successes, 4);
		assert.equal(
			readdirSync(directory).some(
				(name) =>
					name.startsWith("subagent-capability-pi-") ||
					name.startsWith("subagent-capability-agent-"),
			),
			false,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("manual runner preview exposes controls and makes no provider request", async () => {
	const { stdout } = await execFileAsync(
		process.execPath,
		["scripts/benchmark-subagent-capabilities.ts", "--model", "provider/model"],
		{ cwd: path.resolve(import.meta.dirname, ".."), timeout: 3_000 },
	);
	const preview = JSON.parse(stdout) as {
		preview: boolean;
		pairs: number;
		retries: number;
		comparability: { cost: string };
		capabilityMatrix: unknown[];
	};
	assert.equal(preview.preview, true);
	assert.equal(preview.pairs, 4);
	assert.equal(preview.retries, 0);
	assert.match(preview.comparability.cost, /not comparable/i);
	assert.ok(preview.capabilityMatrix.length > 0);
});
