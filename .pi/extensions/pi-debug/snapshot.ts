import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

export const RUNTIME_ENTRY_TYPE = "pi-debug:runtime-snapshot";
const MAX_TOOL_NAMES = 200;
const MAX_EXTENSION_SURFACES = 100;
const MAX_CACHE_SAMPLES = 20;
const MAX_RUNTIME_RECORDS = 20;

export type RuntimeSnapshotReason =
	| "session_start"
	| "model_select"
	| "before_agent_start"
	| "tools_changed"
	| "assistant_message"
	| "diagnostic_tool";

interface UsageLike {
	input?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export interface ResponseCacheSample {
	capturedAt: number;
	provider: string | null;
	model: string | null;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	promptTokens: number;
	hitRatePercent: number | null;
}

export interface RuntimeSnapshot {
	version: 1;
	capturedAt: number;
	reason: RuntimeSnapshotReason;
	sessionId: string;
	provider: string | null;
	model: string | null;
	thinkingLevel: string;
	cache: ResponseCacheSample | null;
	tools: ToolState;
}

export interface ToolState {
	configuredCount: number;
	activeCount: number;
	inactiveCount: number;
	active: string[];
	inactive: string[];
	unknownActive: string[];
	omittedCount: number;
}

export interface RuntimeDiagnosticReport {
	capturedAt: number;
	sessionId: string;
	current: {
		provider: string | null;
		model: string | null;
		thinkingLevel: string;
	};
	cache: {
		requestCount: number;
		input: number;
		cacheRead: number;
		cacheWrite: number;
		promptTokens: number;
		hitRatePercent: number | null;
		latest: ResponseCacheSample | null;
		recent: ResponseCacheSample[];
	};
	tools: ToolState;
	extensions: {
		visibility: string;
		visibleCount: number;
		omittedCount: number;
		surfaces: ExtensionSurface[];
	};
	issues: string[];
	recentRuntimeRecords: RuntimeSnapshot[];
}

interface ExtensionSurface {
	path: string;
	source: string;
	scope: string;
	origin: string;
	tools: string[];
	commands: string[];
}

interface ResponseIdentity {
	provider?: string;
	model?: string;
	usage: UsageLike;
}

export function createRuntimeSnapshot(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	reason: RuntimeSnapshotReason,
	capturedAt: number,
	response?: ResponseIdentity,
): RuntimeSnapshot {
	return {
		version: 1,
		capturedAt,
		reason,
		sessionId: ctx.sessionManager.getSessionId(),
		provider: ctx.model?.provider ?? null,
		model: ctx.model?.id ?? null,
		thinkingLevel: pi.getThinkingLevel(),
		cache: response
			? createCacheSample(response.usage, capturedAt, response.provider, response.model)
			: null,
		tools: collectToolState(pi),
	};
}

export function runtimeStateSignature(snapshot: RuntimeSnapshot): string {
	return JSON.stringify({
		provider: snapshot.provider,
		model: snapshot.model,
		thinkingLevel: snapshot.thinkingLevel,
		tools: snapshot.tools,
	});
}

export function createRuntimeReport(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	capturedAt: number,
): RuntimeDiagnosticReport {
	const entries = ctx.sessionManager.getBranch();
	const tools = collectToolState(pi);
	const issues: string[] = [];
	if (!ctx.model) issues.push("No active model is available in the extension context.");
	if (tools.unknownActive.length > 0) {
		issues.push(
			`Active tools missing from the configured catalog: ${tools.unknownActive.join(", ")}.`,
		);
	}

	return {
		capturedAt,
		sessionId: ctx.sessionManager.getSessionId(),
		current: {
			provider: ctx.model?.provider ?? null,
			model: ctx.model?.id ?? null,
			thinkingLevel: pi.getThinkingLevel(),
		},
		cache: collectCacheMetrics(entries),
		tools,
		extensions: collectExtensionSurfaces(pi),
		issues,
		recentRuntimeRecords: collectRuntimeRecords(entries),
	};
}

function collectToolState(pi: ExtensionAPI): ToolState {
	const configured = [...pi.getAllTools()].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
	const configuredNames = new Set(configured.map(({ name }) => name));
	const activeNames = [...new Set(pi.getActiveTools())].sort((left, right) =>
		left.localeCompare(right),
	);
	const knownActive = activeNames.filter((name) => configuredNames.has(name));
	const inactive = configured.map(({ name }) => name).filter((name) => !activeNames.includes(name));
	const unknownActive = activeNames.filter((name) => !configuredNames.has(name));
	const visible = [...knownActive, ...inactive].slice(0, MAX_TOOL_NAMES);
	const visibleSet = new Set(visible);

	return {
		configuredCount: configured.length,
		activeCount: knownActive.length,
		inactiveCount: inactive.length,
		active: knownActive.filter((name) => visibleSet.has(name)),
		inactive: inactive.filter((name) => visibleSet.has(name)),
		unknownActive,
		omittedCount: Math.max(0, knownActive.length + inactive.length - visible.length),
	};
}

function collectCacheMetrics(entries: readonly SessionEntry[]): RuntimeDiagnosticReport["cache"] {
	const samples: ResponseCacheSample[] = [];
	let input = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const sample = createCacheSample(
			entry.message.usage,
			entry.message.timestamp,
			entry.message.provider,
			entry.message.model,
		);
		samples.push(sample);
		input += sample.input;
		cacheRead += sample.cacheRead;
		cacheWrite += sample.cacheWrite;
	}
	const promptTokens = input + cacheRead + cacheWrite;
	return {
		requestCount: samples.length,
		input,
		cacheRead,
		cacheWrite,
		promptTokens,
		hitRatePercent: promptTokens > 0 ? (cacheRead / promptTokens) * 100 : null,
		latest: samples.at(-1) ?? null,
		recent: samples.slice(-MAX_CACHE_SAMPLES),
	};
}

function createCacheSample(
	usage: UsageLike,
	capturedAt: number,
	provider?: string,
	model?: string,
): ResponseCacheSample {
	const input = finiteNumber(usage.input);
	const cacheRead = finiteNumber(usage.cacheRead);
	const cacheWrite = finiteNumber(usage.cacheWrite);
	const promptTokens = input + cacheRead + cacheWrite;
	return {
		capturedAt,
		provider: provider ?? null,
		model: model ?? null,
		input,
		cacheRead,
		cacheWrite,
		promptTokens,
		hitRatePercent: promptTokens > 0 ? (cacheRead / promptTokens) * 100 : null,
	};
}

function collectRuntimeRecords(entries: readonly SessionEntry[]): RuntimeSnapshot[] {
	return entries
		.filter(
			(entry): entry is Extract<SessionEntry, { type: "custom" }> =>
				entry.type === "custom" && entry.customType === RUNTIME_ENTRY_TYPE,
		)
		.map(({ data }) => data)
		.filter(isRuntimeSnapshot)
		.slice(-MAX_RUNTIME_RECORDS);
}

function collectExtensionSurfaces(pi: ExtensionAPI): RuntimeDiagnosticReport["extensions"] {
	const surfaces = new Map<string, ExtensionSurface>();
	const add = (
		sourceInfo: { path: string; source: string; scope: string; origin: string },
		kind: "tools" | "commands",
		name: string,
	) => {
		const key = `${sourceInfo.path}\u0000${sourceInfo.source}`;
		const surface = surfaces.get(key) ?? {
			path: sourceInfo.path,
			source: sourceInfo.source,
			scope: sourceInfo.scope,
			origin: sourceInfo.origin,
			tools: [],
			commands: [],
		};
		surface[kind].push(name);
		surfaces.set(key, surface);
	};

	for (const tool of pi.getAllTools()) {
		if (tool.sourceInfo.source === "builtin" || tool.sourceInfo.source === "sdk") continue;
		add(tool.sourceInfo, "tools", tool.name);
	}
	for (const command of pi.getCommands()) {
		if (command.source !== "extension") continue;
		add(command.sourceInfo, "commands", command.name);
	}

	const all = [...surfaces.values()]
		.map((surface) => ({
			...surface,
			tools: [...new Set(surface.tools)].sort(),
			commands: [...new Set(surface.commands)].sort(),
		}))
		.sort((left, right) => left.path.localeCompare(right.path));
	return {
		visibility:
			"Only extensions exposing public tools or slash commands are visible; passive event-only extensions are not enumerable through ExtensionAPI.",
		visibleCount: all.length,
		omittedCount: Math.max(0, all.length - MAX_EXTENSION_SURFACES),
		surfaces: all.slice(0, MAX_EXTENSION_SURFACES),
	};
}

function isRuntimeSnapshot(value: unknown): value is RuntimeSnapshot {
	if (!isRecord(value)) return false;
	return (
		value.version === 1 &&
		typeof value.capturedAt === "number" &&
		typeof value.reason === "string" &&
		typeof value.sessionId === "string" &&
		isRecord(value.tools)
	);
}

function finiteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
