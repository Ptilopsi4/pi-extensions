import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveTimeoutMs } from "./job-process.js";
import type { JobRuntime } from "./job-runtime.js";
import {
	CORE_TOOL_NAMES,
	type CoreToolName,
	DEFAULT_JOB_TOOLS,
	JOB_THINKING_LEVELS,
	type JobThinkingLevel,
	MAX_JOB_ID_LENGTH,
	MAX_TASK_BYTES,
	MAX_TIMEOUT_SECONDS,
} from "./job-types.js";
import { safeTerminalLine, safeTerminalText } from "./safe-text.js";

const TOOL_NAME_SET = new Set<string>(CORE_TOOL_NAMES);
const THINKING_LEVEL_SET = new Set<string>(JOB_THINKING_LEVELS);

export const SpawnParameters = Type.Object(
	{
		task: Type.String({
			description: "Self-contained task, constraints, and expected result. Maximum 50 KiB UTF-8.",
			minLength: 1,
			maxLength: MAX_TASK_BYTES,
		}),
		tools: Type.Optional(
			Type.Array(
				StringEnum(CORE_TOOL_NAMES, {
					description: "Available Pi core child work tool name.",
				}),
				{
					description:
						"Child tools. Omit for read, grep, find, and ls; use an empty list for no tools.",
				},
			),
		),
		thinkingLevel: Type.Optional(
			StringEnum(JOB_THINKING_LEVELS, {
				description: "Child thinking level. Defaults to the main agent's effective level.",
			}),
		),
		timeout: Type.Optional(
			Type.Number({
				description: "Execution timeout in seconds. Omit for no timeout.",
				exclusiveMinimum: 0,
				maximum: MAX_TIMEOUT_SECONDS,
			}),
		),
	},
	{ additionalProperties: false },
);

export const AwaitParameters = Type.Object(
	{
		jobId: Type.String({
			description: "Current-session job ID.",
			minLength: 1,
			maxLength: MAX_JOB_ID_LENGTH,
		}),
		timeout: Type.Optional(
			Type.Number({
				description: "Maximum time to wait in seconds. Omit to wait until terminal.",
				exclusiveMinimum: 0,
				maximum: MAX_TIMEOUT_SECONDS,
			}),
		),
	},
	{ additionalProperties: false },
);

export const CancelParameters = Type.Object(
	{
		jobId: Type.String({
			description: "Current-session job ID.",
			minLength: 1,
			maxLength: MAX_JOB_ID_LENGTH,
		}),
	},
	{ additionalProperties: false },
);

export const InspectParameters = Type.Object({}, { additionalProperties: false });

export interface JobToolSessionOwner {
	isCurrent(ctx: ExtensionContext): boolean;
	generation(): number;
}

export interface RegisterJobToolsOptions {
	runtime: JobRuntime;
	owner: JobToolSessionOwner;
}

export function registerJobTools(pi: ExtensionAPI, options: RegisterJobToolsOptions): void {
	const { runtime, owner } = options;
	pi.registerTool({
		name: "subagent_spawn",
		label: "Subagent · Spawn",
		description:
			"Start one fresh bounded Pi subprocess for a self-contained background job and return its current-session jobId immediately.",
		promptSnippet: "Use subagent_spawn to start a self-contained bounded background job.",
		promptGuidelines: [
			"Use subagent_await to join a spawned job before relying on its result.",
			"The child receives no parent conversation and cannot communicate before completion.",
		],
		parameters: SpawnParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			assertExactKeys(params, ["task", "tools", "thinkingLevel", "timeout"], "subagent_spawn");
			throwIfAborted(signal, "Subagent spawn was cancelled.");
			assertCurrent(owner, ctx);
			assertNotNested();
			const task = validateTask(params.task);
			const tools = resolveTools(params.tools);
			resolveTimeoutMs(params.timeout);
			const model = resolveChildModel(ctx);
			const thinkingLevel = resolveThinkingLevel(
				params.thinkingLevel ?? ctx.thinkingLevel ?? pi.getThinkingLevel(),
			);
			return toolResult(
				runtime.start({
					task,
					tools,
					model,
					thinkingLevel,
					cwd: ctx.cwd,
					timeout: params.timeout,
					projectTrusted: ctx.isProjectTrusted(),
				}),
			);
		},
	});

	pi.registerTool({
		name: "subagent_await",
		label: "Subagent · Await",
		description:
			"Wait for one current-session job to become terminal. A caller timeout or cancellation ends only this wait and does not cancel the job.",
		promptSnippet: "Use subagent_await to join one current-session subagent job.",
		promptGuidelines: [
			"An await timeout leaves the job active and later awaitable.",
			"Treat completed, partial, failed, timed_out, and cancelled as terminal states.",
		],
		parameters: AwaitParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			assertExactKeys(params, ["jobId", "timeout"], "subagent_await");
			assertCurrent(owner, ctx);
			const result = await runtime.awaitJob(
				requiredIdentifier(params.jobId),
				resolveTimeoutMs(params.timeout),
				signal,
			);
			assertCurrent(owner, ctx);
			return toolResult(result);
		},
	});

	pi.registerTool({
		name: "subagent_cancel",
		label: "Subagent · Cancel",
		description:
			"Idempotently cancel one queued or running current-session job and wait for owned child cleanup. Existing terminal outcomes remain unchanged.",
		promptSnippet: "Use subagent_cancel to stop one current-session subagent job.",
		promptGuidelines: [
			"Cancellation is first-writer-wins and cannot replace an existing terminal result.",
		],
		parameters: CancelParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			assertExactKeys(params, ["jobId"], "subagent_cancel");
			throwIfAborted(signal, "Subagent cancellation was cancelled.");
			assertCurrent(owner, ctx);
			const result = await runtime.cancel(requiredIdentifier(params.jobId));
			assertCurrent(owner, ctx);
			return toolResult(result);
		},
	});

	pi.registerTool({
		name: "subagent_inspect",
		label: "Subagent · Inspect",
		description:
			"Return one privacy-bounded snapshot of current-session job IDs, states, timestamps, and timeout metadata without tasks or child output.",
		promptSnippet: "Use subagent_inspect to inspect bounded current-session subagent job metadata.",
		promptGuidelines: [
			"Inspection never exposes task text, child output, selected tools, prompts, or environment data.",
		],
		parameters: InspectParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			assertExactKeys(params, [], "subagent_inspect");
			throwIfAborted(signal, "Subagent inspection was cancelled.");
			assertCurrent(owner, ctx);
			const snapshot = runtime.inspect();
			return toolResult({ jobs: snapshot.jobs, omitted: { jobs: snapshot.omitted } });
		},
	});
}

export function validateTask(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("Subagent task is required.");
	}
	if (value.includes("\0")) throw new Error("Subagent task must not contain NUL bytes.");
	if (Buffer.byteLength(value, "utf8") > MAX_TASK_BYTES) {
		throw new Error(`Subagent task must be at most ${MAX_TASK_BYTES} UTF-8 bytes.`);
	}
	return value;
}

export function resolveTools(value: unknown): CoreToolName[] {
	if (value === undefined) return [...DEFAULT_JOB_TOOLS];
	if (!Array.isArray(value)) throw new Error("Subagent tools must be an array.");
	const tools: CoreToolName[] = [];
	for (const candidate of value) {
		if (typeof candidate !== "string" || !TOOL_NAME_SET.has(candidate)) {
			const label =
				typeof candidate === "string" ? safeTerminalLine(candidate, 128) : String(candidate);
			throw new Error(
				`Unavailable subagent tool: ${label || "(empty)"}. Available: ${CORE_TOOL_NAMES.join(", ")}.`,
			);
		}
		const tool = candidate as CoreToolName;
		if (!tools.includes(tool)) tools.push(tool);
	}
	return tools;
}

function resolveChildModel(ctx: ExtensionContext): string {
	const model = ctx.model;
	if (!model)
		throw new Error("Subagent model is unavailable because no main-agent model is selected.");
	const registry = ctx.modelRegistry;
	if (registry.getRegisteredProviderIds().includes(model.provider)) {
		throw new Error(
			`Subagent model provider ${safeTerminalLine(model.provider, 128)} is unavailable because children disable parent extensions.`,
		);
	}
	if (registry.getProviderAuthStatus(model.provider).source === "runtime") {
		throw new Error(
			`Subagent model provider ${safeTerminalLine(model.provider, 128)} uses a process-local runtime API key. Configure child-readable credentials.`,
		);
	}
	return `${model.provider}/${model.id}`;
}

function resolveThinkingLevel(value: unknown): JobThinkingLevel {
	if (typeof value !== "string" || !THINKING_LEVEL_SET.has(value)) {
		throw new Error("Subagent thinkingLevel is invalid.");
	}
	return value as JobThinkingLevel;
}

function requiredIdentifier(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_JOB_ID_LENGTH) {
		throw new Error("Subagent jobId is invalid.");
	}
	if (safeTerminalText(value) !== value || value.trim() !== value) {
		throw new Error("Subagent jobId is invalid.");
	}
	return value;
}

function assertExactKeys(
	value: unknown,
	allowed: readonly string[],
	toolName: string,
): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${toolName} arguments must be an object.`);
	}
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
	if (unknown.length > 0)
		throw new Error(
			`${toolName} received unknown field: ${safeTerminalLine(unknown[0] ?? "", 128)}.`,
		);
}

function assertNotNested(): void {
	const depth = Number.parseInt(process.env.PI_SUBAGENT_DEPTH ?? "0", 10);
	if (Number.isFinite(depth) && depth > 0) {
		throw new Error("Nested subagents are not supported by pi-subagents.");
	}
}

function assertCurrent(owner: JobToolSessionOwner, ctx: ExtensionContext): void {
	if (!owner.isCurrent(ctx)) throw abortError("Subagent session was replaced or shut down.");
	void owner.generation();
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
	if (signal?.aborted) throw abortError(message);
}

function abortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

function toolResult<T>(value: T): {
	content: Array<{ type: "text"; text: string }>;
	details: T;
} {
	return {
		content: [{ type: "text", text: safeTerminalText(JSON.stringify(value, null, 2)) }],
		details: value,
	};
}
