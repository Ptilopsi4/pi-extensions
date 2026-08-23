import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	extractProviderRequestDiagnostic,
	isProviderRequestDiagnostic,
	type ProviderRequestDiagnostic,
} from "./provider-request.js";
import {
	createRuntimeReport,
	createRuntimeSnapshot,
	RUNTIME_ENTRY_TYPE,
	type RuntimeSnapshotReason,
	runtimeStateSignature,
} from "./snapshot.js";

export const PROVIDER_REQUEST_ENTRY_TYPE = "pi-debug:provider-request";
export const CONTROL_ENTRY_TYPE = "pi-debug:control";
const TOOL_NAME = "runtime_diagnostics";
const MAX_SHOW_RECORDS = 20;
const MAX_OUTPUT_BYTES = 50 * 1024;
const EXPERIMENTAL_WARNING =
	"pi-debug is experimental and records privacy-filtered diagnostics in the current Pi session.";
const PROVIDER_HOOK_LIMITATIONS = [
	"before_provider_request exposes the serialized payload at this extension's position in handler load order; later extensions can still replace it.",
	"The hook does not prove that the provider accepted or executed the exposed tools.",
	"ExtensionAPI cannot enumerate passive event-only extensions, so extension visibility is limited to public tool and command surfaces.",
];

const ACTIONS = ["status", "enable", "disable", "latest", "show", "compare", "clear"] as const;
type DebugAction = (typeof ACTIONS)[number];

interface DebugDependencies {
	now(): number;
}

interface ControlEntry {
	version: 1;
	capturedAt: number;
	action: "enable" | "disable" | "clear";
}

interface ProviderCaptureState {
	enabled: boolean;
	records: ProviderRequestDiagnostic[];
	nextRequestIndex: number;
}

export function createDebugExtension(
	dependencies: Partial<DebugDependencies> = {},
): (pi: ExtensionAPI) => void {
	const now = dependencies.now ?? Date.now;
	return function debugExtension(pi: ExtensionAPI): void {
		let capture: ProviderCaptureState = { enabled: true, records: [], nextRequestIndex: 1 };
		let lastRuntimeSignature: string | undefined;

		pi.registerTool({
			name: TOOL_NAME,
			label: "Runtime Diagnostics",
			description:
				"Inspect and manage privacy-filtered runtime diagnostics for model routing, prompt-cache performance, tool availability, visible extension surfaces, and tools exposed in provider requests.",
			promptSnippet:
				"Inspect model, cache, tool, extension-surface, and provider-request diagnostics",
			promptGuidelines: [
				"Use runtime_diagnostics when model routing, prompt caching, tool availability, deferred tool loading, or extension registration may be misconfigured.",
			],
			parameters: Type.Object({
				action: Type.Optional(
					StringEnum(ACTIONS, {
						description:
							"status (default), enable/disable provider-request capture, latest, show, compare, or clear captured provider-request diagnostics",
					}),
				),
				limit: Type.Optional(
					Type.Integer({
						minimum: 1,
						maximum: MAX_SHOW_RECORDS,
						description: "Maximum provider-request records returned by show",
					}),
				),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				signal?.throwIfAborted();
				const action: DebugAction = params.action ?? "status";
				applyControl(action);
				recordRuntime(ctx, "diagnostic_tool", false);
				const response = createToolResponse(action, params.limit ?? 10, pi, ctx, capture, now());
				const bounded = boundResponse(response);
				return {
					content: [{ type: "text", text: bounded.text }],
					details: bounded.value,
				};
			},
		});

		pi.on("session_start", (_event, ctx) => {
			capture = restoreCaptureState(ctx.sessionManager.getBranch());
			lastRuntimeSignature = undefined;
			if (ctx.hasUI) ctx.ui.notify(EXPERIMENTAL_WARNING, "warning");
			recordRuntime(ctx, "session_start", true);
		});

		pi.on("model_select", (_event, ctx) => {
			recordRuntime(ctx, "model_select", false);
		});

		pi.on("before_agent_start", (_event, ctx) => {
			recordRuntime(ctx, "before_agent_start", false);
		});

		pi.on("tool_execution_end", (_event, ctx) => {
			recordRuntime(ctx, "tools_changed", false);
		});

		pi.on("message_end", (event, ctx) => {
			if (event.message.role !== "assistant") return;
			const snapshot = createRuntimeSnapshot(pi, ctx, "assistant_message", now(), {
				provider: event.message.provider,
				model: event.message.model,
				usage: event.message.usage,
			});
			lastRuntimeSignature = runtimeStateSignature(snapshot);
			pi.appendEntry(RUNTIME_ENTRY_TYPE, snapshot);
		});

		pi.on("before_provider_request", (event, ctx) => {
			if (!capture.enabled) return;
			const diagnostic = extractProviderRequestDiagnostic(event.payload, {
				requestIndex: capture.nextRequestIndex,
				capturedAt: now(),
				sessionId: ctx.sessionManager.getSessionId(),
				provider: ctx.model?.provider,
				model: ctx.model?.id,
			});
			capture.nextRequestIndex += 1;
			capture.records.push(diagnostic);
			pi.appendEntry(PROVIDER_REQUEST_ENTRY_TYPE, diagnostic);
		});

		function recordRuntime(
			ctx: ExtensionContext,
			reason: RuntimeSnapshotReason,
			force: boolean,
		): void {
			const snapshot = createRuntimeSnapshot(pi, ctx, reason, now());
			const signature = runtimeStateSignature(snapshot);
			if (!force && signature === lastRuntimeSignature) return;
			lastRuntimeSignature = signature;
			pi.appendEntry(RUNTIME_ENTRY_TYPE, snapshot);
		}

		function applyControl(action: DebugAction): void {
			if (action !== "enable" && action !== "disable" && action !== "clear") return;
			if (action === "enable") capture.enabled = true;
			if (action === "disable") capture.enabled = false;
			if (action === "clear") capture.records = [];
			const control: ControlEntry = { version: 1, capturedAt: now(), action };
			pi.appendEntry(CONTROL_ENTRY_TYPE, control);
		}
	};
}

function createToolResponse(
	action: DebugAction,
	limit: number,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	capture: ProviderCaptureState,
	capturedAt: number,
) {
	const recent = action === "show" ? capture.records.slice(-limit) : [];
	const latest =
		action === "latest" || action === "status" || action === "enable" || action === "disable"
			? (capture.records.at(-1) ?? null)
			: null;
	const comparisonRecords = selectComparisonRecords(action, recent, capture.records);
	return {
		action,
		providerRequestCapture: {
			enabled: capture.enabled,
			recordCountSinceClear: capture.records.length,
			latest,
			recent,
			comparison:
				comparisonRecords.length === 2
					? compareProviderRequests(comparisonRecords[0], comparisonRecords[1])
					: null,
		},
		runtime: createRuntimeReport(pi, ctx, capturedAt),
		privacy:
			"Records contain only timestamp, session ID, provider/model IDs, the plan marker boolean, and extracted tool names. Prompts, schemas, arguments, headers, credentials, and message contents are not retained.",
		limitations: PROVIDER_HOOK_LIMITATIONS,
	};
}

function selectComparisonRecords(
	action: DebugAction,
	recent: readonly ProviderRequestDiagnostic[],
	all: readonly ProviderRequestDiagnostic[],
): readonly ProviderRequestDiagnostic[] {
	if (all.length < 2) return [];
	if (action === "compare") return [all[0], all[all.length - 1]];
	if (action === "show" && recent.length >= 2) {
		return [recent[0], recent[recent.length - 1]];
	}
	return all.slice(-2);
}

function compareProviderRequests(from: ProviderRequestDiagnostic, to: ProviderRequestDiagnostic) {
	return {
		fromRequestIndex: from.requestIndex,
		toRequestIndex: to.requestIndex,
		providerChanged: from.provider !== to.provider,
		modelChanged: from.model !== to.model,
		planModeMarkerChanged: from.planModeMarkerPresent !== to.planModeMarkerPresent,
		topLevelTools: diffNames(from.topLevelToolNames, to.topLevelToolNames),
		transcriptTools: diffNames(from.transcriptToolNames, to.transcriptToolNames),
	};
}

function diffNames(from: readonly string[], to: readonly string[]) {
	const previous = new Set(from);
	const current = new Set(to);
	return {
		added: to.filter((name) => !previous.has(name)),
		removed: from.filter((name) => !current.has(name)),
	};
}

function restoreCaptureState(entries: readonly SessionEntry[]): ProviderCaptureState {
	const state: ProviderCaptureState = { enabled: true, records: [], nextRequestIndex: 1 };
	let maximumRequestIndex = 0;
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		if (
			entry.customType === PROVIDER_REQUEST_ENTRY_TYPE &&
			isProviderRequestDiagnostic(entry.data)
		) {
			maximumRequestIndex = Math.max(maximumRequestIndex, entry.data.requestIndex);
			state.records.push(entry.data);
			continue;
		}
		if (entry.customType !== CONTROL_ENTRY_TYPE || !isControlEntry(entry.data)) continue;
		if (entry.data.action === "enable") state.enabled = true;
		if (entry.data.action === "disable") state.enabled = false;
		if (entry.data.action === "clear") state.records = [];
	}
	state.nextRequestIndex = maximumRequestIndex + 1;
	return state;
}

function isControlEntry(value: unknown): value is ControlEntry {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		typeof record.capturedAt === "number" &&
		(record.action === "enable" || record.action === "disable" || record.action === "clear")
	);
}

function boundResponse(value: ReturnType<typeof createToolResponse>): {
	value: unknown;
	text: string;
} {
	let text = JSON.stringify(value, null, 2);
	if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return { value, text };

	const compact = {
		...value,
		providerRequestCapture: {
			...value.providerRequestCapture,
			recent: value.providerRequestCapture.recent.slice(-2).map(compactProviderRecord),
			latest: value.providerRequestCapture.latest
				? compactProviderRecord(value.providerRequestCapture.latest)
				: null,
		},
		runtime: {
			...value.runtime,
			extensions: {
				...value.runtime.extensions,
				surfaces: [],
				outputNote: "Extension surface details omitted to keep tool output below 50 KB.",
			},
			recentRuntimeRecords: value.runtime.recentRuntimeRecords.slice(-5),
		},
		outputNote: "Large diagnostic arrays were compacted to keep tool output below 50 KB.",
	};
	text = JSON.stringify(compact, null, 2);
	if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return { value: compact, text };

	const minimal = {
		action: value.action,
		providerRequestCapture: {
			enabled: value.providerRequestCapture.enabled,
			recordCountSinceClear: value.providerRequestCapture.recordCountSinceClear,
			latest: value.providerRequestCapture.latest
				? compactProviderRecord(value.providerRequestCapture.latest)
				: null,
			comparison: value.providerRequestCapture.comparison,
		},
		runtime: {
			capturedAt: value.runtime.capturedAt,
			sessionId: value.runtime.sessionId,
			current: value.runtime.current,
			cache: value.runtime.cache,
			tools: value.runtime.tools,
			issues: value.runtime.issues,
		},
		privacy: value.privacy,
		limitations: value.limitations,
		outputNote: "Only the bounded diagnostic summary is shown.",
	};
	return { value: minimal, text: JSON.stringify(minimal, null, 2) };
}

function compactProviderRecord(record: ProviderRequestDiagnostic) {
	return {
		...record,
		topLevelToolCount: record.topLevelToolNames.length,
		topLevelToolNames: record.topLevelToolNames.slice(0, 20),
		transcriptToolCount: record.transcriptToolNames.length,
		transcriptToolNames: record.transcriptToolNames.slice(0, 20),
	};
}

export default createDebugExtension();
