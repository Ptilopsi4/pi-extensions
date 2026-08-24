import { StringEnum } from "@earendil-works/pi-ai";
import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

export const TOOL_NAME = "todo_widget";
export const WIDGET_KEY = "todo";
export const TODO_CONTEXT_MESSAGE_TYPE = "todo-widget-status";
export const TODO_CONTEXT_VERSION = 1;
export const TODO_DETAILS_VERSION = 1;
export const MAX_TODO_ITEMS = 50;
export const MAX_TODO_TEXT_LENGTH = 300;

const WIDGET_OPTIONS = { placement: "aboveEditor" } as const;
const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
	text: string;
	status: TodoStatus;
}

export interface TodoDetails {
	version: typeof TODO_DETAILS_VERSION;
	items: TodoItem[];
}

const TodoParameters = Type.Object({
	items: Type.Array(
		Type.Object({
			text: Type.String({
				minLength: 1,
				maxLength: MAX_TODO_TEXT_LENGTH,
				description: "A concise, action-oriented task",
			}),
			status: StringEnum(TODO_STATUSES, {
				description: "The task's current status",
			}),
		}),
		{
			maxItems: MAX_TODO_ITEMS,
			description: "The complete current todo list; send an empty list to clear it",
		},
	),
});

export default function todoWidgetExtension(pi: ExtensionAPI): void {
	let activeSession: ExtensionContext["sessionManager"] | undefined;
	let items: TodoItem[] = [];

	const ownsSession = (ctx: ExtensionContext): boolean => ctx.sessionManager === activeSession;

	const publish = (ctx: ExtensionContext): void => {
		if (!ownsSession(ctx) || ctx.mode !== "tui") return;
		if (items.length === 0) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		const snapshot = cloneItems(items);
		ctx.ui.setWidget(
			WIDGET_KEY,
			(_tui, theme) => ({
				render: (width) => renderTodoWidget(snapshot, theme, width),
				invalidate: () => {},
			}),
			WIDGET_OPTIONS,
		);
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo List",
		description:
			"Replace the current session todo list. Send the complete list on every call, keep at most one item in_progress, and send an empty list to clear it.",
		promptSnippet: "Track progress on multi-step work with a session todo list",
		promptGuidelines: [
			"Use todo_widget when work has multiple meaningful steps; skip it for simple, single-step tasks.",
			"Keep todo_widget synchronized with actual work. Mark one task in_progress before starting it, update the list immediately after its status changes, and revise the list when the plan changes.",
			"Before a progress report or final response, reconcile todo_widget with actual work; do not report completion while finished work remains pending or in_progress.",
			"Send the complete current list on every todo_widget call, keep at most one task in_progress, and send an empty list when no tracked work remains.",
		],
		parameters: TodoParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			signal?.throwIfAborted();
			if (!ownsSession(ctx)) {
				throw new Error("Cannot update the todo list because the session changed.");
			}
			validateItems(params.items);

			items = cloneItems(params.items);
			publish(ctx);

			const details: TodoDetails = {
				version: TODO_DETAILS_VERSION,
				items: cloneItems(items),
			};
			if (items.length === 0) {
				return {
					content: [{ type: "text", text: "Todo list cleared." }],
					details,
				};
			}

			const completed = items.filter((item) => item.status === "completed").length;
			const inProgress = items.some((item) => item.status === "in_progress");
			return {
				content: [
					{
						type: "text",
						text: `Todo list updated: ${completed} of ${items.length} complete${inProgress ? "; 1 in progress" : ""}.`,
					},
				],
				details,
			};
		},
	});

	pi.on("session_start", (_event, ctx) => {
		activeSession = ctx.sessionManager;
		items = reconstructItems(ctx.sessionManager.getBranch());
		publish(ctx);
	});

	pi.on("context", (event, ctx) => {
		if (!ownsSession(ctx)) return;
		const messages = reconcileTodoContext(event.messages, items);
		if (messages !== event.messages) return { messages };
	});

	pi.on("session_tree", (_event, ctx) => {
		if (!ownsSession(ctx)) return;
		items = reconstructItems(ctx.sessionManager.getBranch());
		publish(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ownsSession(ctx)) return;
		if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		items = [];
		activeSession = undefined;
	});
}

export function renderTodoWidget(
	items: readonly TodoItem[],
	theme: Theme,
	width: number,
): string[] {
	const completed = items.filter((item) => item.status === "completed").length;
	const divider = theme.fg("borderMuted", "─".repeat(Math.max(0, width)));
	const lines = [divider, theme.fg("muted", `Todo · ${completed}/${items.length} complete`)];

	for (const item of items) {
		const text = sanitizeTodoText(item.text);
		switch (item.status) {
			case "completed":
				lines.push(theme.fg("success", "✓ ") + theme.fg("muted", theme.strikethrough(text)));
				break;
			case "in_progress":
				lines.push(theme.fg("accent", "▶ ") + theme.fg("accent", theme.bold(text)));
				break;
			case "pending":
				lines.push(theme.fg("dim", "○ ") + theme.fg("text", text));
				break;
		}
	}

	return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
}

export function reconcileTodoContext(
	messages: ContextEvent["messages"],
	items: readonly TodoItem[],
): ContextEvent["messages"] {
	const existing = messages.filter(isTodoContextMessage);
	const content = items.length > 0 ? todoContextContent(items) : undefined;
	if (
		existing.length === 1 &&
		messages.at(-1) === existing[0] &&
		existing[0]?.content === content
	) {
		return messages;
	}
	if (existing.length === 0 && content === undefined) return messages;

	const withoutExisting = messages.filter((message) => !isTodoContextMessage(message));
	if (content === undefined) return withoutExisting;
	return [
		...withoutExisting,
		{
			role: "custom",
			customType: TODO_CONTEXT_MESSAGE_TYPE,
			content,
			display: false,
			details: { version: TODO_CONTEXT_VERSION },
			timestamp: 0,
		},
	];
}

export function sanitizeTodoText(value: string): string {
	let text = "";
	for (const character of stripTerminalSequences(value).replace(BIDI_CONTROLS, "")) {
		const codePoint = character.codePointAt(0) ?? 0;
		const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
		text += isControl ? " " : character;
	}
	return text.replace(/\s+/gu, " ").trim();
}

function todoContextContent(items: readonly TodoItem[]): string {
	return `[PI TODO STATUS v${TODO_CONTEXT_VERSION}]
An active todo list follows as JSON data.
Keep it synchronized with actual work: call todo_widget immediately after a task status changes and before beginning a different task.
Before a progress report or final response, reconcile every item; do not report completion while the list is stale.
Active todo list:
${JSON.stringify(items)}`;
}

function isTodoContextMessage(
	message: ContextEvent["messages"][number],
): message is ContextEvent["messages"][number] & { content: string } {
	return message.role === "custom" && message.customType === TODO_CONTEXT_MESSAGE_TYPE;
}

function validateItems(items: readonly TodoItem[]): void {
	for (const [index, item] of items.entries()) {
		if (item.text.trim().length === 0) {
			throw new Error(`Todo item ${index + 1} must contain non-whitespace text.`);
		}
	}

	const currentCount = items.filter((item) => item.status === "in_progress").length;
	if (currentCount > 1) {
		throw new Error("Todo list can contain at most one in_progress item.");
	}
}

function reconstructItems(entries: readonly SessionEntry[]): TodoItem[] {
	let restored: TodoItem[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
		if (!isTodoDetails(message.details)) continue;
		restored = cloneItems(message.details.items);
	}
	return restored;
}

function isTodoDetails(value: unknown): value is TodoDetails {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	if (record.version !== TODO_DETAILS_VERSION || !Array.isArray(record.items)) return false;
	if (record.items.length > MAX_TODO_ITEMS) return false;

	let currentCount = 0;
	for (const item of record.items) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
		const candidate = item as Record<string, unknown>;
		if (
			typeof candidate.text !== "string" ||
			candidate.text.length === 0 ||
			candidate.text.length > MAX_TODO_TEXT_LENGTH ||
			candidate.text.trim().length === 0 ||
			!TODO_STATUSES.includes(candidate.status as TodoStatus)
		) {
			return false;
		}
		if (candidate.status === "in_progress") currentCount += 1;
	}
	return currentCount <= 1;
}

function cloneItems(items: readonly TodoItem[]): TodoItem[] {
	return items.map((item) => ({ text: item.text, status: item.status }));
}
