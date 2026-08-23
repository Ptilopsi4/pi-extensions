import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, test, vi } from "vitest";
import activeToolStatus, {
	ACTIVE_TOOL_REFRESH_INTERVAL_MS,
	formatActiveToolWidget,
	sanitizeToolName,
	WIDGET_KEY,
} from "./index.js";

type Handler = (event: never, ctx: ExtensionContext) => unknown;

afterEach(() => {
	vi.useRealTimers();
});

function createHarness(initialTools: string[] = []) {
	const handlers = new Map<string, Handler[]>();
	let activeTools = initialTools;
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		getActiveTools() {
			return [...activeTools];
		},
	} as unknown as ExtensionAPI;
	activeToolStatus(pi);

	return {
		setActiveTools(toolNames: string[]) {
			activeTools = toolNames;
		},
		async emit(event: string, payload: Record<string, unknown>, ctx: ExtensionContext) {
			for (const handler of handlers.get(event) ?? []) await handler(payload as never, ctx);
		},
	};
}

function createContext() {
	const widgets: Array<[string, string[] | undefined, { placement: "aboveEditor" } | undefined]> =
		[];
	const sessionManager = {} as ExtensionContext["sessionManager"];
	const ctx = {
		hasUI: true,
		isIdle: () => true,
		sessionManager,
		ui: {
			setWidget(
				key: string,
				content: string[] | undefined,
				options?: { placement: "aboveEditor" },
			) {
				widgets.push([key, content, options]);
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, widgets };
}

test("shows every active tool above the editor and refreshes when the set changes", async () => {
	vi.useFakeTimers();
	const harness = createHarness(["read", "bash"]);
	const current = createContext();
	await harness.emit("session_start", {}, current.ctx);
	assert.deepEqual(current.widgets.at(-1), [
		WIDGET_KEY,
		["Active tools (2)", "read · bash"],
		{ placement: "aboveEditor" },
	]);

	await vi.advanceTimersByTimeAsync(ACTIVE_TOOL_REFRESH_INTERVAL_MS);
	assert.equal(current.widgets.length, 1);

	harness.setActiveTools(["read", "edit", "write"]);
	await vi.advanceTimersByTimeAsync(ACTIVE_TOOL_REFRESH_INTERVAL_MS);
	assert.deepEqual(current.widgets.at(-1), [
		WIDGET_KEY,
		["Active tools (3)", "read · edit · write"],
		{ placement: "aboveEditor" },
	]);

	harness.setActiveTools(["read", "firecrawl_search"]);
	await harness.emit(
		"tool_execution_end",
		{ toolCallId: "loader", toolName: "firecrawl_load" },
		current.ctx,
	);
	assert.deepEqual(current.widgets.at(-1), [
		WIDGET_KEY,
		["Active tools (2)", "read · firecrawl_search"],
		{ placement: "aboveEditor" },
	]);

	await harness.emit("session_shutdown", {}, current.ctx);
	assert.deepEqual(current.widgets.at(-1), [WIDGET_KEY, undefined, undefined]);
});

test("session replacement ignores stale events and shutdown clears the owned widget", async () => {
	const harness = createHarness(["read"]);
	const previous = createContext();
	const current = createContext();
	await harness.emit("session_start", {}, previous.ctx);

	harness.setActiveTools(["edit"]);
	await harness.emit("session_start", {}, current.ctx);
	await harness.emit("before_agent_start", {}, previous.ctx);
	assert.deepEqual(current.widgets.at(-1), [
		WIDGET_KEY,
		["Active tool (1)", "edit"],
		{ placement: "aboveEditor" },
	]);

	await harness.emit("session_shutdown", {}, previous.ctx);
	assert.deepEqual(current.widgets.at(-1), [
		WIDGET_KEY,
		["Active tool (1)", "edit"],
		{ placement: "aboveEditor" },
	]);

	await harness.emit("session_shutdown", {}, current.ctx);
	assert.deepEqual(current.widgets.at(-1), [WIDGET_KEY, undefined, undefined]);
});

test("formats every tool as bounded safe display text", () => {
	assert.deepEqual(formatActiveToolWidget(["read", "bash", "edit", "write"]), [
		"Active tools (4)",
		"read · bash · edit · write",
	]);
	assert.deepEqual(formatActiveToolWidget(["read\n\u001b[31m"]), ["Active tool (1)", "read31m"]);
	assert.equal(sanitizeToolName("\u001b]8;;bad\u0007read\n\u202efile"), "8badreadfile");
	assert.equal(sanitizeToolName("\u001b\u0007"), "tool");
	assert.equal(sanitizeToolName("x".repeat(40)), `${"x".repeat(32)}…`);
});
