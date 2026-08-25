import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	type CacheMonitorView,
	type CacheSample,
	collectCacheSamples,
	createCacheMonitorView,
	createCacheSample,
	formatMonitorLines,
	type MonitorLine,
} from "./metrics.js";

export const WIDGET_KEY = "cache-hit-monitor";

export default function cacheHitMonitor(pi: ExtensionAPI): void {
	let activeSession: ExtensionContext["sessionManager"] | undefined;
	let finalizedSamples: CacheSample[] = [];
	let currentEpoch = 0;
	let streamingSample: CacheSample | undefined;
	let publishedSignature: string | undefined;

	const ownsSession = (ctx: ExtensionContext): boolean => ctx.sessionManager === activeSession;

	const resolveCostRates = (ctx: ExtensionContext, provider: string, model: string) =>
		ctx.modelRegistry.find(provider, model)?.cost;

	const restore = (ctx: ExtensionContext): void => {
		const restored = collectCacheSamples(ctx.sessionManager.getBranch(), (provider, model) =>
			resolveCostRates(ctx, provider, model),
		);
		finalizedSamples = restored.samples;
		currentEpoch = restored.currentEpoch;
		streamingSample = undefined;
	};

	const sampleMessage = (message: AssistantMessage, ctx: ExtensionContext): CacheSample | null =>
		createCacheSample(
			message,
			currentEpoch,
			resolveCostRates(ctx, message.provider, message.model),
		);

	const publish = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI || !ownsSession(ctx)) return;
		const view = createCacheMonitorView(finalizedSamples, streamingSample);
		const lines = formatMonitorLines(view);
		const signature = JSON.stringify(lines);
		if (signature === publishedSignature) return;
		if (ctx.mode === "tui") {
			ctx.ui.setWidget(
				WIDGET_KEY,
				(_tui, theme) => ({
					render: (width: number) => renderCacheMonitor(view, theme, width),
					invalidate: () => {},
				}),
				{ placement: "aboveEditor" },
			);
		} else {
			ctx.ui.setWidget(
				WIDGET_KEY,
				lines.map(({ text }) => text),
				{ placement: "aboveEditor" },
			);
		}
		publishedSignature = signature;
	};

	pi.on("session_start", (_event, ctx) => {
		activeSession = ctx.sessionManager;
		publishedSignature = undefined;
		restore(ctx);
		publish(ctx);
	});

	pi.on("message_start", (event, ctx) => {
		if (!ownsSession(ctx) || event.message.role !== "assistant") return;
		streamingSample = undefined;
		publish(ctx);
	});

	pi.on("message_update", (event, ctx) => {
		if (!ownsSession(ctx) || event.message.role !== "assistant") return;
		const sample = sampleMessage(event.message, ctx);
		if (!sample) return;
		streamingSample = sample;
		publish(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		if (!ownsSession(ctx) || event.message.role !== "assistant") return;
		const sample = sampleMessage(event.message, ctx);
		streamingSample = undefined;
		if (sample) finalizedSamples.push(sample);
		publish(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		if (!ownsSession(ctx) || !streamingSample) return;
		streamingSample = undefined;
		publish(ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		if (!ownsSession(ctx)) return;
		restore(ctx);
		publish(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		if (!ownsSession(ctx)) return;
		restore(ctx);
		publish(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ownsSession(ctx)) return;
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
		activeSession = undefined;
		finalizedSamples = [];
		streamingSample = undefined;
		publishedSignature = undefined;
	});
}

export function renderCacheMonitor(view: CacheMonitorView, theme: Theme, width: number): string[] {
	const renderWidth = Math.max(0, width);
	if (renderWidth === 0) return formatMonitorLines(view).map(() => "");
	const divider = theme.fg("borderMuted", "─".repeat(renderWidth));
	const rendered = formatMonitorLines(view).flatMap((line) => {
		const styled = styleLine(line, theme);
		return wrapTextWithAnsi(styled, renderWidth);
	});
	return [divider, ...rendered].map((line) =>
		visibleWidth(line) <= renderWidth ? line : truncateToWidth(line, renderWidth, ""),
	);
}

function styleLine(line: MonitorLine, theme: Theme): string {
	switch (line.role) {
		case "title":
			return theme.fg("accent", theme.bold(line.text));
		case "good":
			return theme.fg("success", line.text);
		case "warning":
			return theme.fg("warning", line.text);
		case "bad":
			return theme.fg("error", line.text);
		case "muted":
			return theme.fg("muted", line.text);
		case "dim":
			return theme.fg("dim", line.text);
	}
}
