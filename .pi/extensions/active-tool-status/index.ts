import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const WIDGET_KEY = "active-tool-status";
const MAX_TOOL_NAME_LENGTH = 32;
export const ACTIVE_TOOL_REFRESH_INTERVAL_MS = 500;

export default function activeToolStatus(pi: ExtensionAPI): void {
	let activeSession: ExtensionContext["sessionManager"] | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let publishedValue: string | undefined;
	let hasPublished = false;

	const ownsSession = (ctx: ExtensionContext) => ctx.sessionManager === activeSession;

	const publish = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		const content = formatActiveToolWidget(pi.getActiveTools());
		const value = content?.join("\n");
		if (hasPublished && value === publishedValue) return;
		const widget =
			content && ctx.mode === "tui"
				? (_tui: unknown, theme: Theme) => ({
						render: (width: number) => renderActiveToolWidget(content, theme, width),
						invalidate: () => {},
					})
				: content;
		ctx.ui.setWidget(WIDGET_KEY, widget, { placement: "aboveEditor" });
		publishedValue = value;
		hasPublished = true;
	};

	const stopRefreshing = (): void => {
		if (!refreshTimer) return;
		clearInterval(refreshTimer);
		refreshTimer = undefined;
	};

	const clear = (ctx: ExtensionContext): void => {
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
		publishedValue = undefined;
		hasPublished = false;
	};

	pi.on("session_start", (_event, ctx) => {
		stopRefreshing();
		activeSession = ctx.sessionManager;
		hasPublished = false;
		publish(ctx);
		if (ctx.hasUI) {
			refreshTimer = setInterval(() => {
				if (ownsSession(ctx)) publish(ctx);
			}, ACTIVE_TOOL_REFRESH_INTERVAL_MS);
		}
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (ownsSession(ctx)) publish(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		if (ownsSession(ctx)) publish(ctx);
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		if (ownsSession(ctx)) publish(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ownsSession(ctx) && ctx.isIdle()) publish(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ownsSession(ctx)) return;
		stopRefreshing();
		clear(ctx);
		activeSession = undefined;
	});
}

export function formatActiveToolWidget(toolNames: Iterable<string>): string[] | undefined {
	const tools = [...toolNames].map(sanitizeToolName);
	if (tools.length === 0) return undefined;
	const label = tools.length === 1 ? "Active tool" : "Active tools";
	return [`${label} (${tools.length})`, tools.join(" · ")];
}

export function renderActiveToolWidget(
	lines: readonly string[],
	theme: Theme,
	width: number,
): string[] {
	const renderWidth = Math.max(0, width);
	const contentLines =
		renderWidth === 0
			? lines.map(() => "")
			: lines.flatMap((line) => wrapTextWithAnsi(line, renderWidth));
	return [theme.fg("borderMuted", "─".repeat(renderWidth)), ...contentLines];
}

export function sanitizeToolName(value: string): string {
	const printable = value.replace(/[^\p{L}\p{N}_.:/-]+/gu, "");
	if (!printable) return "tool";
	const characters = [...printable];
	return characters.length > MAX_TOOL_NAME_LENGTH
		? `${characters.slice(0, MAX_TOOL_NAME_LENGTH).join("")}…`
		: printable;
}
