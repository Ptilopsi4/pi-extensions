import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import subagents from "../src/subagents-extension.js";

test("ordinary bounded requests keep ordered provider-visible tool definitions stable", async () => {
	const mock = createMockPi();
	subagents(mock.pi, {
		runChild: async () => ({
			state: "completed",
			result: "done",
			limitations: [],
			truncated: false,
		}),
	});
	mock.rawPi.setActiveTools(mock.tools.map((tool) => String(tool.name)));
	const context = createMockContext({
		model: { provider: "test", id: "model" },
		thinkingLevel: "medium",
		modelRegistry: {
			getRegisteredProviderIds: () => [],
			getProviderAuthStatus: () => ({ configured: true, source: "environment" as const }),
		},
	});
	const before = normalizedDefinitions(mock);
	await emit(mock, "session_start", { reason: "startup" }, context.ctx);
	const inspect = mock.tools.find((tool) => tool.name === "subagent_inspect") as {
		execute: (...args: unknown[]) => Promise<unknown>;
	};
	await inspect.execute("first", {}, undefined, undefined, context.ctx);
	await inspect.execute("second", {}, undefined, undefined, context.ctx);
	assert.deepEqual(normalizedDefinitions(mock), before);
	assert.deepEqual(mock.rawPi.getActiveTools(), [
		"subagent_spawn",
		"subagent_await",
		"subagent_cancel",
		"subagent_inspect",
	]);
	assert.equal(new Set(mock.rawPi.getActiveTools()).size, 4);
	assert.deepEqual([...mock.events.keys()].sort(), ["session_shutdown", "session_start"]);
	await emit(mock, "session_shutdown", { reason: "quit" }, context.ctx);
});

function normalizedDefinitions(mock: ReturnType<typeof createMockPi>) {
	return mock.tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		constrainedSampling: tool.constrainedSampling,
		promptSnippet: tool.promptSnippet,
		promptGuidelines: tool.promptGuidelines,
	}));
}

async function emit(
	mock: ReturnType<typeof createMockPi>,
	event: string,
	payload: unknown,
	ctx: ExtensionContext,
) {
	for (const handler of mock.events.get(event) ?? []) await handler(payload, ctx);
}
