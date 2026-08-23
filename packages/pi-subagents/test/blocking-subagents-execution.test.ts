import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { afterAll, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import subagents from "../src/subagents.js";
import {
	installSubagentsTestEnvironment,
	type SubagentTool,
	useFakePiPackage,
} from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
writeFileSync(
	path.join(process.env.PI_CODING_AGENT_DIR ?? "", "pi-subagents.json"),
	JSON.stringify({ blocking: { enabled: true }, stateful: { enabled: true } }),
);
afterAll(restoreTestEnvironment);

test("blocking delegation preflights every target and passes explicit saved trust", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-blocking-cwd-"));
	const agentDir = path.join(root, "agent-home");
	const workspace = path.join(root, "workspace");
	const external = path.join(root, "external");
	const marker = path.join(root, "launched");
	const fakePi = path.join(root, "fake-pi.mjs");
	mkdirSync(agentDir);
	writeFileSync(
		path.join(agentDir, "pi-subagents.json"),
		JSON.stringify({ blocking: { enabled: true }, stateful: { enabled: true } }),
	);
	mkdirSync(workspace);
	mkdirSync(external);
	writeFileSync(
		fakePi,
		[
			"import{writeFileSync}from'node:fs';",
			`writeFileSync(${JSON.stringify(marker)},'yes');`,
			"const text=process.argv.slice(2).join(' ');",
			"const message={role:'assistant',content:[{type:'text',text}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const restorePiPackage = useFakePiPackage(root, fakePi);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as SubagentTool;
		const ctx = createMockContext({ cwd: workspace, isProjectTrusted: () => true }).ctx;
		for (const params of [
			{ agent: "explorer", task: "single", cwd: external },
			{
				chain: [
					{ agent: "explorer", task: "first", cwd: workspace },
					{ agent: "explorer", task: "second", cwd: external },
				],
			},
			{
				tasks: [
					{ agent: "explorer", task: "first", cwd: workspace },
					{ agent: "explorer", task: "second", cwd: external },
				],
			},
			{
				tasks: [{ agent: "explorer", task: "first", cwd: workspace }],
				aggregator: { agent: "explorer", task: "fan-in", cwd: external },
			},
		] as Array<Record<string, unknown>>) {
			await assert.rejects(
				() => tool.execute("cwd-policy", params, undefined, undefined, ctx),
				/saved-trusted.*\/trust/i,
			);
			assert.equal(existsSync(marker), false);
		}

		new ProjectTrustStore(agentDir).set(external, true);
		const accepted = await tool.execute(
			"cwd-trusted",
			{ agent: "explorer", task: "trusted", cwd: external },
			undefined,
			undefined,
			ctx,
		);
		assert.match(accepted.content?.[0]?.text ?? "", /--approve/);
		assert.equal(accepted.details?.results[0]?.target?.trust.kind, "saved-trusted");
		assert.equal(accepted.details?.results[0]?.target?.cwd, realpathSync(external));

		rmSync(marker, { force: true });
		writeFileSync(
			path.join(agentDir, "pi-subagents.json"),
			JSON.stringify({
				blocking: { enabled: true },
				stateful: { enabled: true },
				cwdPolicy: { delegation: "anywhere" },
			}),
		);
		const anywhereMock = createMockPi();
		subagents(anywhereMock.pi);
		const anywhereTool = anywhereMock.tools.find(
			(candidate) => candidate.name === "subagent",
		) as SubagentTool;
		new ProjectTrustStore(agentDir).set(external, false);
		const anywhere = await anywhereTool.execute(
			"cwd-anywhere",
			{ agent: "explorer", task: "anywhere", cwd: external },
			undefined,
			undefined,
			ctx,
		);
		assert.match(anywhere.content?.[0]?.text ?? "", /--no-approve/);
		assert.equal(anywhere.details?.results[0]?.target?.trust.kind, "saved-denied");
	} finally {
		restorePiPackage();
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
});

test("parallel execution ignores an empty optional aggregator and preserves worker outputs", async () => {
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools[0] as SubagentTool;
	const { ctx } = createMockContext();
	const signal = new AbortController().signal;
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-empty-aggregator-"));
	const fakePi = path.join(dir, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"const task=process.argv.at(-1) ?? '';",
			"const output=task.includes('PROOF')?'PROOF_OK':'CALC_OK';",
			"const message={role:'assistant',content:[{type:'text',text:output}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(dir, fakePi);
	try {
		const result = await tool.execute(
			"empty-aggregator",
			{
				tasks: [
					{ agent: "explorer", task: "PROOF" },
					{ agent: "explorer", task: "CALC" },
				],
				aggregator: { agent: " ", task: "\t", thinkingLevel: "off", timeoutMs: 1 },
			},
			signal,
			() => undefined,
			ctx,
		);
		assert.equal(result.isError, undefined);
		assert.equal(result.details?.aggregator, undefined);
		assert.match(result.content?.[0]?.text ?? "", /Parallel: 2\/2 succeeded/);
		assert.match(result.content?.[0]?.text ?? "", /PROOF_OK/);
		assert.match(result.content?.[0]?.text ?? "", /CALC_OK/);
	} finally {
		restorePiPackage();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("blocking totalTimeoutMs caps chains, queued parallel work, and fan-in", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-total-deadline-"));
	const marker = path.join(root, "launches.txt");
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			"const task=process.argv.at(-1)??'';",
			"if(task.includes('active work was aborted')){const message={role:'assistant',content:[{type:'text',text:'CHECKPOINT'}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');process.exit(0);}",
			`appendFileSync(${JSON.stringify(marker)},task+'\\n');`,
			"if(task.includes('FAST')){const message={role:'assistant',content:[{type:'text',text:'DONE'}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');process.exit(0);}",
			"if(task.includes('LIMIT_EARLY')){const message={role:'assistant',content:[{type:'toolCall',id:'1',name:'read',arguments:{}},{type:'toolCall',id:'2',name:'read',arguments:{}}],stopReason:'toolUse',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');}",
			"setInterval(()=>{},1000);",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as SubagentTool;
		const { ctx } = createMockContext();

		const earlyLimit = await tool.execute(
			"early-limit",
			{
				agent: "explorer",
				task: "LIMIT_EARLY",
				timeoutMs: 5_000,
				totalTimeoutMs: 1_000,
				maxToolCalls: 1,
			},
			new AbortController().signal,
			undefined,
			ctx,
		);
		assert.equal(earlyLimit.details?.results[0]?.termination?.reason, "tool_call_limit");
		assert.equal(earlyLimit.details?.results[0]?.termination?.finalization.status, "completed");

		writeFileSync(marker, "");
		const chain = await tool.execute(
			"total-chain",
			{
				totalTimeoutMs: 120,
				chain: [
					{ agent: "explorer", task: "SLOW_FIRST", timeoutMs: 5_000 },
					{ agent: "explorer", task: "SECOND_MUST_NOT_START", timeoutMs: 5_000 },
				],
			},
			new AbortController().signal,
			undefined,
			ctx,
		);
		assert.equal(chain.details?.results[0]?.termination?.reason, "orchestration_timeout");
		assert.equal(chain.details?.results.length, 1);
		assert.doesNotMatch(readFileSync(marker, "utf8"), /SECOND_MUST_NOT_START/);

		writeFileSync(marker, "");
		const parallel = await tool.execute(
			"total-parallel",
			{
				totalTimeoutMs: 250,
				tasks: Array.from({ length: 5 }, (_, index) => ({
					agent: "explorer",
					task: `SLOW_${index}`,
					timeoutMs: 5_000,
				})),
			},
			new AbortController().signal,
			undefined,
			ctx,
		);
		const launches = readFileSync(marker, "utf8").trim().split("\n").filter(Boolean);
		assert.equal(launches.length, 4);
		assert.equal(parallel.details?.results[4]?.termination?.reason, "orchestration_timeout");

		writeFileSync(marker, "");
		const fanIn = await tool.execute(
			"total-fan-in",
			{
				totalTimeoutMs: 120,
				tasks: [{ agent: "explorer", task: "SLOW_FANOUT", timeoutMs: 5_000 }],
				aggregator: { agent: "explorer", task: "AGGREGATOR_MUST_NOT_START", timeoutMs: 5_000 },
			},
			new AbortController().signal,
			undefined,
			ctx,
		);
		assert.equal(fanIn.details?.aggregator?.termination?.reason, "orchestration_timeout");
		assert.doesNotMatch(readFileSync(marker, "utf8"), /AGGREGATOR_MUST_NOT_START/);
	} finally {
		restorePiPackage();
		rmSync(root, { recursive: true, force: true });
	}
});

test("subagent execute resolves thinking level in single, chain, parallel, and aggregator modes", async () => {
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools[0] as SubagentTool;
	const { ctx } = createMockContext();
	const signal = new AbortController().signal;

	const single = await tool.execute(
		"single",
		{ agent: "missing", task: "single", thinkingLevel: "medium" },
		signal,
		() => undefined,
		ctx,
	);
	assert.equal(single.details?.results[0]?.thinkingLevel, "medium");

	const chain = await tool.execute(
		"chain",
		{
			thinkingLevel: "low",
			chain: [{ agent: "missing", task: "chain", thinkingLevel: "high" }],
		},
		signal,
		() => undefined,
		ctx,
	);
	assert.equal(chain.details?.results[0]?.thinkingLevel, "high");

	const parallel = await tool.execute(
		"parallel",
		{
			thinkingLevel: "minimal",
			tasks: [
				{ agent: "missing", task: "inherits top level" },
				{ agent: "missing", task: "local override", thinkingLevel: "off" },
			],
			aggregator: { agent: "missing", task: "aggregate", thinkingLevel: "xhigh" },
		},
		signal,
		() => undefined,
		ctx,
	);
	assert.equal(parallel.details?.results[0]?.thinkingLevel, "minimal");
	assert.equal(parallel.details?.results[1]?.thinkingLevel, "off");
	assert.equal(parallel.details?.aggregator?.thinkingLevel, "xhigh");
});

test("parallel updates keep failed fan-out pending while fan-in starts", async () => {
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools[0] as SubagentTool;
	const { ctx } = createMockContext();
	const signal = new AbortController().signal;
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-pending-fan-in-"));
	const fakePi = path.join(dir, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"const task=process.argv.at(-1) ?? '';",
			"const failed=task.includes('RUN_FANOUT_FAILURE')&&!task.includes('RUN_AGGREGATOR');",
			"const message=failed",
			"? {role:'assistant',content:[{type:'text',text:'FANOUT_PARTIAL'}],stopReason:'error',errorMessage:'FANOUT_FAILED',timestamp:Date.now()}",
			": {role:'assistant',content:[{type:'text',text:'FAN_IN_COMPLETE'}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const updates: Array<{
		details?: {
			results: Array<{ stopReason?: string }>;
			aggregator?: { exitCode: number };
		};
	}> = [];
	const restorePiPackage = useFakePiPackage(dir, fakePi);
	try {
		const result = await tool.execute(
			"pending-fan-in",
			{
				tasks: [{ agent: "explorer", task: "RUN_FANOUT_FAILURE" }],
				aggregator: { agent: "explorer", task: "RUN_AGGREGATOR" },
			},
			signal,
			(update: unknown) => updates.push(update as (typeof updates)[number]),
			ctx,
		);
		assert.match(result.content?.[0]?.text ?? "", /FAN_IN_COMPLETE/);
		assert.ok(
			updates.some(
				(update) =>
					update.details?.results[0]?.stopReason === "error" &&
					update.details.aggregator?.exitCode === -1,
			),
			"expected a failed fan-out update with a pending fan-in result",
		);
	} finally {
		restorePiPackage();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("parallel summaries classify provider errors and retain partial output", async () => {
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools[0] as SubagentTool;
	const { ctx } = createMockContext();
	const signal = new AbortController().signal;
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-parallel-error-"));
	const fakePi = path.join(dir, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"const task=process.argv.at(-1) ?? '';",
			"const failed=task.includes('provider failure');",
			"const message=failed",
			"? {role:'assistant',content:[{type:'text',text:'PARTIAL'}],stopReason:'error',errorMessage:'PROVIDER_FAILED',timestamp:Date.now()}",
			": {role:'assistant',content:[{type:'text',text:'DONE'}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(dir, fakePi);
	try {
		const result = await tool.execute(
			"parallel-errors",
			{
				tasks: [
					{ agent: "explorer", task: "provider failure" },
					{ agent: "explorer", task: "success" },
				],
			},
			signal,
			() => undefined,
			ctx,
		);
		const text = result.content?.[0]?.text ?? "";
		assert.match(text, /Parallel: 1\/2 succeeded/);
		assert.match(text, /\[explorer\] failed: PROVIDER_FAILED/);
		assert.match(text, /Partial output:\nPARTIAL/);
		assert.match(text, /\[explorer\] completed: DONE/);
	} finally {
		restorePiPackage();
		rmSync(dir, { recursive: true, force: true });
	}
});
