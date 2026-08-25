import assert from "node:assert/strict";
import { test } from "vitest";
import {
	appendDelegationContract,
	normalizeDelegationContract,
} from "../src/delegation-contract.js";

test("delegation contract normalizes bounded request semantics", () => {
	const contract = normalizeDelegationContract({
		version: "pi-subagents:delegation:v2",
		level: "full",
		taskId: "task-1",
		objective: "Update the parser",
		nonGoals: ["Do not publish"],
		dependencies: [{ taskId: "task-0", artifactId: "design", version: "v2" }],
		requiredInputs: ["design@v2"],
		requestedAuthority: {
			capabilities: ["typescript-implementation"],
			tools: ["read", "edit"],
			readPaths: ["src"],
			writePaths: ["src/parser.ts"],
			network: "denied",
			secrets: "denied",
		},
		acceptanceCriteria: ["Focused tests pass"],
		requiredEvidence: ["Changed paths", "Test output"],
		budget: { timeoutMs: 60_000, maxTurns: 10, maxToolCalls: 20 },
		enforcement: "audit",
	});
	assert.equal(contract?.taskId, "task-1");
	assert.equal(contract?.dependencies[0]?.artifactId, "design");
	assert.deepEqual(contract?.requestedAuthority?.tools, ["read", "edit"]);
	assert.equal(contract?.budget?.timeoutMs, 60_000);

	const oversizedItem = normalizeDelegationContract({
		version: "pi-subagents:delegation:v2",
		level: "minimal",
		taskId: "bounded-item",
		objective: "Bound the evidence",
		requiredEvidence: ["界".repeat(4_096)],
	});
	assert.ok(oversizedItem);
	assert.ok(Buffer.byteLength(oversizedItem.requiredEvidence[0] ?? "", "utf8") <= 4 * 1024);
});

test("delegation contract rejects malformed versions, duplicate identifiers, and invalid bounds", () => {
	assert.equal(
		normalizeDelegationContract({
			version: "pi-subagents:delegation:v3",
			level: "minimal",
			taskId: "x",
			objective: "x",
		}),
		undefined,
	);
	assert.equal(
		normalizeDelegationContract({
			version: "pi-subagents:delegation:v2",
			level: "minimal",
			taskId: "x",
			objective: "x",
			dependencies: [{ taskId: "same" }, { taskId: "same" }],
		}),
		undefined,
	);
	assert.equal(
		normalizeDelegationContract({
			version: "pi-subagents:delegation:v2",
			level: "minimal",
			taskId: "x",
			objective: "x",
			budget: { timeoutMs: 0 },
		}),
		undefined,
	);
	assert.equal(
		normalizeDelegationContract({
			version: "pi-subagents:delegation:v2",
			level: "minimal",
			taskId: "x",
			objective: "x",
			unknownFutureField: true,
		}),
		undefined,
	);
});

test("delegation contract prompt is bounded and labels requested authority as advisory", () => {
	const prompt = appendDelegationContract(
		"Implement the task",
		{
			version: "pi-subagents:delegation:v2",
			level: "minimal",
			taskId: "task-1",
			objective: "x".repeat(100_000),
			requestedAuthority: { writePaths: ["src/<private>secret</private>.ts"] },
		},
		50 * 1024,
	);
	assert.ok(Buffer.byteLength(prompt.text, "utf8") <= 50 * 1024);
	assert.equal(prompt.contract?.objective.length !== 0, true);
	assert.match(prompt.text, /requested authority is advisory/i);
	assert.doesNotMatch(prompt.text, /secret/);
});
