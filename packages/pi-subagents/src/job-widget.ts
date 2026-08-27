import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { JobRuntime } from "./job-runtime.js";
import type { ActiveJobDisplay } from "./job-types.js";
import { safeTerminalLine } from "./safe-text.js";

export const SUBAGENT_WIDGET_KEY = "pi-subagents";
export const SUBAGENT_WIDGET_REFRESH_INTERVAL_MS = 1_000;

const WIDGET_OPTIONS = { placement: "aboveEditor" } as const;

export interface JobWidgetController {
	start(ctx: ExtensionContext): void;
	shutdown(ctx?: ExtensionContext): void;
}

export function createJobWidget(runtime: JobRuntime): JobWidgetController {
	let activeSession: ExtensionContext["sessionManager"] | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;
	let publishedValue: string | undefined;

	const stopResources = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
		unsubscribe?.();
		unsubscribe = undefined;
	};
	const owns = (ctx: ExtensionContext) => ctx.sessionManager === activeSession;
	const publish = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui" || !owns(ctx)) return;
		const jobs = runtime.activeJobsForDisplay();
		const value = jobs
			.map(
				(job) =>
					`${job.jobId}\0${job.state}\0${Math.floor(job.elapsedMs / 1_000)}\0${job.timeout ?? ""}\0${job.tools.join(",")}`,
			)
			.join("\n");
		if (value === publishedValue) return;
		if (jobs.length === 0) {
			ctx.ui.setWidget(SUBAGENT_WIDGET_KEY, undefined);
		} else {
			const snapshot = jobs.map((job) => ({ ...job, tools: [...job.tools] }));
			ctx.ui.setWidget(
				SUBAGENT_WIDGET_KEY,
				(_tui, theme) => ({
					render: (width) => renderJobWidget(snapshot, theme, width),
					invalidate: () => undefined,
				}),
				WIDGET_OPTIONS,
			);
		}
		publishedValue = value;
	};

	return {
		start(ctx) {
			stopResources();
			activeSession = ctx.sessionManager;
			publishedValue = undefined;
			if (ctx.mode !== "tui") return;
			ctx.ui.setWidget(SUBAGENT_WIDGET_KEY, undefined);
			unsubscribe = runtime.subscribe(() => publish(ctx));
			timer = setInterval(() => publish(ctx), SUBAGENT_WIDGET_REFRESH_INTERVAL_MS);
			timer.unref();
			publish(ctx);
		},
		shutdown(ctx) {
			if (ctx && !owns(ctx)) return;
			stopResources();
			if (ctx?.mode === "tui") ctx.ui.setWidget(SUBAGENT_WIDGET_KEY, undefined);
			publishedValue = undefined;
			activeSession = undefined;
		},
	};
}

export function renderJobWidget(
	jobs: readonly ActiveJobDisplay[],
	theme: Theme,
	width: number,
): string[] {
	const renderWidth = Math.max(0, width);
	const lines = [
		theme.fg("borderMuted", "─".repeat(renderWidth)),
		theme.fg("muted", `Subagents · ${jobs.length} active`),
		...jobs.map((job) => renderJob(job, theme)),
	];
	return lines.map((line) => truncateToWidth(line, renderWidth, ""));
}

function renderJob(job: ActiveJobDisplay, theme: Theme): string {
	const running = job.state === "running";
	const symbol = theme.fg(running ? "accent" : "dim", running ? "▶ " : "○ ");
	const state = theme.fg(running ? "accent" : "muted", job.state);
	const jobId = safeTerminalLine(job.jobId, 256);
	const tools =
		job.tools.length > 0 ? job.tools.map((tool) => safeTerminalLine(tool, 64)).join(", ") : "none";
	const timeout = job.timeout === undefined ? "no timeout" : formatSeconds(job.timeout);
	const detail = ` · ${formatSeconds(Math.floor(job.elapsedMs / 1_000))} / ${timeout} · tools: ${tools}`;
	return `${symbol}${theme.fg("text", jobId)} · ${state}${theme.fg("muted", detail)}`;
}

function formatSeconds(value: number): string {
	if (value < 60) return `${formatNumber(value)}s`;
	const seconds = Math.floor(value);
	const hours = Math.floor(seconds / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	const remainder = seconds % 60;
	if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
	return `${minutes}m${remainder > 0 ? ` ${remainder}s` : ""}`;
}

function formatNumber(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}
