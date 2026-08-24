import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { registerSubagentInspect } from "../src/inspect.js";
import type { AgentRunInspectionDetail, AgentRunInspectionSummary } from "../src/registry.js";
import { resolveStatefulLimits } from "../src/stateful-limits.js";
import { WorkItemLedger } from "../src/work-item-ledger.js";
import { createSessionWorkItemPersistence } from "../src/work-item-persistence.js";

function runtime(
	options: {
		runs?: AgentRunInspectionSummary[];
		detail?: AgentRunInspectionDetail;
		blocking?: boolean;
		maxParallelTasks?: number;
	} = {},
) {
	return {
		getBlockingEnabled: () => options.blocking ?? true,
		getMaxParallelTasks: () => options.maxParallelTasks ?? 8,
		getConsultResourcePolicy: () => "project-context" as const,
		getConsultationCwdPolicy: () => "anywhere" as const,
		getDelegationCwdPolicy: () => "trusted-targets" as const,
		getRuntimeStatus: () => ({
			enabled: true,
			initialized: true,
			transport: "subprocess" as const,
			completionDelivery: "next-turn" as const,
			limits: resolveStatefulLimits(),
			activeAgents: 1,
			retainedAgents: 2,
		}),
		listRunInspection: () => options.runs ?? [],
		getRunInspection: (id: string) => (id === options.detail?.id ? options.detail : undefined),
	};
}

function registeredTool(mock: ReturnType<typeof createMockPi>) {
	const tool = mock.tools.find((candidate) => candidate.name === "subagent_inspect");
	assert.ok(tool);
	return tool as {
		label: string;
		description: string;
		parameters: {
			additionalProperties?: boolean;
			properties?: Record<string, { enum?: string[]; default?: unknown }>;
		};
		execute: (...args: unknown[]) => Promise<{
			content: Array<{ type: string; text: string }>;
			details: Record<string, unknown>;
		}>;
	};
}

async function execute(
	tool: ReturnType<typeof registeredTool>,
	params: Record<string, unknown>,
	ctx = createMockContext().ctx,
) {
	return tool.execute("inspect-1", params, undefined, undefined, ctx);
}

test("subagent_inspect registers one strict Google-compatible action schema", async () => {
	const mock = createMockPi();
	registerSubagentInspect(mock.pi, runtime());
	const tool = registeredTool(mock);
	assert.equal(tool.label, "Inspect Subagents");
	assert.match(tool.description, /without changing/i);
	assert.equal(tool.parameters.additionalProperties, false);
	assert.deepEqual(tool.parameters.properties?.action?.enum, [
		"list_agents",
		"get_agent",
		"list_runs",
		"get_run",
		"list_workflows",
		"get_workflow",
		"list_models",
		"preview_context",
		"status",
		"diagnose",
	]);
	assert.equal(tool.parameters.properties?.agentScope?.default, "user");

	await assert.rejects(
		() => execute(tool, { action: "status", limit: 1 }),
		/does not accept limit/,
	);
	await assert.rejects(() => execute(tool, { action: "get_agent" }), /requires agent/);
	await assert.rejects(() => execute(tool, { action: "get_run" }), /requires agentId/);
	await assert.rejects(
		() => execute(tool, { action: "list_models", limit: 101 }),
		/between 1 and 100/,
	);
	const preview = await execute(tool, { action: "preview_context", context: "none" });
	assert.deepEqual(preview.details.preview, {
		mode: "none",
		turns: 0,
		sourceCount: 0,
		bytes: 0,
		truncated: false,
	});
	await assert.rejects(
		() => execute(tool, { action: "preview_context", context: 0 }),
		/positive integer/,
	);
});

test("subagent_inspect reads persisted workflow evidence without exposing private text", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-inspect-workflow-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const ledger = WorkItemLedger.create({
			workflowId: "wf-inspect",
			items: [
				{
					id: "task",
					objective: "visible <private>secret</private>",
					dependencies: [],
				},
			],
		});
		ledger.start("task", "agent-task");
		await createSessionWorkItemPersistence("test-session", "wf-inspect").save(ledger.snapshot());
		const mock = createMockPi();
		registerSubagentInspect(mock.pi, runtime());
		const tool = registeredTool(mock);
		const listed = await execute(tool, { action: "list_workflows" });
		assert.equal(
			(listed.details.workflows as Array<{ workflowId: string }>)[0]?.workflowId,
			"wf-inspect",
		);
		const detail = await execute(tool, { action: "get_workflow", workflowId: "wf-inspect" });
		assert.equal(
			(detail.details.workflow as { items: Array<{ state: string }> }).items[0]?.state,
			"interrupted",
		);
		assert.doesNotMatch(JSON.stringify(detail), /secret/);

		const verified = WorkItemLedger.create({
			workflowId: "wf-verified",
			items: [
				{ id: "implementation", objective: "implement", dependencies: [] },
				{
					id: "verification",
					objective: "verify",
					dependencies: ["implementation"],
					verifierFor: "implementation",
				},
			],
		});
		const implementation = verified.start("implementation", "agent-worker");
		const tree = {
			version: "pi-subagents:workflow-tree:v1" as const,
			kind: "git-dirty" as const,
			digest: "c".repeat(64),
		};
		verified.stageForVerification("implementation", {
			taskGeneration: implementation.taskGeneration,
			executionPlanId: "a".repeat(64),
			treeIdentity: tree,
		});
		const verification = verified.start("verification", "agent-reviewer");
		verified.completeVerification("verification", {
			taskGeneration: verification.taskGeneration,
			executionPlanId: "b".repeat(64),
			receipt: {
				version: "pi-subagents:workflow-verification:v1",
				decision: "accept",
				targetTaskId: "implementation",
				targetTaskGeneration: implementation.taskGeneration,
				targetExecutionPlanId: "a".repeat(64),
				verifierTaskId: "verification",
				verifierTaskGeneration: verification.taskGeneration,
				verifierExecutionPlanId: "b".repeat(64),
				treeIdentity: tree,
				summary: "accepted receipt",
				evidence: ["bounded evidence"],
				limitations: [],
				createdAt: 123,
				truncated: false,
			},
		});
		await createSessionWorkItemPersistence("test-session", "wf-verified").save(verified.snapshot());
		const receiptDetail = await execute(tool, {
			action: "get_workflow",
			workflowId: "wf-verified",
		});
		const receiptItem = (
			receiptDetail.details.workflow as {
				items: Array<{
					verificationReceipt?: { decision: string; evidenceCount: number; summary: string };
				}>;
			}
		).items[0];
		assert.deepEqual(receiptItem?.verificationReceipt, {
			version: "pi-subagents:workflow-verification:v1",
			decision: "accept",
			targetTaskId: "implementation",
			targetTaskGeneration: 1,
			targetExecutionPlanId: "a".repeat(64),
			verifierTaskId: "verification",
			verifierTaskGeneration: 1,
			verifierExecutionPlanId: "b".repeat(64),
			treeIdentity: tree,
			summary: "accepted receipt",
			evidenceCount: 1,
			limitationCount: 0,
			createdAt: 123,
			truncated: false,
		});
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("subagent_inspect projects safe agent metadata and gates project discovery before reads", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-inspect-"));
	const agentDir = path.join(directory, "agent-home");
	const workspace = path.join(directory, "workspace");
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		mkdirSync(path.join(agentDir, "agents"), { recursive: true });
		mkdirSync(path.join(workspace, ".pi", "agents"), { recursive: true });
		writeFileSync(
			path.join(agentDir, "agents", "safe.md"),
			"---\nname: safe\ndescription: Safe agent\ntools: read, bash\n---\nSECRET_SYSTEM_PROMPT",
		);
		writeFileSync(
			path.join(workspace, ".pi", "agents", "project-\u001b[31m.md"),
			"---\nname: project\ndescription: Project agent\n---\nUNTRUSTED_PROMPT",
		);
		const mock = createMockPi();
		registerSubagentInspect(mock.pi, runtime());
		const tool = registeredTool(mock);
		const ctx = createMockContext({ cwd: workspace, isProjectTrusted: () => false }).ctx;
		const listed = await execute(tool, { action: "list_agents", limit: 100 }, ctx);
		assert.match(listed.content[0].text, /safe/);
		assert.doesNotMatch(JSON.stringify(listed), /SECRET_SYSTEM_PROMPT|UNTRUSTED_PROMPT/);

		const agent = await execute(tool, { action: "get_agent", agent: "safe" }, ctx);
		assert.deepEqual((agent.details.agent as { tools: string[] }).tools, ["read", "bash"]);
		assert.deepEqual((agent.details.agent as { consultTools: string[] }).consultTools, ["read"]);
		assert.match(String((agent.details.agent as { path: string }).path), /^~\//);
		assert.doesNotMatch(JSON.stringify(agent), /SECRET_SYSTEM_PROMPT/);

		await assert.rejects(
			() => execute(tool, { action: "list_agents", agentScope: "project" }, ctx),
			/trusted project/i,
		);
		const trusted = createMockContext({ cwd: workspace, isProjectTrusted: () => true }).ctx;
		const project = await execute(
			tool,
			{ action: "get_agent", agent: "project", agentScope: "project" },
			trusted,
		);
		const projectPath = (project.details.agent as { path: string }).path;
		assert.match(projectPath, /^\.pi\/agents\/project-/);
		assert.equal(projectPath.includes("\u001b"), false);
		assert.doesNotMatch(JSON.stringify(project), /UNTRUSTED_PROMPT/);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("subagent_inspect returns metadata-only run summaries", async () => {
	const summary: AgentRunInspectionSummary = {
		id: "sa_one",
		agent: "explorer",
		state: "running",
		createdAt: 1,
		updatedAt: 2,
		historyCount: 3,
		unreadMessages: 4,
		turnGeneration: 3,
		pendingCompletionCount: 1,
	};
	const detail: AgentRunInspectionDetail = {
		...summary,
		cwd: process.cwd(),
		thinkingLevel: "high",
		currentTask: "current task\u001b[31m",
		error: "bounded error",
		target: {
			cwd: process.cwd(),
			boundary: "external",
			trust: {
				kind: "saved-trusted",
				projectTrusted: true,
				sourcePath: process.cwd(),
			},
		},
		policy: { inherited: ["environment"], overridden: [], unsupported: [] },
		contextTurns: 2,
		contextBytes: 128,
		contextSources: 3,
		contextTruncated: false,
		resultFormat: "structured-v1",
		structuredResult: {
			version: "pi-subagents:result:v1",
			summary: "done",
			evidence: [],
			changes: [],
			verification: [],
			risks: [],
		},
		telemetry: {
			protocol: "pi-subagents:v1",
			transport: "rpc",
			phase: "settled",
			updatedAt: 3,
			timing: { queuedAt: 1, readyAt: 2, settledAt: 3 },
			model: "model-one",
			thinkingLevel: "high",
		},
	};
	const mock = createMockPi();
	registerSubagentInspect(mock.pi, runtime({ runs: [summary], detail }));
	const tool = registeredTool(mock);
	const listed = await execute(tool, { action: "list_runs" });
	assert.deepEqual(listed.details.runs, [summary]);
	assert.equal(JSON.stringify(listed).includes("current task"), false);
	const got = await execute(tool, { action: "get_run", agentId: "sa_one" });
	assert.match(String((got.details.run as { currentTask: string }).currentTask), /current task/);
	assert.equal(JSON.stringify(got).includes("\u001b"), false);
	assert.equal(
		(got.details.run as { target: { trust: { kind: string } } }).target.trust.kind,
		"saved-trusted",
	);
	const projected = got.details.run as {
		context: { turns: number; bytes: number; sources: number };
		telemetry: { protocol: string; transport: string };
		structuredResult: { summary: string };
	};
	assert.deepEqual(projected.context, { turns: 2, sources: 3, bytes: 128, truncated: false });
	assert.equal(projected.telemetry.protocol, "pi-subagents:v1");
	assert.equal(projected.telemetry.transport, "rpc");
	assert.equal(projected.structuredResult.summary, "done");
	await assert.rejects(
		() => execute(tool, { action: "get_run", agentId: "missing" }),
		/Unknown retained run/,
	);
});

test("subagent_inspect bounds list details as well as model-facing content", async () => {
	const runs: AgentRunInspectionSummary[] = Array.from({ length: 100 }, (_, index) => ({
		id: `sa_${index}_${"x".repeat(1_000)}`,
		agent: `agent_${index}_${"y".repeat(1_000)}`,
		state: "completed",
		createdAt: index,
		updatedAt: index,
		historyCount: index,
		unreadMessages: index,
		turnGeneration: index,
		pendingCompletionCount: index,
	}));
	const mock = createMockPi();
	registerSubagentInspect(mock.pi, runtime({ runs }));
	const result = await execute(registeredTool(mock), {
		action: "list_runs",
		includeClosed: true,
		limit: 100,
	});
	assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= 50 * 1024);
	assert.ok(Buffer.byteLength(JSON.stringify(result.details), "utf8") <= 50 * 1024);
	assert.ok((result.details.omitted as number) > 0);
});

test("subagent_inspect uses scoped model snapshots and structured diagnostics without auth calls", async () => {
	const model = {
		provider: "test-provider",
		id: "model-one",
		name: "Model One",
		api: "openai-responses",
		baseUrl: "https://secret.invalid/key",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 200,
		headers: { Authorization: "SECRET_TOKEN" },
	};
	const modelRegistry = {
		getAvailable: () => {
			throw new Error("scoped models should win");
		},
		refresh: () => {
			throw new Error("must not refresh");
		},
		getApiKeyAndHeaders: () => {
			throw new Error("must not resolve auth");
		},
	};
	const ctx = createMockContext({
		model,
		scopedModels: [{ model, thinkingLevel: "medium" }],
		modelRegistry,
	}).ctx;
	const mock = createMockPi();
	registerSubagentInspect(mock.pi, runtime({ blocking: false }));
	const tool = registeredTool(mock);
	const result = await execute(tool, { action: "list_models" }, ctx);
	assert.match(result.content[0].text, /model-one/);
	assert.doesNotMatch(JSON.stringify(result), /secret\.invalid|SECRET_TOKEN|headers|baseUrl/);
	assert.equal(
		(result.details.models as Array<{ thinkingLevel: string }>)[0].thinkingLevel,
		"medium",
	);

	const status = await execute(tool, { action: "status" }, ctx);
	const statusDetails = status.details.status as Record<string, unknown>;
	assert.equal(statusDetails.consultationCwdPolicy, "anywhere");
	assert.equal(statusDetails.delegationCwdPolicy, "trusted-targets");
	assert.equal(statusDetails.consultationCwdPolicySource, "default");
	assert.equal(statusDetails.delegationCwdPolicySource, "default");
	assert.equal(statusDetails.configuredWorkflowSource, "default");
	assert.equal(statusDetails.configuredCompletionDelivery, "next-turn");
	assert.equal(statusDetails.configuredCompletionDeliverySource, "default");
	assert.deepEqual(statusDetails.usageRecording, { enabled: false });
	assert.equal(statusDetails.configuredUsageRecording, false);
	assert.equal(statusDetails.configuredUsageRecordingSource, "default");
	assert.equal(statusDetails.maxParallelTasks, 8);
	assert.equal(statusDetails.configuredMaxParallelTasks, 8);
	assert.equal(statusDetails.configuredMaxParallelTasksSource, "default");
	assert.deepEqual(statusDetails.statefulLimits, resolveStatefulLimits());
	assert.deepEqual(statusDetails.configuredStatefulLimits, resolveStatefulLimits());
	assert.deepEqual(statusDetails.configuredStatefulLimitSources, {
		maxAgents: "default",
		maxActiveTurns: "default",
		maxChildrenPerAgent: "default",
		maxDepth: "default",
		maxStoredAgents: "default",
	});
	assert.doesNotMatch(JSON.stringify(status), /trust\.json/);

	const diagnosed = await execute(tool, { action: "diagnose" }, ctx);
	const checks = diagnosed.details.checks as Array<{ status: string }>;
	assert.ok(checks.length >= 5);
	assert.ok(checks.every((check) => ["pass", "warning", "fail"].includes(check.status)));
	assert.equal((diagnosed.details as { ok?: boolean }).ok, false);
});
