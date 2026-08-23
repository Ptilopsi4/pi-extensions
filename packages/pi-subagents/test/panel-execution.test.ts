import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import subagents from "../src/subagents.js";
import { installSubagentsTestEnvironment } from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
writeFileSync(
	path.join(process.env.PI_CODING_AGENT_DIR ?? "", "pi-subagents.json"),
	JSON.stringify({ blocking: { enabled: true }, stateful: { enabled: true } }),
);
afterAll(restoreTestEnvironment);

const CORE_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

type PanelTestResult = {
	content: Array<{ type: string; text: string }>;
	details: {
		mode: string;
		results: Array<{
			attemptCount?: number;
			executionPlan?: { effectiveTools?: string[]; workspaceMode?: string };
		}>;
		panel: {
			state: string;
			validReviewCount: number;
			blockingObjectionCount: number;
			evidence: unknown[];
			failures: Array<{ kind: string }>;
			synthesis?: { summary: string };
			cleanupComplete: boolean;
		};
		workflow: { items: Array<{ id: string; state: string }> };
	};
	isError?: boolean;
};

type PanelTestTool = {
	execute: (...args: unknown[]) => Promise<PanelTestResult>;
};

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for test readiness");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function useFakePiPackage(packageDir: string, cliPath: string): () => void {
	writeFileSync(
		path.join(packageDir, "package.json"),
		JSON.stringify({ name: CORE_PACKAGE_NAME, bin: { pi: path.relative(packageDir, cliPath) } }),
	);
	const previous = process.env.PI_PACKAGE_DIR;
	process.env.PI_PACKAGE_DIR = packageDir;
	return () => {
		if (previous === undefined) delete process.env.PI_PACKAGE_DIR;
		else process.env.PI_PACKAGE_DIR = previous;
	};
}

test("blocking tool exposes a bounded first-class panel schema and guidance", () => {
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools.find((candidate) => candidate.name === "subagent");
	const schema = tool?.parameters as {
		properties?: Record<
			string,
			{
				enum?: string[];
				properties?: Record<string, { enum?: string[]; minItems?: number; maxItems?: number }>;
			}
		>;
	};
	assert.deepEqual(schema.properties?.panel?.properties?.preset?.enum, [
		"code-review",
		"research",
		"security-review",
		"custom",
	]);
	assert.equal(schema.properties?.panel?.properties?.reviewers?.minItems, 2);
	assert.match(String(tool?.description), /panel/i);
	const guidelines = tool?.promptGuidelines;
	assert.ok(Array.isArray(guidelines));
	assert.match(guidelines.join("\n"), /agreement is not proof/i);
});

test("panel mode rejects mixed modes and unknown agents before launch", async () => {
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
	const panel = {
		task: "Review",
		reviewers: [
			{ id: "a", agent: "explorer" },
			{ id: "b", agent: "explorer" },
		],
		synthesizer: { agent: "explorer" },
	};
	const mixed = await tool.execute(
		"panel-mixed",
		{ agent: "explorer", task: "single", panel },
		undefined,
		undefined,
		createMockContext().ctx,
	);
	assert.match(mixed.content[0].text, /exactly one mode/i);
	await assert.rejects(
		() =>
			tool.execute(
				"panel-unknown",
				{ panel: { ...panel, synthesizer: { agent: "missing" } } },
				undefined,
				undefined,
				createMockContext().ctx,
			),
		/unknown panel agent/i,
	);
});

test("panel project agents use the existing trust and confirmation boundary", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-project-agent-"));
	const agentsDir = path.join(root, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });
	writeFileSync(
		path.join(agentsDir, "project-reviewer.md"),
		"---\nname: project-reviewer\ndescription: Project panel reviewer\ntools: read,grep,find,ls\n---\nReview independently.",
	);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "add", ".pi/agents/project-reviewer.md"]);
	execFileSync("git", [
		"-c",
		"user.name=Panel Test",
		"-c",
		"user.email=panel@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"-C",
		root,
		"commit",
		"-qm",
		"test fixture",
	]);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		let confirmation = "";
		const result = await tool.execute(
			"panel-project",
			{
				agentScope: "project",
				panel: {
					task: "Review",
					reviewers: [
						{ id: "a", agent: "project-reviewer" },
						{ id: "b", agent: "project-reviewer" },
					],
					synthesizer: { agent: "project-reviewer" },
				},
			},
			undefined,
			undefined,
			createMockContext({
				cwd: root,
				hasUI: true,
				isProjectTrusted: () => true,
				confirm: async (title: string, message: string) => {
					confirmation = `${title}\n${message}`;
					return false;
				},
			}).ctx,
		);
		assert.match(result.content[0].text, /Canceled/);
		assert.match(confirmation, /project-reviewer/);
		assert.match(confirmation, /\.pi\/agents/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("panel executes isolated reviewers, preserves evidence, then synthesizes once", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-success-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	const log = path.join(root, "launches.ndjson");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`const log=${JSON.stringify(log)};`,
			"const task=process.argv.at(-1)??'';",
			"appendFileSync(log,JSON.stringify({task,cwd:process.cwd()})+'\\n');",
			'const match=task.match(/reviewerId \\"([^\\"]+)/);',
			"let result;",
			"if(match){const id=match[1];result={version:'pi-subagents:panel-review:v1',reviewerId:id,disposition:id==='a'?'fail':'pass',blocking:id==='a',findings:id==='a'?[{id:'F1',severity:'high',title:'Bug',claim:'A bug exists',evidence:['src/a.ts:1']}]:[],missingChecks:[],limitations:[]};}",
			"else{result={version:'pi-subagents:panel-synthesis:v1',disposition:'fail',summary:'Blocker preserved',validReviewerIds:['a','b'],failedReviewerIds:[],agreements:[],disagreements:[],objections:[{reviewerId:'a',findingId:'F1',resolution:'unresolved',evidence:[]}],limitations:[]};}",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	chmodSync(fakePi, 0o755);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-success",
			{
				totalTimeoutMs: 10_000,
				panel: {
					id: "panel-success",
					preset: "code-review",
					task: "Review the shared change",
					context: "diff: shared",
					reviewers: [
						{ id: "a", agent: "explorer", focus: "correctness" },
						{ id: "b", agent: "explorer", focus: "tests" },
					],
					synthesizer: { agent: "explorer" },
					minValidReviews: 2,
				},
			},
			new AbortController().signal,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.isError, undefined);
		assert.equal(result.details.mode, "panel");
		assert.equal(result.details.panel.state, "completed");
		assert.equal(result.details.panel.validReviewCount, 2);
		assert.equal(result.details.panel.blockingObjectionCount, 1);
		assert.equal(result.details.panel.synthesis?.summary, "Blocker preserved");
		assert.match(result.content[0].text, /Blocker preserved/);
		assert.ok(
			result.details.results.every(
				(reviewer) =>
					reviewer.executionPlan?.workspaceMode === "shared" &&
					!reviewer.executionPlan.effectiveTools?.includes("bash"),
			),
		);
		const launches = readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(launches.length, 3);
		assert.equal(
			launches.filter((entry) => entry.task.includes("Panel review contract")).length,
			2,
		);
		assert.equal(
			launches.filter((entry) => entry.task.includes("Panel evidence artifacts")).length,
			1,
		);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("timed-out reviewers receive one bounded contract finalization turn", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-finalization-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	const log = path.join(root, "launches.txt");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`appendFileSync(${JSON.stringify(log)},'launch\\n');`,
			"const task=process.argv.at(-1)??'';const match=task.match(/reviewerId \\\"([^\\\"]+)/);",
			"if(match&&!task.includes('prior attempt stopped')){setInterval(()=>{},1000);}",
			"else{let result;if(match){result={version:'pi-subagents:panel-review:v1',reviewerId:match[1],disposition:'partial',blocking:false,findings:[],missingChecks:['original work timed out'],limitations:['finalized from checkpoint']};}",
			"else{result={version:'pi-subagents:panel-synthesis:v1',disposition:'partial',summary:'Finalized evidence preserved',validReviewerIds:['a','b'],failedReviewerIds:[],agreements:[],disagreements:[],objections:[],limitations:['reviewers timed out before finalization']};}",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');}",
		].join(""),
	);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-finalization",
			{
				totalTimeoutMs: 5_000,
				panel: {
					task: "Review",
					reviewers: [
						{ id: "a", agent: "explorer", timeoutMs: 50 },
						{ id: "b", agent: "explorer", timeoutMs: 50 },
					],
					synthesizer: { agent: "explorer" },
				},
			},
			undefined,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.details.panel.state, "completed");
		assert.equal(result.details.panel.validReviewCount, 2);
		assert.deepEqual(
			result.details.results.map((reviewer) => reviewer.attemptCount),
			[2, 2],
		);
		const launches = readFileSync(log, "utf8").trim().split("\n").length;
		assert.ok(launches >= 3 && launches <= 5);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("panel preserves valid reviews when synthesis returns an invalid contract", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-synthesis-failure-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"const task=process.argv.at(-1)??'';const match=task.match(/reviewerId \\\"([^\\\"]+)/);",
			"const text=match?JSON.stringify({version:'pi-subagents:panel-review:v1',reviewerId:match[1],disposition:'pass',blocking:false,findings:[],missingChecks:[],limitations:[]}):'invalid synthesis';",
			"const message={role:'assistant',content:[{type:'text',text}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-synthesis-failure",
			{
				panel: {
					task: "Review",
					reviewers: [
						{ id: "a", agent: "explorer" },
						{ id: "b", agent: "explorer" },
					],
					synthesizer: { agent: "explorer" },
				},
			},
			undefined,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.isError, true);
		assert.equal(result.details.panel.state, "failed");
		assert.equal(result.details.panel.evidence.length, 2);
		assert.equal(
			result.details.workflow.items.find((item) => item.id === "synthesis")?.state,
			"failed",
		);
		assert.match(result.content[0].text, /invalid panel-synthesis contract/i);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("panel marks valid synthesis output from an errored process as failed", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-synthesis-exit-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"const task=process.argv.at(-1)??'';const match=task.match(/reviewerId \\\"([^\\\"]+)/);let result;",
			"if(match){result={version:'pi-subagents:panel-review:v1',reviewerId:match[1],disposition:'pass',blocking:false,findings:[],missingChecks:[],limitations:[]};}",
			"else{result={version:'pi-subagents:panel-synthesis:v1',disposition:'pass',summary:'valid but errored',validReviewerIds:['a','b'],failedReviewerIds:[],agreements:[],disagreements:[],objections:[],limitations:[]};}",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
			"if(!match)process.exitCode=1;",
		].join(""),
	);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-synthesis-exit",
			{
				panel: {
					task: "Review",
					reviewers: [
						{ id: "a", agent: "explorer" },
						{ id: "b", agent: "explorer" },
					],
					synthesizer: { agent: "explorer" },
				},
			},
			undefined,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.isError, true);
		assert.equal(result.details.panel.state, "failed");
		assert.equal(result.details.panel.synthesis?.summary, "valid but errored");
		assert.equal(
			result.details.workflow.items.find((item) => item.id === "synthesis")?.state,
			"failed",
		);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("panel retries transient transport failures once within the review phase", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-retry-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	const log = path.join(root, "launches.txt");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync,existsSync,writeFileSync}from'node:fs';",
			`const root=${JSON.stringify(root)};const log=${JSON.stringify(log)};`,
			"appendFileSync(log,'launch\\n');const task=process.argv.at(-1)??'';const match=task.match(/reviewerId \\\"([^\\\"]+)/);let result;",
			"if(match){const id=match[1];const marker=root+'/'+id+'.once';if(!existsSync(marker)){writeFileSync(marker,'1');process.stderr.write('ECONNRESET');process.exit(1);}result={version:'pi-subagents:panel-review:v1',reviewerId:id,disposition:'pass',blocking:false,findings:[],missingChecks:[],limitations:[]};}",
			"else{result={version:'pi-subagents:panel-synthesis:v1',disposition:'pass',summary:'recovered',validReviewerIds:['a','b'],failedReviewerIds:[],agreements:[],disagreements:[],objections:[],limitations:[]};}",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-retry",
			{
				panel: {
					task: "Review",
					reviewers: [
						{ id: "a", agent: "explorer" },
						{ id: "b", agent: "explorer" },
					],
					synthesizer: { agent: "explorer" },
				},
			},
			undefined,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.details.panel.state, "completed");
		assert.deepEqual(
			result.details.results.map((reviewer) => reviewer.attemptCount),
			[2, 2],
		);
		assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 5);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("write-capable panel reviewers use separate disposable worktrees", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-worktrees-"));
	const repository = path.join(root, "repository");
	const packageRoot = path.join(root, "pi-package");
	mkdirSync(repository);
	mkdirSync(packageRoot);
	writeFileSync(path.join(repository, "README.md"), "panel\n");
	execFileSync("git", ["init", "-q", repository]);
	execFileSync("git", ["-C", repository, "add", "README.md"]);
	execFileSync("git", [
		"-c",
		"user.name=Panel Test",
		"-c",
		"user.email=panel@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"-C",
		repository,
		"commit",
		"-qm",
		"test fixture",
	]);
	const fakePi = path.join(packageRoot, "fake-pi.mjs");
	const log = path.join(root, "launches.ndjson");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`const log=${JSON.stringify(log)};`,
			"const task=process.argv.at(-1)??'';appendFileSync(log,JSON.stringify({task,cwd:process.cwd()})+'\\n');",
			'const match=task.match(/reviewerId \\"([^\\"]+)/);let result;',
			"if(match){result={version:'pi-subagents:panel-review:v1',reviewerId:match[1],disposition:'pass',blocking:false,findings:[],missingChecks:[],limitations:[]};}",
			"else{result={version:'pi-subagents:panel-synthesis:v1',disposition:'pass',summary:'ok',validReviewerIds:['a','b'],failedReviewerIds:[],agreements:[],disagreements:[],objections:[],limitations:[]};}",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restore = useFakePiPackage(packageRoot, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-worktrees",
			{
				panel: {
					task: "Review without touching the canonical repository",
					reviewers: [
						{ id: "a", agent: "worker" },
						{ id: "b", agent: "worker" },
					],
					synthesizer: { agent: "worker" },
				},
			},
			undefined,
			undefined,
			createMockContext({ cwd: repository, isProjectTrusted: () => true }).ctx,
		);
		assert.equal(result.details.panel.state, "completed");
		assert.ok(
			result.details.results.every(
				(reviewer) => reviewer.executionPlan?.workspaceMode === "worktree",
			),
		);
		const launches = readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const reviewerCwds = launches
			.filter((entry) => entry.task.includes("Panel review contract"))
			.map((entry) => entry.cwd);
		assert.equal(new Set(reviewerCwds).size, 2);
		assert.ok(reviewerCwds.every((cwd) => cwd !== repository));
		assert.ok(reviewerCwds.every((cwd) => !existsSync(cwd)));
		assert.equal(
			launches.find((entry) => entry.task.includes("Panel evidence artifacts"))?.cwd,
			repository,
		);
		assert.equal(result.details.panel.cleanupComplete, true);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("an insufficient panel returns partial evidence and never launches synthesis", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-insufficient-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	const log = path.join(root, "launches.txt");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`appendFileSync(${JSON.stringify(log)},'launch\\n');`,
			"const task=process.argv.at(-1)??'';",
			'const match=task.match(/reviewerId \\"([^\\"]+)/);',
			"const text=match?.[1]==='a'?JSON.stringify({version:'pi-subagents:panel-review:v1',reviewerId:'a',disposition:'partial',blocking:false,findings:[],missingChecks:['b failed'],limitations:[]}):'not-json';",
			"const message={role:'assistant',content:[{type:'text',text}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-insufficient",
			{
				panel: {
					task: "Review",
					reviewers: [
						{ id: "a", agent: "explorer" },
						{ id: "b", agent: "explorer" },
					],
					synthesizer: { agent: "explorer" },
				},
			},
			undefined,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.isError, true);
		assert.equal(result.details.panel.state, "insufficient-panel");
		assert.equal(result.details.panel.evidence.length, 1);
		assert.equal(result.details.panel.failures[0].kind, "invalid-contract");
		assert.doesNotMatch(result.content[0].text, /consensus|verified/i);
		assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("ordinary reviewer progress updates do not trigger a semantic stall", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-progress-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"const task=process.argv.at(-1)??'';const match=task.match(/reviewerId \\\"([^\\\"]+)/);let result;",
			"if(match){for(let i=0;i<10;i++){const progress={role:'assistant',content:[{type:'text',text:'ordinary tool progress '+i}],stopReason:'toolUse',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message:progress})+'\\n');await new Promise(resolve=>setTimeout(resolve,20));}result={version:'pi-subagents:panel-review:v1',reviewerId:match[1],disposition:'pass',blocking:false,findings:[],missingChecks:[],limitations:[]};}",
			"else{result={version:'pi-subagents:panel-synthesis:v1',disposition:'pass',summary:'progress completed',validReviewerIds:['a','b'],failedReviewerIds:[],agreements:[],disagreements:[],objections:[],limitations:[]};}",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-progress",
			{
				totalTimeoutMs: 5_000,
				panel: {
					task: "Review after ordinary progress",
					reviewers: [
						{ id: "a", agent: "explorer" },
						{ id: "b", agent: "explorer" },
					],
					synthesizer: { agent: "explorer" },
				},
			},
			undefined,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.details.panel.state, "completed");
		assert.equal(result.details.panel.validReviewCount, 2);
		assert.equal(result.details.panel.failures.length, 0);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("panel semantic progress stops repeated evidence states without blind retries", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-stall-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	const log = path.join(root, "launches.txt");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`appendFileSync(${JSON.stringify(log)},'launch\\n');`,
			"const task=process.argv.at(-1)??'';const match=task.match(/reviewerId \\\"([^\\\"]+)/);",
			"if(match){const result={version:'pi-subagents:panel-review:v1',reviewerId:match[1],disposition:'partial',blocking:false,findings:[],missingChecks:['unfinished'],limitations:[]};for(let i=0;i<9;i++){const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'toolUse',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');await new Promise(resolve=>setTimeout(resolve,20));}setInterval(()=>{},1000);}",
			"else{const result={version:'pi-subagents:panel-synthesis:v1',disposition:'partial',summary:'partial evidence preserved',validReviewerIds:['a','b'],failedReviewerIds:['a','b'],agreements:[],disagreements:[],objections:[],limitations:['reviewers stalled']};const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');}",
		].join(""),
	);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const result = await tool.execute(
			"panel-stall",
			{
				totalTimeoutMs: 5_000,
				panel: {
					task: "Review with evidence",
					reviewers: [
						{ id: "a", agent: "explorer" },
						{ id: "b", agent: "explorer" },
					],
					synthesizer: { agent: "explorer" },
				},
			},
			undefined,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.details.panel.state, "degraded");
		assert.equal(result.details.panel.validReviewCount, 2);
		assert.deepEqual(
			result.details.panel.failures.map((failure) => failure.kind),
			["semantic-stall", "semantic-stall"],
		);
		assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 3);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("pre-cancelled panel setup creates no disposable worktrees", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-setup-cancel-"));
	const repository = path.join(root, "repository");
	const worktreeLog = path.join(root, "worktrees.txt");
	mkdirSync(repository);
	writeFileSync(path.join(repository, "README.md"), "panel\n");
	execFileSync("git", ["init", "-q", repository]);
	execFileSync("git", ["-C", repository, "add", "README.md"]);
	execFileSync("git", [
		"-c",
		"user.name=Panel Test",
		"-c",
		"user.email=panel@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"-C",
		repository,
		"commit",
		"-qm",
		"test fixture",
	]);
	const hook = path.join(repository, ".git", "hooks", "post-checkout");
	writeFileSync(hook, `#!/bin/sh\nprintf '%s\\n' "$PWD" >> ${JSON.stringify(worktreeLog)}\n`);
	chmodSync(hook, 0o755);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const controller = new AbortController();
		controller.abort(new DOMException("test setup cancellation", "AbortError"));
		await assert.rejects(
			() =>
				tool.execute(
					"panel-setup-cancel",
					{
						panel: {
							task: "Do not create worktrees",
							reviewers: [
								{ id: "a", agent: "worker" },
								{ id: "b", agent: "worker" },
							],
							synthesizer: { agent: "worker" },
						},
					},
					controller.signal,
					undefined,
					createMockContext({ cwd: repository, isProjectTrusted: () => true }).ctx,
				),
			/abort|cancel/i,
		);
		assert.equal(existsSync(worktreeLog), false);
		assert.equal(
			execFileSync("git", ["-C", repository, "worktree", "list", "--porcelain"], {
				encoding: "utf8",
			})
				.trim()
				.split("\n\n").length,
			1,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("cancellation during worktree creation stops later setup and cleans partial state", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-setup-race-"));
	const repository = path.join(root, "repository");
	const worktreeLog = path.join(root, "worktrees.txt");
	const releaseHook = path.join(root, "release-hook");
	mkdirSync(repository);
	writeFileSync(path.join(repository, "README.md"), "panel\n");
	execFileSync("git", ["init", "-q", repository]);
	execFileSync("git", ["-C", repository, "add", "README.md"]);
	execFileSync("git", [
		"-c",
		"user.name=Panel Test",
		"-c",
		"user.email=panel@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"-C",
		repository,
		"commit",
		"-qm",
		"test fixture",
	]);
	const hook = path.join(repository, ".git", "hooks", "post-checkout");
	writeFileSync(
		hook,
		`#!/bin/sh\nprintf '%s\\n' "$PWD" >> ${JSON.stringify(worktreeLog)}\nwhile [ ! -f ${JSON.stringify(releaseHook)} ]; do sleep 0.01; done\n`,
	);
	chmodSync(hook, 0o755);
	const mock = createMockPi();
	subagents(mock.pi);
	const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
	const controller = new AbortController();
	const execution = tool.execute(
		"panel-setup-race",
		{
			panel: {
				task: "Stop setup after cancellation",
				reviewers: [
					{ id: "a", agent: "worker" },
					{ id: "b", agent: "worker" },
				],
				synthesizer: { agent: "worker" },
			},
		},
		controller.signal,
		undefined,
		createMockContext({ cwd: repository, isProjectTrusted: () => true }).ctx,
	);
	try {
		await waitFor(() => existsSync(worktreeLog));
		controller.abort(new DOMException("cancelled during workspace setup", "AbortError"));
		writeFileSync(releaseHook, "release\n");
		await assert.rejects(() => execution, /abort|cancel/i);
		const createdWorktrees = readFileSync(worktreeLog, "utf8").trim().split("\n");
		assert.equal(createdWorktrees.length, 1);
		assert.equal(existsSync(createdWorktrees[0]), false);
		assert.equal(
			execFileSync("git", ["-C", repository, "worktree", "list", "--porcelain"], {
				encoding: "utf8",
			})
				.trim()
				.split("\n\n").length,
			1,
		);
	} finally {
		writeFileSync(releaseHook, "release\n");
		await execution.catch(() => undefined);
		rmSync(root, { recursive: true, force: true });
	}
});

test("session shutdown cancels blocking panels and removes owned worktrees", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-shutdown-"));
	const repository = path.join(root, "repository");
	const packageRoot = path.join(root, "pi-package");
	mkdirSync(repository);
	mkdirSync(packageRoot);
	writeFileSync(path.join(repository, "README.md"), "panel\n");
	execFileSync("git", ["init", "-q", repository]);
	execFileSync("git", ["-C", repository, "add", "README.md"]);
	execFileSync("git", [
		"-c",
		"user.name=Panel Test",
		"-c",
		"user.email=panel@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"-C",
		repository,
		"commit",
		"-qm",
		"test fixture",
	]);
	const fakePi = path.join(packageRoot, "fake-pi.mjs");
	const log = path.join(root, "launches.ndjson");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`appendFileSync(${JSON.stringify(log)},JSON.stringify({cwd:process.cwd()})+'\\n');`,
			"setInterval(()=>{},1000);",
		].join(""),
	);
	const restore = useFakePiPackage(packageRoot, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const context = createMockContext({ cwd: repository, isProjectTrusted: () => true });
		const execution = tool.execute(
			"panel-shutdown",
			{
				totalTimeoutMs: 10_000,
				panel: {
					task: "Wait for shutdown",
					reviewers: [
						{ id: "a", agent: "worker" },
						{ id: "b", agent: "worker" },
					],
					synthesizer: { agent: "worker" },
				},
			},
			undefined,
			undefined,
			context.ctx,
		);
		await waitFor(
			() => existsSync(log) && readFileSync(log, "utf8").trim().split("\n").length === 2,
		);
		await Promise.all(
			(mock.events.get("session_shutdown") ?? []).map((handler) => handler({}, context.ctx)),
		);
		const result = await execution;
		assert.equal(result.details.panel.state, "cancelled");
		assert.equal(result.details.panel.cleanupComplete, true);
		const worktrees = readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line).cwd as string);
		assert.ok(worktrees.every((cwd) => !existsSync(cwd)));
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("panel cancellation closes the child group and skips synthesis", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-panel-cancel-"));
	const fakePi = path.join(root, "fake-pi.mjs");
	const log = path.join(root, "launches.txt");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`appendFileSync(${JSON.stringify(log)},'launch\\n');`,
			"setInterval(()=>{},1000);",
		].join(""),
	);
	const restore = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as PanelTestTool;
		const controller = new AbortController();
		setTimeout(() => controller.abort("test-cancel"), 50);
		const result = await tool.execute(
			"panel-cancel",
			{
				totalTimeoutMs: 2_000,
				panel: {
					task: "Review until cancelled",
					reviewers: Array.from({ length: 5 }, (_, index) => ({
						id: `reviewer-${index}`,
						agent: "explorer",
					})),
					synthesizer: { agent: "explorer" },
				},
			},
			controller.signal,
			undefined,
			createMockContext().ctx,
		);
		assert.equal(result.isError, true);
		assert.equal(result.details.panel.state, "cancelled");
		assert.equal(result.details.panel.cleanupComplete, true);
		assert.equal(
			result.details.workflow.items.find((item: { id: string }) => item.id === "synthesis")?.state,
			"interrupted",
		);
		assert.ok(!existsSync(log) || readFileSync(log, "utf8").trim().split("\n").length <= 4);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});
