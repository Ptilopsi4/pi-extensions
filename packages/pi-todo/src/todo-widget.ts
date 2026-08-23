import { StringEnum } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

export const TOOL_NAME = "todo_widget";
export const WIDGET_KEY = "todo";
export const TODO_DETAILS_VERSION = 1;
export const MAX_TODO_ITEMS = 50;
export const MAX_TODO_TEXT_LENGTH = 300;

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
				description: "Task text",
			}),
			status: StringEnum(TODO_STATUSES, {
				description: "Task status",
			}),
		}),
		{
			maxItems: MAX_TODO_ITEMS,
			description: "The complete authoritative todo list; an empty list clears the widget",
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
			{ placement: "aboveEditor" },
		);
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo Widget",
		description:
			"Replace the session todo list shown above the editor. Always send the complete list, use one in_progress item at most, and send an empty list to clear it.",
		promptSnippet: "Create and update the session todo list shown above the editor",
		promptGuidelines: [
			"Use todo_widget for multi-step coding work: send the complete list, keep at most one item in_progress, and update statuses when work advances.",
		],
		parameters: TodoParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			signal?.throwIfAborted();
			if (!ownsSession(ctx)) {
				throw new Error("Cannot update the todo widget because the session changed.");
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
					content: [{ type: "text", text: "Todo widget cleared." }],
					details,
				};
			}

			const completed = items.filter((item) => item.status === "completed").length;
			const inProgress = items.some((item) => item.status === "in_progress");
			return {
				content: [
					{
						type: "text",
						text: `Todo widget updated: ${completed}/${items.length} completed${inProgress ? ", 1 in progress" : ""}.`,
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
	const lines = [theme.fg("muted", `Tasks ${completed}/${items.length}`)];

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

export function sanitizeTodoText(value: string): string {
	let text = "";
	for (const character of stripTerminalSequences(value).replace(BIDI_CONTROLS, "")) {
		const codePoint = character.codePointAt(0) ?? 0;
		const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
		text += isControl ? " " : character;
	}
	return text.replace(/\s+/gu, " ").trim();
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
