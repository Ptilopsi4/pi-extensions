import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import bashTimeout, { MAX_BASH_TIMEOUT_SECONDS } from "./index.js";

type ToolCallEvent = {
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
};

type ToolCallHandler = (event: ToolCallEvent) => unknown;

function createHarness(): ToolCallHandler {
	let toolCallHandler: ToolCallHandler | undefined;
	const pi = {
		on(event: string, handler: ToolCallHandler) {
			if (event === "tool_call") toolCallHandler = handler;
		},
	} as unknown as ExtensionAPI;
	bashTimeout(pi);
	assert.ok(toolCallHandler);
	return toolCallHandler;
}

test("adds the maximum timeout when bash omits one", () => {
	const handleToolCall = createHarness();
	const event: ToolCallEvent = {
		toolCallId: "bash-1",
		toolName: "bash",
		input: { command: "sleep 999" },
	};

	handleToolCall(event);

	assert.equal(event.input.timeout, MAX_BASH_TIMEOUT_SECONDS);
});

test("caps longer bash timeouts and preserves shorter ones", () => {
	const handleToolCall = createHarness();
	const longer = {
		toolCallId: "bash-1",
		toolName: "bash",
		input: { command: "sleep 999", timeout: 600 },
	};
	const shorter = {
		toolCallId: "bash-2",
		toolName: "bash",
		input: { command: "sleep 1", timeout: 10 },
	};

	handleToolCall(longer);
	handleToolCall(shorter);

	assert.equal(longer.input.timeout, MAX_BASH_TIMEOUT_SECONDS);
	assert.equal(shorter.input.timeout, 10);
});

test("ignores non-bash tools", () => {
	const handleToolCall = createHarness();
	const event = { toolCallId: "read-1", toolName: "read", input: { path: "README.md" } };

	handleToolCall(event);

	assert.deepEqual(event.input, { path: "README.md" });
});
