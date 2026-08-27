import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export const JOB_STATES = [
	"queued",
	"running",
	"completed",
	"partial",
	"failed",
	"timed_out",
	"cancelled",
] as const;

export type JobState = (typeof JOB_STATES)[number];
export type ActiveJobState = Extract<JobState, "queued" | "running">;
export type TerminalJobState = Exclude<JobState, ActiveJobState>;

export const TERMINAL_JOB_STATES = new Set<JobState>([
	"completed",
	"partial",
	"failed",
	"timed_out",
	"cancelled",
]);

export const CORE_TOOL_NAMES = [
	"read",
	"bash",
	"powershell",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
] as const;
export type CoreToolName = (typeof CORE_TOOL_NAMES)[number];

export const DEFAULT_JOB_TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
] as const satisfies readonly CoreToolName[];

export const JOB_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ModelThinkingLevel[];
export type JobThinkingLevel = (typeof JOB_THINKING_LEVELS)[number];

export const MAX_TASK_BYTES = 50 * 1024;
export const MAX_TIMEOUT_MS = 2_147_483_647;
export const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1_000;
export const MAX_ACTIVE_JOBS = 8;
export const MAX_RETAINED_TERMINAL_JOBS = 32;
export const MAX_JOB_ID_LENGTH = 128;
export const MAX_RESULT_BYTES = 32 * 1024;
export const MAX_ERROR_BYTES = 8 * 1024;
export const MAX_RESULT_LINES = 2_000;

export interface ChildRequest {
	task: string;
	tools: CoreToolName[];
	model: string;
	thinkingLevel: JobThinkingLevel;
	cwd: string;
	timeout?: number;
	projectTrusted: boolean;
	signal: AbortSignal;
}

export interface ChildResult {
	state: TerminalJobState;
	result?: string;
	error?: string;
	limitations: string[];
	truncated: boolean;
}

export interface StartJobInput extends Omit<ChildRequest, "signal"> {}

export interface JobSummary {
	jobId: string;
	state: JobState;
	createdAt: number;
	startedAt?: number;
	finishedAt?: number;
	timeout?: number;
}

export interface ActiveJobDisplay extends JobSummary {
	state: ActiveJobState;
	elapsedMs: number;
	tools: CoreToolName[];
}

export interface JobResult extends JobSummary {
	timedOut: boolean;
	result?: string;
	error?: string;
	limitations?: string[];
}

export function isTerminalState(state: JobState): state is TerminalJobState {
	return TERMINAL_JOB_STATES.has(state);
}
