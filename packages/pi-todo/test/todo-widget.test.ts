import assert from "node:assert/strict";
import type {
	ContextEvent,
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
	TODO_CONTEXT_MESSAGE_TYPE,
	TODO_CONTEXT_VERSION,
	TODO_DETAILS_VERSION,
	TOOL_NAME,
	type TodoDetails,
	type TodoItem,
	WIDGET_KEY,
} from "../src/todo-widget.js";

type Handler = (event: never, ctx: ExtensionContext) => unknown;
type WidgetFactory = (_tui: never, theme: Theme) => Component;

interface RegisteredTool {
	name: string;
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
		async context(messages: ContextEvent["messages"], ctx: ExtensionContext) {
			let current = messages;
			for (const handler of handlers.get("context") ?? []) {
				const result = (await handler({ messages: current } as never, ctx)) as
					| { messages?: ContextEvent["messages"] }
					| undefined;
				current = result?.messages ?? current;
			}
			return current;
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

function todoToolResultMessage(
	details: TodoDetails,
	toolName = TOOL_NAME,
	isError = false,
): ContextEvent["messages"][number] {
	return {
		role: "toolResult",
		toolCallId: "todo-call",
		toolName,
		content: [{ type: "text", text: "updated" }],
		details,
		isError,
		timestamp: 0,
	};
}

function todoToolCallMessage(
	items: unknown,
	toolName = TOOL_NAME,
): ContextEvent["messages"][number] {
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "todo-call",
				name: toolName,
				arguments: { items },
			},
		],
		api: "openai-responses",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 0,
	};
}

function toolResultEntry(details: TodoDetails, toolName = TOOL_NAME): SessionEntry {
	return {
		type: "message",
		id: "tool-result",
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: todoToolResultMessage(details, toolName),
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

	assert.equal(tool.name, "update_todo_list");
	assert.equal(tool.label, "Todo List");
	assert.match(tool.description, /whenever actual task state changes/u);
	assert.match(tool.promptSnippet, /multi-step work progresses/u);
	assert.deepEqual(tool.promptGuidelines, [
		"Use update_todo_list to track work with multiple meaningful steps; skip it for simple, single-step tasks.",
		"Use update_todo_list to keep the list aligned with actual work: mark a task in_progress before starting it, mark it completed as soon as it finishes, and revise the list before continuing when the plan changes.",
		"Before a progress report or final response, call update_todo_list to reconcile every item with actual work; do not report completion while the list is stale.",
		"On every update_todo_list call, send the complete current list, keep at most one task in_progress, and send an empty list when no tracked work remains.",
	]);
});

test("uses visible todo calls and injects only missing current state", async () => {
	const harness = createHarness();
	const current = createContext();
	await harness.emit("session_start", current.ctx);
	const items: TodoItem[] = [
		{ text: "inspect", status: "completed" },
		{ text: "implement", status: "in_progress" },
	];
	await setTodos(harness, current.ctx, items);

	const base: ContextEvent["messages"] = [
		{
			role: "compactionSummary",
			summary: "Earlier work was compacted.",
			tokensBefore: 100,
			timestamp: 0,
		},
	];
	const transformed = await harness.context(base, current.ctx);
	assert.equal(transformed.length, 2);
	const reminder = transformed.at(-1);
	assert.equal(reminder?.role, "custom");
	if (reminder?.role !== "custom") assert.fail("Expected a custom todo reminder");
	assert.equal(reminder.customType, TODO_CONTEXT_MESSAGE_TYPE);
	assert.equal(reminder.display, false);
	assert.deepEqual(reminder.details, { version: TODO_CONTEXT_VERSION });
	assert.equal(
		reminder.content,
		`[PI TODO STATUS v${TODO_CONTEXT_VERSION}]\nCurrent todo list as JSON data:\n${JSON.stringify(items)}`,
	);
	assert.doesNotMatch(reminder.content as string, /call update_todo_list/u);

	const unchanged = await harness.context(transformed, current.ctx);
	assert.equal(unchanged, transformed);

	for (const toolName of [TOOL_NAME, "todo_widget"]) {
		const details: TodoDetails = { version: TODO_DETAILS_VERSION, items };
		const visible = [
			...base,
			todoToolCallMessage(items, toolName),
			todoToolResultMessage(details, toolName),
		];
		assert.equal(await harness.context(visible, current.ctx), visible);
	}

	const details: TodoDetails = { version: TODO_DETAILS_VERSION, items };
	const incompleteContexts = [
		[...base, todoToolCallMessage("invalid")],
		[...base, todoToolCallMessage([{ text: "stale", status: "pending" }])],
		[...base, todoToolCallMessage(items)],
		[...base, todoToolResultMessage(details)],
		[...base, todoToolCallMessage(items), todoToolResultMessage(details, TOOL_NAME, true)],
	];
	for (const incomplete of incompleteContexts) {
		const fallback = await harness.context(incomplete, current.ctx);
		const reminders = fallback.filter(
			(message) => message.role === "custom" && message.customType === TODO_CONTEXT_MESSAGE_TYPE,
		);
		assert.equal(reminders.length, 1);
		const fallbackReminder = reminders[0];
		assert.equal(fallbackReminder?.role, "custom");
		if (fallbackReminder?.role !== "custom") assert.fail("Expected a custom todo reminder");
		assert.equal(fallbackReminder.content, reminder.content);
	}

	const replacementItems: TodoItem[] = [{ text: "implement", status: "completed" }];
	await setTodos(harness, current.ctx, replacementItems);
	const replacementDetails: TodoDetails = {
		version: TODO_DETAILS_VERSION,
		items: replacementItems,
	};
	const replacement = [
		...transformed,
		todoToolCallMessage(replacementItems),
		todoToolResultMessage(replacementDetails),
	];
	assert.deepEqual(
		await harness.context(replacement, current.ctx),
		replacement.filter(
			(message) => message.role !== "custom" || message.customType !== TODO_CONTEXT_MESSAGE_TYPE,
		),
	);

	await setTodos(harness, current.ctx, []);
	assert.deepEqual(await harness.context(transformed, current.ctx), base);
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

	assert.deepEqual(lines, [
		"─".repeat(80),
		"Todo · 1/3 complete",
		"✓ done",
		"▶ working",
		"○ later",
	]);
	assert.ok(calls.some(([kind, role]) => kind === "fg" && role === "borderMuted"));
	assert.ok(calls.some(([kind, role]) => kind === "fg" && role === "success"));
	assert.ok(calls.some(([kind, role]) => kind === "fg" && role === "accent"));
	assert.ok(calls.some(([kind, role]) => kind === "fg" && role === "dim"));
	assert.ok(calls.some(([kind, role]) => kind === "style" && role === "bold"));
	assert.ok(calls.some(([kind, role]) => kind === "style" && role === "strikethrough"));
});

test("wraps task text with hanging indentation at narrow widths", () => {
	const { theme } = identityTheme();
	const wrappedWords = renderTodoWidget(
		[{ text: "alpha beta gamma", status: "in_progress" }],
		theme,
		10,
	);
	assert.deepEqual(wrappedWords.slice(2), ["▶ alpha", "  beta", "  gamma"]);

	const wrappedCjk = renderTodoWidget([{ text: "界界界", status: "pending" }], theme, 6);
	assert.deepEqual(wrappedCjk.slice(2), ["○ 界界", "  界"]);

	for (const width of [0, 1, 2]) {
		const lines = renderTodoWidget(
			[{ text: "hidden until enough room", status: "completed" }],
			theme,
			width,
		);
		for (const line of lines) assert.ok(visibleWidth(line) <= width);
	}
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
		"─".repeat(80),
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

test("restores current and legacy branch-local state on startup and tree navigation", async () => {
	const initial: TodoDetails = {
		version: TODO_DETAILS_VERSION,
		items: [{ text: "restored", status: "in_progress" }],
	};
	const harness = createHarness();
	const current = createContext({ branch: [toolResultEntry(initial, "todo_widget")] });
	await harness.emit("session_start", current.ctx);

	const { theme } = identityTheme();
	assert.deepEqual(
		current.widgets
			.at(-1)
			?.content?.(undefined as never, theme)
			.render(80),
		["─".repeat(80), "Todo · 0/1 complete", "▶ restored"],
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
		["─".repeat(80), "Todo · 1/1 complete", "✓ finished branch"],
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
	const staleMessages = [
		{ role: "user" as const, content: [{ type: "text" as const, text: "old" }], timestamp: 0 },
	];
	assert.equal(await harness.context(staleMessages, previous.ctx), staleMessages);

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
