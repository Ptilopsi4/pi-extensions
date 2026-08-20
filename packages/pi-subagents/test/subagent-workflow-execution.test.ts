import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, test, vi } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import subagents from "../src/subagents.js";
import { inspectSessionWorkflows } from "../src/work-item-persistence.js";
import {
	installSubagentsTestEnvironment,
	type SubagentTool,
	useFakePiPackage,
} from "./subagents-test-helpers.js";

vi.mock("../src/workflow-tree-identity.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/workflow-tree-identity.js")>();
	return {
		...actual,
		captureWorkflowTreeIdentity: async (cwd: string) => {
			const trackedFile = ["feature.txt", "tracked.txt"]
				.map((name) => path.join(cwd, name))
				.find(existsSync);
			const bytes = trackedFile ? readFileSync(trackedFile) : Buffer.from(cwd);
			return {
				version: actual.WORKFLOW_TREE_IDENTITY_VERSION,
				kind: "git-dirty" as const,
				digest: createHash("sha256").update(bytes).digest("hex"),
			};
		},
	};
});

const restoreTestEnvironment = installSubagentsTestEnvironment();
writeReviewerAgent(process.env.PI_CODING_AGENT_DIR ?? "");
afterAll(restoreTestEnvironment);

function writeReviewerAgent(directory: string): void {
	const agentsDir = path.join(directory, "agents");
	mkdirSync(agentsDir, { recursive: true });
	writeFileSync(
		path.join(agentsDir, "reviewer.md"),
		[
			"---",
			"name: reviewer",
			"description: Test review agent",
			"tools: read,grep,find,ls",
			"capabilityManifest:",
			"  version: pi-subagents:capabilities:v1",
			"  capabilities: [code-review]",
			"  modalities: [text]",
			"  resultFormats: [structured-v2]",
			"  authority:",
			"    filesystem: read",
			"  verificationRoles: [independent-review]",
			"---",
			"Review independently.",
		].join("\n"),
	);
}

test("workflow mode schedules dependency-ready tasks and rejects cycles before child launch", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-workflow-"));
	const marker = path.join(root, "launches");
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`appendFileSync(${JSON.stringify(marker)},'launch\\n');`,
			"const task=process.argv.at(-1) ?? '';",
			"const first=task.includes('produce schema');",
			"const duplicate=task.includes('duplicate artifact');",
			"const artifacts=duplicate?[{id:'schema',kind:'document'},{id:'schema',kind:'document'}]:first?[{id:'schema',kind:'document',version:'v1'}]:[];",
			"const result={version:'pi-subagents:result:v2',status:'completed',summary:first?'schema':'used schema',claims:[],artifacts,changes:[],verification:[],limitations:[],unresolvedDependencies:[]};",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as SubagentTool;
		const { ctx } = createMockContext();
		const result = await tool.execute(
			"workflow",
			{
				workflow: {
					id: "wf-test",
					tasks: [
						{
							id: "produce",
							agent: "explorer",
							task: "produce schema",
							resultFormat: "structured-v2",
						},
						{
							id: "consume",
							agent: "explorer",
							task: "consume schema",
							dependsOn: ["produce"],
							inputArtifacts: ["schema"],
							resultFormat: "structured-v2",
						},
					],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(result.isError, undefined);
		assert.equal(
			result.details?.workflow?.items.every((item) => item.state === "completed"),
			true,
		);
		assert.equal(readFileSync(marker, "utf8").trim().split("\n").length, 2);
		const persisted = inspectSessionWorkflows("test-session");
		assert.equal(
			persisted.workflows
				.find((workflow) => workflow.workflowId === "wf-test")
				?.items.every((item) => item.state === "completed"),
			true,
		);

		rmSync(marker, { force: true });
		const routed = await tool.execute(
			"routed",
			{
				workflow: {
					tasks: [
						{
							id: "research",
							task: "produce schema",
							requiredCapabilities: ["repository-search"],
							resultFormat: "structured-v2",
						},
					],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(routed.details?.results[0]?.agent, "explorer");

		rmSync(marker, { force: true });
		const mismatched = await tool.execute(
			"artifact-mismatch",
			{
				workflow: {
					tasks: [
						{
							id: "produce",
							agent: "explorer",
							task: "produce schema",
							resultFormat: "structured-v2",
						},
						{
							id: "consume",
							agent: "explorer",
							task: "consume schema",
							dependsOn: ["produce"],
							inputArtifacts: ["schema"],
							inputArtifactVersions: { schema: "v2" },
						},
					],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(mismatched.isError, true);
		assert.equal(
			mismatched.details?.workflow?.items.find((item) => item.id === "consume")?.state,
			"needs-input",
		);

		rmSync(marker, { force: true });
		const malformedArtifact = await tool.execute(
			"malformed-artifact",
			{
				workflow: {
					id: "wf-malformed-artifact",
					tasks: [
						{
							id: "produce",
							agent: "explorer",
							task: "duplicate artifact",
							resultFormat: "structured-v2",
						},
					],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(malformedArtifact.isError, true);
		assert.equal(malformedArtifact.details?.results[0]?.outcome?.status, "contract-invalid");
		assert.equal(malformedArtifact.details?.workflow?.items[0]?.state, "failed");

		rmSync(marker, { force: true });
		await assert.rejects(
			() =>
				tool.execute(
					"admission-decline",
					{
						workflow: {
							honorAdmission: true,
							tasks: [
								{
									id: "lookup",
									agent: "explorer",
									task: "lookup",
									contract: {
										version: "pi-subagents:delegation:v2",
										level: "minimal",
										taskId: "lookup",
										objective: "lookup",
										admission: {
											contextPressure: "low",
											independentWorkItems: 1,
											coupling: "dense",
											verificationRequired: false,
											verificationAvailable: true,
											budgetAllowsChildren: true,
											requirementsComplete: true,
										},
									},
								},
							],
						},
					},
					undefined,
					undefined,
					ctx,
				),
			/admission declined/i,
		);
		assert.equal(existsSync(marker), false);

		await assert.rejects(
			() =>
				tool.execute(
					"invalid-verifier",
					{
						workflow: {
							tasks: [
								{
									id: "implementation",
									agent: "explorer",
									task: "produce schema",
									resultFormat: "structured-v2",
								},
								{
									id: "verification",
									agent: "explorer",
									task: "verify schema",
									dependsOn: ["implementation"],
									verifierFor: "implementation",
									resultFormat: "structured-v2",
								},
							],
						},
					},
					undefined,
					undefined,
					ctx,
				),
			/distinct agent/i,
		);
		assert.equal(existsSync(marker), false);

		await assert.rejects(
			() =>
				tool.execute(
					"cycle",
					{
						workflow: {
							tasks: [
								{ id: "a", agent: "explorer", task: "a", dependsOn: ["b"] },
								{ id: "b", agent: "explorer", task: "b", dependsOn: ["a"] },
							],
						},
					},
					undefined,
					undefined,
					ctx,
				),
			/cycle/i,
		);
		assert.equal(existsSync(marker), false);
	} finally {
		restorePiPackage();
		rmSync(root, { recursive: true, force: true });
	}
});

async function withVerificationGate(
	verifierTask: string,
	assertions: (result: Awaited<ReturnType<SubagentTool["execute"]>>) => Promise<void> | void,
): Promise<void> {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-verification-gate-"));
	const workspace = path.join(root, "workspace");
	mkdirSync(workspace);
	execFileSync("git", ["init", "-q", workspace]);
	execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
	execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
	writeFileSync(path.join(workspace, "tracked.txt"), "base\n");
	execFileSync("git", ["-C", workspace, "add", "tracked.txt"]);
	execFileSync("git", ["-C", workspace, "commit", "-qm", "initial"]);
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"import{writeFileSync}from'node:fs';",
			"import{join}from'node:path';",
			"const task=process.argv.at(-1)??'';",
			"const verifier=task.includes('verify accept')||task.includes('verify rework')||task.includes('verify reject')||task.includes('verify mutation')||task.includes('verify crash')||task.includes('verify timeout');",
			"if(task.includes('verify mutation'))writeFileSync(join(process.cwd(),'tracked.txt'),'mutated\\n');",
			"if(verifier&&task.includes('private-result-secret'))process.exit(9);",
			"if(task.includes('verify crash'))process.exit(2);",
			"if(task.includes('verify timeout'))await new Promise(resolve=>setTimeout(resolve,1000));",
			"let result;",
			"if(!verifier)result={version:'pi-subagents:result:v2',status:'completed',summary:'implementation <private>private-result-secret</private>',claims:[],artifacts:[{id:'patch',kind:'patch',version:'v1'}],changes:[],verification:[{status:'passed',summary:'worker self-check'}],limitations:[],unresolvedDependencies:[]};",
			"else if(task.includes('verify rework'))result={version:'pi-subagents:result:v2',status:'partial',reasonCode:'verification-rework',summary:'rework',claims:[],artifacts:[],changes:[],verification:[{status:'failed',summary:'regression remains'}],limitations:['fix regression'],unresolvedDependencies:[]};",
			"else if(task.includes('verify reject'))result={version:'pi-subagents:result:v2',status:'failed',reasonCode:'verification-rejected',summary:'reject',claims:[{claim:'broken',classification:'observed',evidence:['acceptance test failed']}],artifacts:[],changes:[],verification:[{status:'failed',summary:'acceptance test failed'}],limitations:[],unresolvedDependencies:[]};",
			"else result={version:'pi-subagents:result:v2',status:'completed',reasonCode:'verification-accepted',summary:'accept',claims:[],artifacts:[],changes:[],verification:[{status:'passed',summary:'acceptance test passed'}],limitations:[],unresolvedDependencies:[]};",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as SubagentTool;
		const { ctx } = createMockContext({ cwd: workspace, isProjectTrusted: () => true });
		const result = await tool.execute(
			`verification-${verifierTask}`,
			{
				workflow: {
					id: `wf-${verifierTask.replaceAll(" ", "-")}`,
					tasks: [
						{
							id: "implementation",
							agent: "worker",
							task: "implement feature",
							resultFormat: "structured-v2",
						},
						{
							id: "verification",
							agent: "reviewer",
							task: verifierTask,
							dependsOn: ["implementation"],
							verifierFor: "implementation",
							resultFormat: "structured-v2",
							...(verifierTask === "verify timeout" ? { timeoutMs: 50 } : {}),
						},
					],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		await assertions(result);
	} finally {
		restorePiPackage();
		rmSync(root, { recursive: true, force: true });
	}
}

test("workflow verification accepts an unchanged fresh verifier result", async () => {
	await withVerificationGate("verify accept", (result) => {
		assert.equal(result.isError, undefined);
		const producer = result.details?.workflow?.items.find((item) => item.id === "implementation");
		assert.equal(producer?.state, "completed");
		assert.equal(producer?.verificationAccepted, true);
		assert.equal(producer?.artifacts?.[0]?.verified, true);
		assert.equal(producer?.verificationReceipt?.decision, "accept");
		assert.equal(result.details?.metrics?.workerReportedVerification, 1);
		assert.equal(result.details?.metrics?.executorAcceptedVerification, 1);
	});
});

test("workflow verification requests producer rework", async () => {
	await withVerificationGate("verify rework", (result) => {
		assert.equal(result.isError, true);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.state,
			"blocked",
		);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "verification")?.state,
			"completed",
		);
		assert.equal(result.details?.metrics?.verificationRework, 1);
	});
});

test("workflow verification rejects producer output", async () => {
	await withVerificationGate("verify reject", (result) => {
		assert.equal(result.isError, true);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.state,
			"failed",
		);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "verification")?.state,
			"completed",
		);
	});
});

test("workflow verification rejects verifier mutation", async () => {
	await withVerificationGate("verify mutation", (result) => {
		assert.equal(result.isError, true);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.state,
			"failed",
		);
		assert.equal(result.details?.results[1]?.outcome?.reasonCode, "verification-tree-mismatch");
		assert.equal(result.details?.metrics?.verificationTreeMismatch, 1);
	});
});

test("workflow verification rejects a crashed verifier", async () => {
	await withVerificationGate("verify crash", (result) => {
		assert.equal(result.isError, true);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.state,
			"failed",
		);
		assert.equal(result.details?.results[1]?.outcome?.reasonCode, "verification-receipt-invalid");
	});
});

test("workflow verification rejects a timed-out verifier", async () => {
	await withVerificationGate("verify timeout", (result) => {
		assert.equal(result.isError, true);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.state,
			"failed",
		);
		assert.equal(result.details?.results[1]?.outcome?.reasonCode, "verification-receipt-invalid");
	});
});

test("workflow verification rejects a late verifier result after cancellation", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-verification-cancel-"));
	const workspace = path.join(root, "workspace");
	const started = path.join(root, "verifier-started");
	const completed = path.join(root, "verifier-completed");
	mkdirSync(workspace);
	execFileSync("git", ["init", "-q", workspace]);
	execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
	execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
	writeFileSync(path.join(workspace, "tracked.txt"), "base\n");
	execFileSync("git", ["-C", workspace, "add", "tracked.txt"]);
	execFileSync("git", ["-C", workspace, "commit", "-qm", "initial"]);
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"import{writeFileSync}from'node:fs';",
			"const task=process.argv.at(-1)??'';",
			"const verifier=task.includes('verify slowly');",
			`if(verifier)writeFileSync(${JSON.stringify(started)},'started');`,
			"const implementation={version:'pi-subagents:result:v2',status:'completed',summary:'implementation',claims:[],artifacts:[],changes:[],verification:[{status:'passed',summary:'self-check'}],limitations:[],unresolvedDependencies:[]};",
			"const accepted={version:'pi-subagents:result:v2',status:'completed',reasonCode:'verification-accepted',summary:'accept',claims:[],artifacts:[],changes:[],verification:[{status:'passed',summary:'passed'}],limitations:[],unresolvedDependencies:[]};",
			"const finish=()=>{if(verifier)writeFileSync(" +
				JSON.stringify(completed) +
				",'completed');const result=verifier?accepted:implementation;const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n')};",
			"if(verifier)setTimeout(finish,1000);else finish();",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as SubagentTool;
		const { ctx } = createMockContext({ cwd: workspace, isProjectTrusted: () => true });
		const controller = new AbortController();
		const running = tool.execute(
			"verification-cancel",
			{
				workflow: {
					id: "wf-verification-cancel",
					tasks: [
						{
							id: "implementation",
							agent: "worker",
							task: "implement",
							resultFormat: "structured-v2",
						},
						{
							id: "verification",
							agent: "reviewer",
							task: "verify slowly",
							dependsOn: ["implementation"],
							verifierFor: "implementation",
							resultFormat: "structured-v2",
						},
					],
				},
			},
			controller.signal,
			undefined,
			ctx,
		);
		for (let attempt = 0; attempt < 200 && !existsSync(started); attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(existsSync(started), true, "verifier readiness handshake was not observed");
		controller.abort();
		const result = await running;
		assert.equal(result.isError, true);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.state,
			"stale",
		);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")
				?.verificationAccepted,
			false,
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(existsSync(completed), false);
	} finally {
		restorePiPackage();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workflow retries are bounded and require an idempotent contract", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-retry-"));
	const marker = path.join(root, "launches");
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync,existsSync,readFileSync}from'node:fs';",
			`const marker=${JSON.stringify(marker)};`,
			"const prior=existsSync(marker)?readFileSync(marker,'utf8').trim().split('\\n').filter(Boolean).length:0;",
			"appendFileSync(marker,'launch\\n');",
			"if(prior===0)process.exit(1);",
			"const message={role:'assistant',content:[{type:'text',text:'done'}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as SubagentTool;
		const { ctx } = createMockContext();
		await assert.rejects(
			() =>
				tool.execute(
					"unsafe",
					{
						workflow: {
							tasks: [
								{
									id: "retry",
									agent: "explorer",
									task: "retry",
									retryPolicy: { maxAttempts: 2 },
								},
							],
						},
					},
					undefined,
					undefined,
					ctx,
				),
			/idempotent retry/i,
		);
		assert.equal(existsSync(marker), false);

		const result = await tool.execute(
			"safe",
			{
				workflow: {
					tasks: [
						{
							id: "retry",
							agent: "explorer",
							task: "retry",
							retryPolicy: { maxAttempts: 2 },
							contract: {
								version: "pi-subagents:delegation:v2",
								level: "minimal",
								taskId: "retry",
								objective: "retry safely",
								sideEffectPolicy: "idempotent",
							},
						},
					],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(result.isError, undefined);
		assert.equal(result.details?.results[0]?.attemptCount, 2);
		assert.equal(readFileSync(marker, "utf8").trim().split("\n").length, 2);
	} finally {
		restorePiPackage();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workflow hedging duplicates only an explicitly read-only task and cancels the loser", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-hedge-"));
	const marker = path.join(root, "launches");
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync}from'node:fs';",
			`appendFileSync(${JSON.stringify(marker)},'launch\\n');`,
			"setTimeout(()=>{const message={role:'assistant',content:[{type:'text',text:'done'}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n')},100);",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as SubagentTool;
		const { ctx } = createMockContext();
		const result = await tool.execute(
			"hedge",
			{
				workflow: {
					tasks: [
						{
							id: "hedge",
							agent: "explorer",
							task: "read only",
							hedgeAfterMs: 20,
							contract: {
								version: "pi-subagents:delegation:v2",
								level: "minimal",
								taskId: "hedge",
								objective: "read only",
								sideEffectPolicy: "read-only",
							},
						},
					],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(result.isError, undefined);
		assert.equal(result.details?.results[0]?.hedged, true);
		assert.equal(readFileSync(marker, "utf8").trim().split("\n").length, 2);
	} finally {
		restorePiPackage();
		rmSync(root, { recursive: true, force: true });
	}
});

type VerifiedExecutionOptions = {
	checkCode?: string;
	requiredEvidence?: string;
	writePaths?: readonly string[];
	checkArgs?: string[];
	command?: "git" | "node" | "sh";
	verifierAgent?: string;
};

type VerifiedExecutionFixture = {
	launches: string;
	verifierArgs: string;
	run: (
		scenario: string,
		options?: VerifiedExecutionOptions,
	) => ReturnType<SubagentTool["execute"]>;
};

async function withVerifiedExecution(
	assertions: (fixture: VerifiedExecutionFixture) => Promise<void>,
): Promise<void> {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-verified-execution-"));
	const workspace = path.join(root, "workspace");
	const launches = path.join(root, "launches");
	const verifierArgs = path.join(root, "verifier-args");
	mkdirSync(workspace);
	execFileSync("git", ["init", "-q", workspace]);
	execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
	execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
	writeFileSync(path.join(workspace, "feature.txt"), "base\n");
	execFileSync("git", ["-C", workspace, "add", "feature.txt"]);
	execFileSync("git", ["-C", workspace, "commit", "-qm", "initial"]);
	const fakePi = path.join(root, "fake-pi.mjs");
	writeFileSync(
		fakePi,
		[
			"import{appendFileSync,readFileSync,writeFileSync}from'node:fs';",
			`const launches=${JSON.stringify(launches)};appendFileSync(launches,'launch\\n');`,
			"const task=process.argv.at(-1)??'';const verifier=task.includes('fresh independent verifier');",
			`if(verifier)writeFileSync(${JSON.stringify(verifierArgs)},JSON.stringify(process.argv));`,
			"const feature=()=>readFileSync('feature.txt','utf8').trim();",
			"const rework=task.includes('scenario-rework');const reject=task.includes('scenario-rework-reject');",
			"if(!verifier){const repaired=task.includes('Repair the current submitted state');writeFileSync('feature.txt',repaired?'reworked\\n':task.includes('scenario-accept')?'accepted\\n':'initial\\n');}",
			"if(verifier&&task.includes('scenario-mutation'))writeFileSync('feature.txt','verifier-mutated\\n');",
			"let decision='accept';if(verifier&&rework&&feature()!=='reworked')decision='rework';else if(verifier&&reject)decision='reject';",
			"let result;if(!verifier)result={version:'pi-subagents:result:v2',status:'completed',summary:'worker self-report',claims:[],artifacts:[],changes:[],verification:[{status:'passed',summary:'worker self-check'}],limitations:[],unresolvedDependencies:[]};",
			"else if(decision==='rework')result={version:'pi-subagents:result:v2',status:'partial',reasonCode:'verification-rework',summary:'repair required',claims:[],artifacts:[],changes:[],verification:[{status:'failed',summary:'focused-test'}],limitations:['repair the feature'],unresolvedDependencies:[]};",
			"else if(decision==='reject')result={version:'pi-subagents:result:v2',status:'failed',reasonCode:'verification-rejected',summary:'reject state',claims:[{claim:'broken',classification:'observed',evidence:['focused-test']}],artifacts:[],changes:[],verification:[{status:'failed',summary:'focused-test'}],limitations:[],unresolvedDependencies:[]};",
			"else result={version:'pi-subagents:result:v2',status:'completed',reasonCode:'verification-accepted',summary:'accept state',claims:[],artifacts:[],changes:[],verification:[{status:'passed',summary:'focused-test'}],limitations:[],unresolvedDependencies:[]};",
			"const message={role:'assistant',content:[{type:'text',text:JSON.stringify(result)}],stopReason:'stop',timestamp:Date.now()};process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const restorePiPackage = useFakePiPackage(root, fakePi);
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const tool = mock.tools.find((candidate) => candidate.name === "subagent") as SubagentTool;
		const { ctx } = createMockContext({ cwd: workspace, isProjectTrusted: () => true });
		const run = async (scenario: string, options: VerifiedExecutionOptions = {}) => {
			execFileSync("git", ["-C", workspace, "reset", "--hard", "-q", "HEAD"]);
			return tool.execute(
				`verified-${scenario}`,
				{
					workflow: {
						id: `verified-${scenario}`,
						verifiedExecution: {
							verifierAgent: options.verifierAgent ?? "reviewer",
							maxReworkCycles: 1,
							checks: [
								{
									id: "focused-test",
									command: options.command ?? (options.checkCode ? "node" : "git"),
									args:
										options.checkArgs ??
										(options.checkCode ? ["-e", options.checkCode] : ["--version"]),
								},
							],
						},
						tasks: [
							{
								id: "implementation",
								agent: "worker",
								task: scenario,
								writePaths: options.writePaths ?? ["feature.txt"],
								acceptanceCriteria: ["feature is correct"],
								resultFormat: "structured-v2",
								contract: {
									version: "pi-subagents:delegation:v2",
									level: "full",
									taskId: "implementation",
									objective: scenario,
									requiredEvidence: [options.requiredEvidence ?? "focused-test"],
									sideEffectPolicy: "mutating",
								},
							},
						],
					},
				},
				undefined,
				undefined,
				ctx,
			);
		};

		await assertions({ launches, verifierArgs, run });
	} finally {
		restorePiPackage();
		rmSync(root, { recursive: true, force: true });
	}
}

test("verified execution accepts fresh evidence", async () => {
	await withVerifiedExecution(async ({ run, verifierArgs }) => {
		const result = await run("scenario-accept");
		assert.equal(result.isError, undefined);
		assert.equal(result.details?.workflow?.items[0]?.acceptanceState, "accepted");
		assert.equal(result.details?.workflow?.items[0]?.reworkCount, 0);
		for (const flag of [
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
		]) {
			assert.match(readFileSync(verifierArgs, "utf8"), new RegExp(flag));
		}
		assert.equal(
			inspectSessionWorkflows("test-session")
				.workflows.find((workflow) => workflow.workflowId === "verified-scenario-accept")
				?.items.find((item) => item.id === "implementation")?.acceptanceState,
			"accepted",
		);
	});
});

test("verified execution accepts one bounded rework cycle", async () => {
	await withVerifiedExecution(async ({ run }) => {
		const result = await run("scenario-rework-accept", {
			checkArgs: ["grep", "--no-index", "-q", "^reworked$", "--", "feature.txt"],
		});
		assert.equal(result.isError, undefined);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.reworkCount,
			1,
		);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.acceptanceState,
			"accepted",
		);
	});
});

test("verified execution rejects failed rework", async () => {
	await withVerifiedExecution(async ({ run }) => {
		const result = await run("scenario-rework-reject", {
			checkArgs: ["grep", "--no-index", "-q", "^reworked$", "--", "feature.txt"],
		});
		assert.equal(result.isError, true);
		assert.equal(
			result.details?.workflow?.items.find((item) => item.id === "implementation")?.acceptanceState,
			"rejected",
		);
	});
});

for (const [scenario, options] of [
	["scenario-mutation", {}],
	["scenario-check-failure", { checkCode: "process.exit(2)" }],
	["scenario-missing-evidence", { requiredEvidence: "missing-current-evidence" }],
	["scenario-scope-mismatch", { writePaths: ["other"] }],
] as const) {
	test(`verified execution rejects ${scenario}`, async () => {
		await withVerifiedExecution(async ({ run }) => {
			const result = await run(scenario, options);
			assert.equal(result.isError, true, scenario);
			assert.notEqual(
				result.details?.workflow?.items.find((item) => item.id === "implementation")
					?.acceptanceState,
				"accepted",
				scenario,
			);
		});
	});
}

test("verified execution rejects unsafe checks before child launch", async () => {
	await withVerifiedExecution(async ({ launches, run }) => {
		const launchesBefore = existsSync(launches)
			? readFileSync(launches, "utf8").trim().split("\n").length
			: 0;
		await assert.rejects(
			() => run("scenario-unsafe", { command: "sh" }),
			/unsafe verification command/i,
		);
		await assert.rejects(
			() => run("scenario-incapable-verifier", { verifierAgent: "explorer" }),
			/independent structured-v2 review capability/i,
		);
		const launchesAfter = existsSync(launches)
			? readFileSync(launches, "utf8").trim().split("\n").length
			: 0;
		assert.equal(launchesAfter, launchesBefore);
	});
});
