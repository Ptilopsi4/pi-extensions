import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import { createMockPi } from "../../../test/support.js";
import subagents from "../src/subagents.js";
import { installSubagentsTestEnvironment } from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
afterAll(restoreTestEnvironment);

const LLAMA_CPP_MAX_REPETITION_THRESHOLD = 2_000;

test("subagent tool schemas avoid large nested string repetitions", () => {
	const mock = createMockPi();
	subagents(mock.pi);

	for (const toolName of ["subagent_spawn"]) {
		const tool = mock.tools.find((candidate) => candidate.name === toolName);
		assert.ok(tool, `missing ${toolName} tool`);
		assert.deepEqual(findUnsafeNestedStringBounds(tool.parameters), []);
	}
});

function findUnsafeNestedStringBounds(schema: unknown): string[] {
	const unsafe: string[] = [];
	visitSchema(schema, "$", 0, unsafe);
	return unsafe;
}

function visitSchema(schema: unknown, path: string, depth: number, unsafe: string[]): void {
	if (!isRecord(schema)) return;
	if (
		depth > 1 &&
		schema.type === "string" &&
		typeof schema.maxLength === "number" &&
		schema.maxLength >= LLAMA_CPP_MAX_REPETITION_THRESHOLD
	) {
		unsafe.push(`${path} (maxLength ${schema.maxLength})`);
	}
	if (isRecord(schema.properties)) {
		for (const [name, child] of Object.entries(schema.properties)) {
			visitSchema(child, `${path}.${name}`, depth + 1, unsafe);
		}
	}
	if (schema.items !== undefined) {
		if (Array.isArray(schema.items)) {
			schema.items.forEach((child, index) => {
				visitSchema(child, `${path}.items[${index}]`, depth + 1, unsafe);
			});
		} else {
			visitSchema(schema.items, `${path}.items`, depth + 1, unsafe);
		}
	}
	for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
		const children = schema[keyword];
		if (!Array.isArray(children)) continue;
		children.forEach((child, index) => {
			visitSchema(child, `${path}.${keyword}[${index}]`, depth, unsafe);
		});
	}
	if (Array.isArray(schema.prefixItems)) {
		schema.prefixItems.forEach((child, index) => {
			visitSchema(child, `${path}.prefixItems[${index}]`, depth + 1, unsafe);
		});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
