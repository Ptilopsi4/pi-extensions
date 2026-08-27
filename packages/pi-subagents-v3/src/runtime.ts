import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type MessageBroker, sanitizeTerminalText } from "./message-broker.js";
import { runChild as defaultRunChild } from "./process.js";
import {
	type ChildRequest,
	type ChildResult,
	type JobSummary,
	type SubagentJobState,
	type SubagentThinkingLevel,
	TERMINAL_JOB_STATES,
} from "./types.js";

const MAX_ACTIVE_JOBS = 8;
const MAX_RETAINED_TERMINAL_JOBS = 32;
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1_000;
const COMPLETION_MESSAGE_TYPE = "pi-subagents-v3-completion";

interface InternalJob extends JobSummary {
	controller: AbortController;
	tools: string[];
	terminal: Promise<void>;
	resolveTerminal: () => void;
	task?: Promise<void>;
	result?: string;
	error?: string;
	limitations: string[];
	deliverySent: boolean;
	generation: number;
}

export interface RuntimeDependencies {
	runChild?: (request: ChildRequest) => Promise<ChildResult>;
	now?: () => number;
}

export interface ActiveJobDisplay {
	jobId: string;
	state: Extract<SubagentJobState, "queued" | "running">;
	elapsedMs: number;
	timeout?: number;
	tools: string[];
}

export interface StartJobInput {
	task: string;
	tools: string[];
	model: string;
	thinkingLevel: SubagentThinkingLevel;
	cwd: string;
	timeout?: number;
	projectTrusted: boolean;
}

export class SubagentRuntime {
	private readonly jobs = new Map<string, InternalJob>();
	private readonly runChild: (request: ChildRequest) => Promise<ChildResult>;
	private readonly now: () => number;
	private counter = 0;
	private generation = 0;
	private deliveryEnabled = false;
	private sessionActive = false;
	private omittedJobs = 0;
	private readonly jobListeners = new Set<() => void>();

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly broker: MessageBroker,
		dependencies: RuntimeDependencies = {},
	) {
		this.runChild = dependencies.runChild ?? defaultRunChild;
		this.now = dependencies.now ?? Date.now;
	}

	beginSession(): void {
		if (this.sessionActive) throw new Error("Subagent runtime session is already active.");
		this.generation++;
		this.jobs.clear();
		this.omittedJobs = 0;
		this.deliveryEnabled = true;
		this.sessionActive = true;
		this.notifyJobsChanged();
	}

	subscribeJobs(listener: () => void): () => void {
		this.jobListeners.add(listener);
		return () => this.jobListeners.delete(listener);
	}

	activeJobsForDisplay(): ActiveJobDisplay[] {
		const now = this.now();
		return [...this.jobs.values()]
			.filter((job): job is InternalJob & { state: "queued" | "running" } => !isTerminal(job.state))
			.sort((left, right) => left.createdAt - right.createdAt)
			.map((job) => ({
				jobId: job.jobId,
				state: job.state,
				elapsedMs: Math.max(0, now - (job.startedAt ?? job.createdAt)),
				...(job.timeout !== undefined ? { timeout: job.timeout } : {}),
				tools: [...job.tools],
			}));
	}

	start(input: StartJobInput): { jobId: string; state: "queued"; timeout?: number } {
		if (!this.sessionActive) {
			throw new Error("Subagent runtime is unavailable because the session is not active.");
		}
		this.broker.assertReady();
		this.prune();
		const active = [...this.jobs.values()].filter((job) => !isTerminal(job.state)).length;
		if (active >= MAX_ACTIVE_JOBS) {
			throw new Error(`Active subagent job limit reached (${MAX_ACTIVE_JOBS}).`);
		}
		const jobId = `job_${this.now().toString(36)}_${(++this.counter).toString(36)}`;
		const communication = this.broker.issueCredentials({
			jobId,
			generation: this.generation,
		});
		let resolveTerminal!: () => void;
		const terminal = new Promise<void>((resolve) => {
			resolveTerminal = resolve;
		});
		const controller = new AbortController();
		const job: InternalJob = {
			jobId,
			state: "queued",
			createdAt: this.now(),
			...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
			controller,
			tools: [...input.tools],
			terminal,
			resolveTerminal,
			limitations: [],
			deliverySent: false,
			generation: this.generation,
		};
		this.jobs.set(jobId, job);
		this.notifyJobsChanged();
		job.task = Promise.resolve().then(async () => {
			if (job.state !== "queued" || job.generation !== this.generation) return;
			job.state = "running";
			job.startedAt = this.now();
			this.notifyJobsChanged();
			let child: ChildResult;
			try {
				child = await this.runChild({
					task: input.task,
					tools: [...input.tools],
					model: input.model,
					thinkingLevel: input.thinkingLevel,
					cwd: input.cwd,
					timeout: input.timeout,
					projectTrusted: input.projectTrusted,
					communication,
					signal: controller.signal,
				});
			} catch (error) {
				child = {
					state: controller.signal.aborted ? "cancelled" : "failed",
					error: error instanceof Error ? error.message : String(error),
					limitations: [],
					truncated: false,
				};
			}
			if (job.state !== "running" || job.generation !== this.generation) return;
			this.finish(job, child, true);
		});
		return {
			jobId,
			state: "queued",
			...(job.timeout !== undefined ? { timeout: job.timeout } : {}),
		};
	}

	inspectJobs(): { jobs: JobSummary[]; omitted: number } {
		this.prune();
		return {
			jobs: [...this.jobs.values()]
				.sort((left, right) => left.createdAt - right.createdAt)
				.map((job) => this.summary(job)),
			omitted: this.omittedJobs,
		};
	}

	async cancel(jobId: string): Promise<{ jobId: string; state: SubagentJobState }> {
		const job = this.requireJob(jobId);
		if (!isTerminal(job.state)) {
			this.finish(
				job,
				{
					state: "cancelled",
					error: "Subagent execution was cancelled.",
					limitations: [],
					truncated: false,
				},
				true,
			);
			job.controller.abort(new DOMException("Subagent job cancelled", "AbortError"));
		}
		await job.task;
		return { jobId, state: job.state };
	}

	async wait(
		jobId: string,
		timeoutMs: number | undefined,
		signal?: AbortSignal,
	): Promise<{
		jobId: string;
		state: SubagentJobState;
		timedOut: boolean;
		interrupted?: true;
		reason?: "subagent_message";
		result?: string;
		error?: string;
		limitations?: string[];
	}> {
		const job = this.requireJob(jobId);
		if (isTerminal(job.state)) return this.waitResult(job, false);
		if (signal?.aborted) throw abortError("Subagent wait was cancelled");
		if (this.broker.hasPendingQuestion()) return this.interruptedWaitResult(job);
		let timeout: NodeJS.Timeout | undefined;
		let onAbort: (() => void) | undefined;
		let unsubscribeQuestion: () => void = () => undefined;
		const question = new Promise<"question">((resolve) => {
			unsubscribeQuestion = this.broker.subscribePendingQuestion(() => resolve("question"));
		});
		const outcome = await Promise.race([
			job.terminal.then(() => "terminal" as const),
			question,
			...(timeoutMs !== undefined
				? [
						new Promise<"timeout">((resolve) => {
							timeout = setTimeout(() => resolve("timeout"), timeoutMs);
							timeout.unref();
						}),
					]
				: []),
			...(signal
				? [
						new Promise<"aborted">((resolve) => {
							onAbort = () => resolve("aborted");
							signal.addEventListener("abort", onAbort, { once: true });
						}),
					]
				: []),
		]);
		if (timeout) clearTimeout(timeout);
		if (signal && onAbort) signal.removeEventListener("abort", onAbort);
		unsubscribeQuestion();
		if (outcome === "aborted") throw abortError("Subagent wait was cancelled");
		if (outcome === "question") return this.interruptedWaitResult(job);
		if (isTerminal(job.state)) return this.waitResult(job, false);
		return this.waitResult(job, outcome === "timeout");
	}

	async shutdown(): Promise<void> {
		if (!this.sessionActive) return;
		this.deliveryEnabled = false;
		this.sessionActive = false;
		this.generation++;
		const active = [...this.jobs.values()].filter((job) => !isTerminal(job.state));
		for (const job of active) {
			this.finish(
				job,
				{
					state: "cancelled",
					error: "Subagent session shut down.",
					limitations: [],
					truncated: false,
				},
				false,
			);
			job.controller.abort(new DOMException("Subagent session shut down", "AbortError"));
		}
		await Promise.allSettled(active.map((job) => job.task));
		this.notifyJobsChanged();
	}

	private notifyJobsChanged(): void {
		for (const listener of this.jobListeners) {
			try {
				listener();
			} catch {
				// UI observers cannot interrupt the job lifecycle.
			}
		}
	}

	private finish(job: InternalJob, child: ChildResult, deliver: boolean): void {
		if (isTerminal(job.state)) return;
		job.state = child.state;
		job.finishedAt = this.now();
		job.result = child.result;
		job.error = child.error;
		job.limitations = [...child.limitations];
		this.broker.revokeJob(job.jobId);
		job.resolveTerminal();
		this.notifyJobsChanged();
		if (deliver) this.deliver(job);
		this.prune();
	}

	private deliver(job: InternalJob): void {
		if (!this.deliveryEnabled || job.deliverySent || job.generation !== this.generation) return;
		job.deliverySent = true;
		const payload = this.waitResult(job, false);
		try {
			this.pi.sendMessage(
				{
					customType: COMPLETION_MESSAGE_TYPE,
					content: `Subagent job completion:\n${sanitizeTerminalText(JSON.stringify(payload))}`,
					display: true,
					details: payload,
				},
				{ deliverAs: "steer" },
			);
		} catch {
			// Completion remains available through wait and inspect.
		}
	}

	private interruptedWaitResult(job: InternalJob) {
		return {
			jobId: job.jobId,
			state: job.state,
			timedOut: false,
			interrupted: true as const,
			reason: "subagent_message" as const,
		};
	}

	private waitResult(job: InternalJob, timedOut: boolean) {
		return {
			jobId: job.jobId,
			state: job.state,
			timedOut,
			...(!timedOut && job.result ? { result: job.result } : {}),
			...(!timedOut && job.error ? { error: job.error } : {}),
			...(!timedOut && job.limitations.length > 0 ? { limitations: [...job.limitations] } : {}),
		};
	}

	private summary(job: InternalJob): JobSummary {
		return {
			jobId: job.jobId,
			state: job.state,
			createdAt: job.createdAt,
			...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
			...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
			...(job.timeout !== undefined ? { timeout: job.timeout } : {}),
			...(job.resultSummary !== undefined ? { resultSummary: job.resultSummary } : {}),
			...(job.errorSummary !== undefined ? { errorSummary: job.errorSummary } : {}),
		};
	}

	private requireJob(jobId: string): InternalJob {
		this.prune();
		const job = this.jobs.get(jobId);
		if (!job) throw new Error("Unknown or expired subagent job.");
		return job;
	}

	private prune(): void {
		const now = this.now();
		const expired = [...this.jobs.values()].filter(
			(job) =>
				isTerminal(job.state) && (job.finishedAt ?? job.createdAt) < now - TERMINAL_RETENTION_MS,
		);
		for (const job of expired) {
			if (this.jobs.delete(job.jobId)) this.omittedJobs++;
		}
		const terminal = [...this.jobs.values()]
			.filter((job) => isTerminal(job.state))
			.sort((left, right) => (left.finishedAt ?? 0) - (right.finishedAt ?? 0));
		for (const job of terminal.slice(
			0,
			Math.max(0, terminal.length - MAX_RETAINED_TERMINAL_JOBS),
		)) {
			if (this.jobs.delete(job.jobId)) this.omittedJobs++;
		}
	}
}

function isTerminal(state: SubagentJobState): boolean {
	return TERMINAL_JOB_STATES.has(state);
}

function abortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}
