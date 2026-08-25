import assert from "node:assert/strict";
import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import todoWidgetExtension, {
	reconcileTodoContext,
	TOOL_NAME,
	type TodoItem,
} from "../src/todo-widget.js";

interface RegisteredTool {
	name: string;
	description: string;
	parameters: unknown;
	constrainedSampling?: boolean;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

function registeredTodoTool(): RegisteredTool {
	let tool: RegisteredTool | undefined;
	const pi = {
		registerTool(definition: RegisteredTool) {
			tool = definition;
		},
		on() {},
	} as unknown as ExtensionAPI;
	todoWidgetExtension(pi);
	assert.ok(tool);
	return tool;
}

function normalizedRequest(messages: ContextEvent["messages"]) {
	const tool = registeredTodoTool();
	return {
		effectiveSystemGuidance: [tool.promptSnippet, ...(tool.promptGuidelines ?? [])].filter(
			(value): value is string => typeof value === "string",
		),
		activeToolNames: [tool.name],
		toolDefinitions: [
			{
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				constrainedSampling: tool.constrainedSampling,
			},
		],
		messages: convertToLlm(messages),
	};
}

function userMessage(text: string): ContextEvent["messages"][number] {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: 0,
	};
}

function assistantMessage(text: string): ContextEvent["messages"][number] {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "cache-contract",
		model: "cache-contract",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

test("todo compaction restoration preserves normalized ordinary-request prefixes", () => {
	const items: TodoItem[] = [
		{ text: "inspect", status: "completed" },
		{ text: "implement", status: "in_progress" },
	];
	const summaries: ContextEvent["messages"] = [
		{
			role: "compactionSummary",
			summary: "Earlier work was compacted.",
			tokensBefore: 100,
			timestamp: 0,
		},
		{
			role: "branchSummary",
			summary: "Retained branch state.",
			fromId: "branch-start",
			timestamp: 0,
		},
	];
	const firstRaw = [...summaries, userMessage("continue")];
	const first = normalizedRequest(reconcileTodoContext(firstRaw, items));
	const secondRaw = [...firstRaw, assistantMessage("working"), userMessage("continue again")];
	const second = normalizedRequest(reconcileTodoContext(secondRaw, items));

	assert.deepEqual(second.effectiveSystemGuidance, first.effectiveSystemGuidance);
	assert.deepEqual(second.activeToolNames, [TOOL_NAME]);
	assert.deepEqual(second.activeToolNames, first.activeToolNames);
	assert.deepEqual(second.toolDefinitions, first.toolDefinitions);
	assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);

	const transformed = reconcileTodoContext(firstRaw, items);
	assert.equal(reconcileTodoContext(transformed, items), transformed);
});
