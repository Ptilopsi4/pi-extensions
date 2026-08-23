import assert from "node:assert/strict";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { test } from "vitest";
import todoWidgetExtension, {
	renderTodoWidget,
	sanitizeTodoText,
	TODO_DETAILS_VERSION,
	TOOL_NAME,
	type TodoDetails,
	type TodoItem,
	WIDGET_KEY,
} from "../src/todo-widget.js";

type Handler = (event: never, ctx: ExtensionContext) => unknown;
type WidgetFactory = (_tui: never, theme: Theme) => Component;

interface RegisteredTool {
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	execute(
		toolCallId: string,
		params: { items: TodoItem[] },
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	): Promise<{ content: Array<{ type: string; text: string }>; details: TodoDetails }>;
}

function createHarness() {
	const handlers = new Map<string, Handler[]>();
	let tool: RegisteredTool | undefined;
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool(definition: RegisteredTool) {
			tool = definition;
		},
	} as unknown as ExtensionAPI;
	todoWidgetExtension(pi);

	return {
		get tool(): RegisteredTool {
			assert.ok(tool);
			return tool;
		},
		async emit(event: string, ctx: ExtensionContext) {
			for (const handler of handlers.get(event) ?? []) await handler({} as never, ctx);
		},
	};
}

function createContext(options: { mode?: ExtensionContext["mode"]; branch?: SessionEntry[] } = {}) {
	const widgets: Array<{
		key: string;
		content: WidgetFactory | undefined;
		options: { placement: "aboveEditor" } | undefined;
	}> = [];
	const branch = options.branch ?? [];
	const sessionManager = {
		getBranch: () => branch,
	} as unknown as ExtensionContext["sessionManager"];
	const ctx = {
		mode: options.mode ?? "tui",
		hasUI: options.mode !== "print" && options.mode !== "json",
		sessionManager,
		ui: {
			setWidget(
				key: string,
				content: WidgetFactory | undefined,
				widgetOptions?: { placement: "aboveEditor" },
			) {
				widgets.push({ key, content, options: widgetOptions });
			},
		},
	} as unknown as ExtensionContext;
	return { branch, ctx, widgets };
}

function identityTheme() {
	const calls: Array<[string, string]> = [];
	const theme = {
		fg(role: string, text: string) {
			calls.push(["fg", role]);
			return text;
		},
		bold(text: string) {
			calls.push(["style", "bold"]);
			return text;
		},
		strikethrough(text: string) {
			calls.push(["style", "strikethrough"]);
			return text;
		},
	} as unknown as Theme;
	return { calls, theme };
}

function toolResultEntry(details: TodoDetails): SessionEntry {
	return {
		type: "message",
		id: "tool-result",
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: {
			role: "toolResult",
			toolCallId: "todo-call",
			toolName: TOOL_NAME,
			content: [{ type: "text", text: "updated" }],
			details,
			isError: false,
			timestamp: 0,
		},
	} as SessionEntry;
}

async function setTodos(
	harness: ReturnType<typeof createHarness>,
	ctx: ExtensionContext,
	items: TodoItem[],
) {
	return harness.tool.execute("todo-call", { items }, undefined, undefined, ctx);
}

test("registers concise guidance for using and maintaining the todo list", () => {
	const { tool } = createHarness();

	assert.equal(tool.label, "Todo List");
	assert.match(tool.description, /complete list on every call/u);
	assert.match(tool.promptSnippet, /multi-step work/u);
	assert.deepEqual(tool.promptGuidelines, [
		"Use todo_widget when work has multiple meaningful steps; skip it for simple, single-step tasks.",
		"Keep tasks concise and action-oriented. Mark one task in_progress before starting it, complete tasks promptly, and revise the list when the plan changes.",
		"Send the complete current list on every call, keep at most one task in_progress, and send an empty list when no tracked work remains.",
	]);
});

test("renders completed, current, and pending tasks with themed semantic symbols", () => {
	const { calls, theme } = identityTheme();
	const lines = renderTodoWidget(
		[
			{ text: "done", status: "completed" },
			{ text: "working", status: "in_progress" },
			{ text: "later", status: "pending" },
		],
		theme,
		80,
	);

	assert.deepEqual(lines, ["Todo · 1/3 complete", "✓ done", "▶ working", "○ later"]);
	assert.ok(calls.some(([kind, role]) => kind === "fg" && role === "success"));
	assert.ok(calls.some(([kind, role]) => kind === "fg" && role === "accent"));
	assert.ok(calls.some(([kind, role]) => kind === "fg" && role === "dim"));
	assert.ok(calls.some(([kind, role]) => kind === "style" && role === "bold"));
	assert.ok(calls.some(([kind, role]) => kind === "style" && role === "strikethrough"));
});

test("sanitizes terminal and bidi controls and bounds every rendered line", () => {
	const hostile = "safe\u001b]8;;https://evil\u0007link\u001b]8;;\u0007\n界界\u202e";
	assert.equal(sanitizeTodoText(hostile), "safelink 界界");

	const { theme } = identityTheme();
	const lines = renderTodoWidget([{ text: hostile, status: "in_progress" }], theme, 6);
	for (const line of lines) assert.ok(visibleWidth(line) <= 6);
	const unsafeSequences = [
		`${String.fromCharCode(0x1b)}]`,
		String.fromCharCode(0x07),
		String.fromCodePoint(0x202e),
	];
	assert.equal(
		lines.some((line) => unsafeSequences.some((sequence) => line.includes(sequence))),
		false,
	);
});

test("tool replaces the complete list, updates the widget, clears it, and rejects invalid state", async () => {
	const harness = createHarness();
	const current = createContext();
	await harness.emit("session_start", current.ctx);

	const cancelled = new AbortController();
	cancelled.abort();
	await assert.rejects(
		harness.tool.execute("todo-call", { items: [] }, cancelled.signal, undefined, current.ctx),
		/aborted/iu,
	);

	const result = await setTodos(harness, current.ctx, [
		{ text: "task 1", status: "completed" },
		{ text: "task 2", status: "in_progress" },
		{ text: "task 3", status: "pending" },
	]);
	assert.equal(result.content[0]?.text, "Todo list updated: 1 of 3 complete; 1 in progress.");
	assert.deepEqual(result.details, {
		version: TODO_DETAILS_VERSION,
		items: [
			{ text: "task 1", status: "completed" },
			{ text: "task 2", status: "in_progress" },
			{ text: "task 3", status: "pending" },
		],
	});

	const widget = current.widgets.at(-1);
	assert.equal(widget?.key, WIDGET_KEY);
	assert.deepEqual(widget?.options, { placement: "aboveEditor" });
	assert.equal(typeof widget?.content, "function");
	const { theme } = identityTheme();
	assert.deepEqual(widget?.content?.(undefined as never, theme).render(80), [
		"Todo · 1/3 complete",
		"✓ task 1",
		"▶ task 2",
		"○ task 3",
	]);

	await assert.rejects(
		setTodos(harness, current.ctx, [
			{ text: "one", status: "in_progress" },
			{ text: "two", status: "in_progress" },
		]),
		/at most one in_progress/u,
	);
	await assert.rejects(
		setTodos(harness, current.ctx, [{ text: " \n ", status: "pending" }]),
		/non-whitespace text/u,
	);

	const cleared = await setTodos(harness, current.ctx, []);
	assert.equal(cleared.content[0]?.text, "Todo list cleared.");
	assert.deepEqual(current.widgets.at(-1), {
		key: WIDGET_KEY,
		content: undefined,
		options: undefined,
	});
});

test("restores branch-local state on startup and tree navigation", async () => {
	const initial: TodoDetails = {
		version: TODO_DETAILS_VERSION,
		items: [{ text: "restored", status: "in_progress" }],
	};
	const harness = createHarness();
	const current = createContext({ branch: [toolResultEntry(initial)] });
	await harness.emit("session_start", current.ctx);

	const { theme } = identityTheme();
	assert.deepEqual(
		current.widgets
			.at(-1)
			?.content?.(undefined as never, theme)
			.render(80),
		["Todo · 0/1 complete", "▶ restored"],
	);

	current.branch.push(
		toolResultEntry({
			version: TODO_DETAILS_VERSION,
			items: [{ text: "finished branch", status: "completed" }],
		}),
	);
	await harness.emit("session_tree", current.ctx);
	assert.deepEqual(
		current.widgets
			.at(-1)
			?.content?.(undefined as never, theme)
			.render(80),
		["Todo · 1/1 complete", "✓ finished branch"],
	);
});

test("guards component widgets to TUI mode and ignores stale session shutdown", async () => {
	const harness = createHarness();
	const previous = createContext();
	const current = createContext();
	await harness.emit("session_start", previous.ctx);
	await setTodos(harness, previous.ctx, [{ text: "old", status: "in_progress" }]);
	await harness.emit("session_start", current.ctx);
	await setTodos(harness, current.ctx, [{ text: "current", status: "in_progress" }]);
	const currentWidgetCount = current.widgets.length;

	await harness.emit("session_shutdown", previous.ctx);
	assert.equal(current.widgets.length, currentWidgetCount);
	await assert.rejects(
		setTodos(harness, previous.ctx, [{ text: "stale", status: "pending" }]),
		/session changed/u,
	);

	await harness.emit("session_shutdown", current.ctx);
	assert.deepEqual(current.widgets.at(-1), {
		key: WIDGET_KEY,
		content: undefined,
		options: undefined,
	});

	const rpcHarness = createHarness();
	const rpc = createContext({ mode: "rpc" });
	await rpcHarness.emit("session_start", rpc.ctx);
	const result = await setTodos(rpcHarness, rpc.ctx, [{ text: "headless", status: "in_progress" }]);
	assert.equal(result.details.items[0]?.text, "headless");
	assert.equal(rpc.widgets.length, 0);
});
