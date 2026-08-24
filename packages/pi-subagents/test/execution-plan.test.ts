import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeDelegationContract } from "../src/delegation-contract.js";
import {
	acknowledgeExecutionPlan,
	createExecutionPlan,
	isExecutionPlan,
	resolveContractTools,
	rotateExecutionPlanGeneration,
} from "../src/execution-plan.js";

const target = {
	cwd: "/workspace",
	boundary: "current-workspace" as const,
	trust: { kind: "session-trusted" as const, projectTrusted: true },
};

test("audit execution plan reports capability mismatch, tool overgrant, and unsupported guarantees", () => {
	const contract = normalizeDelegationContract({
		version: "pi-subagents:delegation:v2",
		level: "full",
		taskId: "task-1",
		objective: "Review the repository",
		requestedAuthority: {
			capabilities: ["repository-review", "security-review"],
			tools: ["read", "grep"],
			network: "denied",
		},
	});
	assert.ok(contract);
	const plan = createExecutionPlan({
		contract,
		agent: {
			name: "reviewer",
			description: "review",
			systemPrompt: "private",
			source: "user",
			filePath: "user:reviewer",
			tools: ["read", "grep", "bash"],
			capabilityManifest: {
				version: "pi-subagents:capabilities:v1",
				capabilities: ["repository-review"],
				modalities: ["text"],
				resultFormats: ["structured-v2"],
				verificationRoles: [],
				limitations: [],
			},
		},
		effectiveTools: ["read", "grep", "bash"],
		target,
		workspaceMode: "shared",
		transport: "subprocess",
		resultFormat: "structured-v2",
	});
	assert.equal(plan.capabilityFit, "mismatch");
	assert.deepEqual(plan.missingCapabilities, ["security-review"]);
	assert.deepEqual(plan.overgrantedTools, ["bash"]);
	assert.ok(plan.unsupportedGuarantees.includes("network-denial"));
	assert.equal(plan.mode, "audit");
	assert.match(plan.id, /^[a-f0-9]{64}$/);
	assert.equal(plan.taskGeneration, 0);
	assert.equal(plan.admission.auditOnly, true);
});

test("execution plans record deterministic admission and rotate cancellation generations", () => {
	const contract = normalizeDelegationContract({
		version: "pi-subagents:delegation:v2",
		level: "full",
		taskId: "task-admission",
		objective: "Inspect",
		admission: {
			contextPressure: "high",
			independentWorkItems: 1,
			coupling: "dense",
			verificationRequired: false,
			verificationAvailable: true,
			budgetAllowsChildren: true,
			requirementsComplete: true,
		},
	});
	assert.ok(contract);
	const plan = createExecutionPlan({
		contract,
		agent: {
			name: "explorer",
			description: "explorer",
			systemPrompt: "private",
			source: "built-in",
			filePath: "built-in:explorer",
			capabilityManifest: {
				version: "pi-subagents:capabilities:v1",
				capabilities: ["repository-search"],
				modalities: ["text"],
				resultFormats: ["text"],
				verificationRoles: [],
				limitations: [],
			},
		},
		target,
		workspaceMode: "shared",
		transport: "subprocess",
		resultFormat: "text",
		taskGeneration: 4,
	});
	assert.equal(plan.admission.recommendation, "one-child");
	const rotated = rotateExecutionPlanGeneration(plan);
	assert.equal(rotated.taskGeneration, 5);
	assert.deepEqual(rotated.cancellationLineage, [plan.id]);
	assert.notEqual(rotated.id, plan.id);
	assert.equal(isExecutionPlan(plan), true);
	const { id: _id, ...identityRemoved } = plan;
	assert.equal(isExecutionPlan(identityRemoved), false);
	assert.equal(isExecutionPlan({ ...plan, effectiveTools: ["bash"] }), false);
});

test("enforced execution plans narrow tools and reject unknown or unsupported guarantees", () => {
	const contract = normalizeDelegationContract({
		version: "pi-subagents:delegation:v2",
		level: "full",
		taskId: "task-2",
		objective: "Inspect",
		requestedAuthority: {
			capabilities: ["repository-search"],
			tools: ["read"],
		},
		enforcement: "enforce",
	});
	assert.ok(contract);
	assert.deepEqual(resolveContractTools(["read", "grep", "bash"], contract), ["read"]);
	assert.deepEqual(resolveContractTools(undefined, contract), ["read"]);
	const noTools = normalizeDelegationContract({
		...contract,
		requestedAuthority: { ...contract.requestedAuthority, tools: [] },
	});
	assert.ok(noTools);
	assert.deepEqual(resolveContractTools(["read", "grep", "bash"], noTools), []);
	const unavailableDefaultTool = normalizeDelegationContract({
		...contract,
		requestedAuthority: { ...contract.requestedAuthority, tools: ["grep"] },
	});
	assert.ok(unavailableDefaultTool);
	assert.deepEqual(resolveContractTools(undefined, unavailableDefaultTool), []);
	const plan = createExecutionPlan({
		contract,
		agent: {
			name: "explorer",
			description: "explorer",
			systemPrompt: "private",
			source: "built-in",
			filePath: "built-in:explorer",
			tools: ["read", "grep", "bash"],
			capabilityManifest: {
				version: "pi-subagents:capabilities:v1",
				capabilities: ["repository-search"],
				modalities: ["text"],
				resultFormats: ["structured-v2"],
				verificationRoles: [],
				limitations: [],
			},
		},
		effectiveTools: resolveContractTools(["read", "grep", "bash"], contract),
		target,
		workspaceMode: "shared",
		transport: "subprocess",
		resultFormat: "structured-v2",
	});
	assert.deepEqual(acknowledgeExecutionPlan(plan), {
		version: "pi-subagents:acknowledgement:v1",
		status: "accepted",
		reasonCodes: [],
		recoveryActions: [],
	});
	const unknown = createExecutionPlan({
		contract,
		agent: {
			name: "custom",
			description: "custom",
			systemPrompt: "private",
			source: "user",
			filePath: "private",
		},
		effectiveTools: ["read"],
		target,
		workspaceMode: "shared",
		transport: "subprocess",
		resultFormat: "structured-v2",
	});
	assert.equal(acknowledgeExecutionPlan(unknown).status, "rejected");
	assert.ok(acknowledgeExecutionPlan(unknown).reasonCodes.includes("capabilities-unknown"));

	const unsupportedContract = normalizeDelegationContract({
		...contract,
		requestedAuthority: {
			...contract.requestedAuthority,
			readPaths: ["packages/pi-subagents/src"],
			network: "denied",
		},
	});
	assert.ok(unsupportedContract);
	const unsupported = createExecutionPlan({
		contract: unsupportedContract,
		agent: {
			name: "explorer",
			description: "explorer",
			systemPrompt: "private",
			source: "built-in",
			filePath: "built-in:explorer",
			tools: ["read", "grep"],
			capabilityManifest: {
				version: "pi-subagents:capabilities:v1",
				capabilities: ["repository-search"],
				modalities: ["text"],
				resultFormats: ["structured-v2"],
				verificationRoles: [],
				limitations: [],
			},
		},
		effectiveTools: ["read"],
		target,
		workspaceMode: "shared",
		transport: "subprocess",
		resultFormat: "structured-v2",
	});
	assert.deepEqual(acknowledgeExecutionPlan(unsupported), {
		version: "pi-subagents:acknowledgement:v1",
		status: "rejected",
		reasonCodes: ["unsupported-guarantee"],
		recoveryActions: ["repair-contract", "stop"],
	});
	assert.equal(unsupported.mode, "enforce");
	assert.deepEqual(unsupported.unsupportedGuarantees, ["read-path-scope", "network-denial"]);
});

test("execution plan treats absent manifest as unknown rather than unrestricted", () => {
	const plan = createExecutionPlan({
		agent: {
			name: "custom",
			description: "custom",
			systemPrompt: "private",
			source: "user",
			filePath: "/private/agent.md",
		},
		effectiveTools: undefined,
		target,
		workspaceMode: "shared",
		transport: "subprocess",
		resultFormat: "text",
	});
	assert.equal(plan.capabilityFit, "unknown");
	assert.equal(plan.agent.source, "user");
	assert.equal("systemPrompt" in plan.agent, false);
	assert.equal("filePath" in plan.agent, false);
});
