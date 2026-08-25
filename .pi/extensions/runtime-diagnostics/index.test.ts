import assert from "node:assert/strict";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import {
	CONTROL_ENTRY_TYPE,
	createCaptureState,
	createControlEntry,
	PROVIDER_REQUEST_ENTRY_TYPE,
	PROVIDER_RESPONSE_ENTRY_TYPE,
	pruneCaptureState,
	restoreCaptureState,
} from "./capture-state.js";
import { createDebugExtension } from "./index.js";
import {
	attachProviderResponse,
	createProviderResponseDiagnostic,
	extractProviderRequestDiagnostic,
} from "./provider-request.js";
import { RUNTIME_ENTRY_TYPE } from "./snapshot.js";

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
}

interface RegisteredTool {
	name: string;
	description: string;
	parameters: unknown;
	promptGuidelines?: string[];
	execute(
		toolCallId: string,
		params: {
			action?: string;
			detail?: string;
			sections?: string[];
			limit?: number;
			maxRecords?: number;
			maxAgeMinutes?: number;
		},
		signal: AbortSignal,
		onUpdate: undefined,
		ctx: ExtensionContext,
	): Promise<ToolResult>;
}

interface RegisteredCommand {
	description: string;
	getArgumentCompletions(prefix: string): Array<{ value: string; label: string }> | null;
	handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function customEntry(customType: string, data: unknown): SessionEntry {
	return {
		type: "custom",
		id: `${customType}-${Math.random()}`,
		parentId: null,
		timestamp: 0,
		customType,
		data,
	} as unknown as SessionEntry;
}

function createHarness(options: { extraToolCount?: number } = {}) {
	let currentTime = 1_000;
	const handlers = new Map<string, Handler[]>();
	const tools: RegisteredTool[] = [];
	const commands = new Map<string, RegisteredCommand>();
	const entries: SessionEntry[] = [];
	const notifications: string[] = [];
	const extraTools = Array.from({ length: options.extraToolCount ?? 0 }, (_, index) => ({
		name: `extra_tool_${index}`,
		description: "x".repeat(4_000),
		parameters: { type: "object", description: "x".repeat(4_000) },
		promptGuidelines: [],
		sourceInfo: {
			path: `/very/long/${"p".repeat(800)}/${index}/index.ts`,
			source: `npm:@example/extension-${index}`,
			scope: "user",
			origin: "package",
		},
	}));
	const builtinRead = {
		name: "read",
		description: "Read files",
		parameters: { type: "object" },
		promptGuidelines: [],
		sourceInfo: {
			path: "<builtin:read>",
			source: "builtin",
			scope: "temporary",
			origin: "top-level",
		},
	};
	const pi = {
		registerTool(tool: RegisteredTool) {
			tools.push(tool);
		},
		registerCommand(name: string, command: RegisteredCommand) {
			commands.set(name, command);
		},
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		appendEntry(customType: string, data: unknown) {
			entries.push(customEntry(customType, structuredClone(data)));
		},
		getThinkingLevel() {
			return "high";
		},
		getActiveTools() {
			return ["read", "runtime_diagnostics", ...extraTools.map(({ name }) => name)];
		},
		getAllTools() {
			return [
				builtinRead,
				...tools.map((tool) => ({
					...tool,
					sourceInfo: {
						path: "/project/.pi/extensions/runtime-diagnostics/index.ts",
						source: "auto",
						scope: "project",
						origin: "top-level",
					},
				})),
				...extraTools,
			];
		},
		getCommands() {
			return [...commands.entries()].map(([name, command]) => ({
				name,
				description: command.description,
				source: "extension",
				sourceInfo: {
					path: "/project/.pi/extensions/runtime-diagnostics/index.ts",
					source: "auto",
					scope: "project",
					origin: "top-level",
				},
			}));
		},
	} as unknown as ExtensionAPI;
	const sessionManager = {
		getSessionId: () => "session-1",
		getBranch: () => entries,
	} as unknown as ExtensionContext["sessionManager"];
	const context = {
		mode: "tui",
		hasUI: true,
		model: { provider: "openai", id: "gpt-test" },
		sessionManager,
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
		},
	} as unknown as ExtensionCommandContext;
	createDebugExtension({ now: () => currentTime })(pi);

	return {
		entries,
		notifications,
		context,
		tool: () => {
			const tool = tools.find(({ name }) => name === "runtime_diagnostics");
			assert.ok(tool);
			return tool;
		},
		command: () => {
			const command = commands.get("runtime-diagnostics");
			assert.ok(command);
			return command;
		},
		setTime(value: number) {
			currentTime = value;
		},
		async emit(event: string, payload: unknown) {
			for (const handler of handlers.get(event) ?? []) await handler(payload, context);
		},
	};
}

function parseToolResult(result: ToolResult) {
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

test("captures only sanitized provider metadata, byte counts, status, and header latency", () => {
	const request = extractProviderRequestDiagnostic(
		{
			instructions: "\u001b[31m[CODEX-LIKE PLAN MODE ACTIVE] secret prompt",
			tools: [
				{ type: "function", name: "read\n" },
				{ type: "function", function: { name: "bash" }, description: "secret schema" },
			],
			input: [{ type: "additional_tools", tools: [{ name: "edit" }] }],
			messages: [{ role: "user", content: "private message" }],
		},
		{
			requestIndex: 1,
			capturedAt: 100,
			sessionId: "session\u001b[31m",
			provider: "openai\n",
			model: "gpt-test\u202e",
		},
	);
	assert.equal(request.planModeMarkerPresent, true);
	assert.deepEqual(request.topLevelToolNames, ["bash", "read"]);
	assert.deepEqual(request.transcriptToolNames, ["edit"]);
	assert.ok((request.requestBytes ?? 0) > (request.toolDefinitionBytes ?? 0));
	assert.equal(JSON.stringify(request).includes("private message"), false);
	assert.equal(JSON.stringify(request).includes("secret schema"), false);
	assert.equal(JSON.stringify(request).includes("secret prompt"), false);

	const response = createProviderResponseDiagnostic(request, 429, 175);
	attachProviderResponse(request, response);
	assert.deepEqual(request.response, {
		version: 1,
		requestIndex: 1,
		capturedAt: 175,
		status: 429,
		responseHeaderLatencyMs: 75,
	});
});

test("restores fork-sensitive controls and prunes the active reporting window", () => {
	const first = extractProviderRequestDiagnostic(
		{},
		{
			requestIndex: 1,
			capturedAt: 1_000,
			sessionId: "session",
		},
	);
	const second = extractProviderRequestDiagnostic(
		{},
		{
			requestIndex: 2,
			capturedAt: 2_000,
			sessionId: "session",
		},
	);
	const state = createCaptureState();
	const control = createControlEntry(state, "configure", 2_500, {
		maxRecords: 1,
		maxAgeMinutes: 60,
	});
	const response = createProviderResponseDiagnostic(second, 200, 2_100);
	const restored = restoreCaptureState(
		[
			customEntry(PROVIDER_REQUEST_ENTRY_TYPE, first),
			customEntry(PROVIDER_REQUEST_ENTRY_TYPE, second),
			customEntry(PROVIDER_RESPONSE_ENTRY_TYPE, response),
			customEntry(CONTROL_ENTRY_TYPE, control),
		],
		3_000,
	);
	assert.equal(restored.records.length, 1);
	assert.equal(restored.records[0].requestIndex, 2);
	assert.equal(restored.records[0].response?.status, 200);
	assert.deepEqual(restored.policy, { maxRecords: 1, maxAgeMinutes: 60 });
	assert.equal(restored.nextRequestIndex, 3);
	assert.deepEqual(restored.pendingRequestIndexes, []);

	pruneCaptureState(restored, 2_000 + 61 * 60_000);
	assert.equal(restored.records.length, 0);
});

test("defaults to a concise agent report and supports targeted, control, bundle, and command routes", async () => {
	const harness = createHarness();
	await harness.emit("session_start", {});
	harness.setTime(2_000);
	await harness.emit("before_provider_request", {
		payload: {
			tools: [{ name: "read" }, { name: "runtime_diagnostics" }],
			input: [],
		},
	});
	harness.setTime(2_050);
	await harness.emit("after_provider_response", {
		status: 200,
		headers: { authorization: "secret" },
	});

	const concise = parseToolResult(
		await harness
			.tool()
			.execute("call-1", {}, new AbortController().signal, undefined, harness.context),
	);
	assert.equal(concise.format, "runtime-diagnostics/v2");
	assert.deepEqual(concise.details, {});
	assert.equal(JSON.stringify(concise).includes("authorization"), false);

	const targeted = parseToolResult(
		await harness
			.tool()
			.execute(
				"call-2",
				{ sections: ["provider", "privacy", "environment"] },
				new AbortController().signal,
				undefined,
				harness.context,
			),
	);
	const details = targeted.details as Record<string, unknown>;
	assert.ok(details.providerRequestCapture);
	assert.ok(details.privacy);
	assert.ok(details.environment);
	assert.equal((details.privacy as { passed: boolean }).passed, true);

	await harness
		.tool()
		.execute(
			"call-3",
			{ action: "configure", maxRecords: 2, maxAgeMinutes: 30 },
			new AbortController().signal,
			undefined,
			harness.context,
		);
	await assert.rejects(
		harness
			.tool()
			.execute(
				"call-4",
				{ action: "configure" },
				new AbortController().signal,
				undefined,
				harness.context,
			),
		/requires maxRecords or maxAgeMinutes/,
	);

	const disabled = parseToolResult(
		await harness
			.tool()
			.execute(
				"call-5",
				{ action: "disable" },
				new AbortController().signal,
				undefined,
				harness.context,
			),
	);
	assert.equal(
		((disabled.summary as Record<string, unknown>).capture as { enabled: boolean }).enabled,
		false,
	);
	harness.setTime(3_000);
	await harness.emit("before_provider_request", { payload: { tools: [{ name: "read" }] } });
	await harness
		.tool()
		.execute(
			"call-6",
			{ action: "enable" },
			new AbortController().signal,
			undefined,
			harness.context,
		);
	harness.setTime(4_000);
	await harness.emit("before_provider_request", {
		payload: { tools: [{ name: "read" }, { name: "runtime_diagnostics" }] },
	});
	harness.setTime(4_025);
	await harness.emit("after_provider_response", { status: 201, headers: {} });

	const shown = parseToolResult(
		await harness
			.tool()
			.execute(
				"call-7",
				{ action: "show", limit: 1 },
				new AbortController().signal,
				undefined,
				harness.context,
			),
	);
	const shownProvider = (shown.details as Record<string, unknown>).providerRequestCapture as {
		recent: unknown[];
	};
	assert.equal(shownProvider.recent.length, 1);
	const compared = parseToolResult(
		await harness
			.tool()
			.execute(
				"call-8",
				{ action: "compare" },
				new AbortController().signal,
				undefined,
				harness.context,
			),
	);
	assert.ok(
		(
			(compared.details as Record<string, unknown>).providerRequestCapture as {
				comparison: unknown;
			}
		).comparison,
	);

	const bundle = parseToolResult(
		await harness
			.tool()
			.execute(
				"call-9",
				{ action: "bundle" },
				new AbortController().signal,
				undefined,
				harness.context,
			),
	);
	assert.equal((bundle.export as { sanitized: boolean }).sanitized, true);
	const bundleDetails = bundle.details as Record<string, unknown>;
	assert.ok(bundleDetails.timeline);
	assert.equal(JSON.stringify(bundle).includes("/project/"), false);
	assert.deepEqual(
		(
			bundleDetails.tools as {
				catalog: Array<{ source: { path: string } }>;
			}
		).catalog.map(({ source }) => source.path),
		["<builtin:read>", "[redacted-local-path]"],
	);
	assert.deepEqual(
		(
			bundleDetails.extensions as {
				surfaces: Array<{ path: string }>;
			}
		).surfaces.map(({ path }) => path),
		["[redacted-local-path]"],
	);
	assert.equal(
		(bundleDetails.privacy as { bundlePathRedaction: string }).bundlePathRedaction,
		"passed",
	);

	const cleared = parseToolResult(
		await harness
			.tool()
			.execute(
				"call-10",
				{ action: "clear" },
				new AbortController().signal,
				undefined,
				harness.context,
			),
	);
	assert.equal(
		(
			(cleared.summary as Record<string, unknown>).capture as {
				retainedRecordCount: number;
			}
		).retainedRecordCount,
		0,
	);

	const command = harness.command();
	assert.ok(command.getArgumentCompletions("pri")?.some(({ value }) => value === "privacy"));
	for (const route of [
		"",
		"status",
		"provider",
		"cache",
		"tools",
		"extensions",
		"privacy",
		"help",
	]) {
		await command.handler(route, harness.context);
	}
	assert.equal(harness.notifications.length, 8);
	await assert.rejects(command.handler("tools trailing", harness.context), /Unknown/);
	await assert.rejects(
		command.handler("status", {
			...harness.context,
			mode: "print",
			hasUI: false,
		} as ExtensionCommandContext),
		/TUI and RPC modes only/,
	);
});

test("clears unmatched provider requests before attributing responses in a later run", async () => {
	const harness = createHarness();
	await harness.emit("session_start", {});
	harness.setTime(2_000);
	await harness.emit("before_provider_request", { payload: { tools: [{ name: "read" }] } });
	await harness.emit("agent_end", { messages: [] });

	harness.setTime(3_000);
	await harness.emit("before_provider_request", { payload: { tools: [{ name: "read" }] } });
	harness.setTime(3_025);
	await harness.emit("after_provider_response", { status: 200, headers: {} });

	const shown = parseToolResult(
		await harness
			.tool()
			.execute(
				"call-show",
				{ action: "show", limit: 2 },
				new AbortController().signal,
				undefined,
				harness.context,
			),
	);
	const records = (
		(shown.details as Record<string, unknown>).providerRequestCapture as {
			recent: Array<{ response: null | { status: number; responseHeaderLatencyMs: number } }>;
		}
	).recent;
	assert.equal(records[0].response, null);
	assert.deepEqual(records[1].response, {
		version: 1,
		requestIndex: 2,
		capturedAt: 3_025,
		status: 200,
		responseHeaderLatencyMs: 25,
	});
});

test("ignores malformed restored runtime snapshots before comparison", async () => {
	const harness = createHarness();
	await harness.emit("session_start", {});
	for (const capturedAt of [2_000, 3_000]) {
		harness.entries.push(
			customEntry(RUNTIME_ENTRY_TYPE, {
				version: 1,
				capturedAt,
				reason: "assistant_message",
				sessionId: "session-1",
				provider: "openai",
				model: "gpt-test",
				thinkingLevel: "high",
				cache: null,
				tools: { active: null, inactive: {} },
			}),
		);
	}

	const compared = parseToolResult(
		await harness
			.tool()
			.execute(
				"call-compare",
				{ action: "compare" },
				new AbortController().signal,
				undefined,
				harness.context,
			),
	);
	const timeline = (compared.details as Record<string, unknown>).timeline as {
		recentRuntimeRecords: unknown[];
		comparison: unknown;
	};
	assert.equal(timeline.recentRuntimeRecords.length, 1);
	assert.equal(timeline.comparison, null);
});

test("bounds a full diagnostic bundle below Pi tool output limits", async () => {
	const harness = createHarness({ extraToolCount: 120 });
	await harness.emit("session_start", {});
	const result = await harness
		.tool()
		.execute(
			"call-large",
			{ action: "bundle", limit: 20 },
			new AbortController().signal,
			undefined,
			harness.context,
		);
	const text = result.content[0].text;
	assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
	assert.ok(text.split("\n").length <= 2_000);
	assert.match(text, /Detailed sections were omitted/);
});
