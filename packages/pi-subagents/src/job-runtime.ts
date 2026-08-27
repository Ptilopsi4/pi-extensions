import { randomUUID } from "node:crypto";
import {
	type ActiveJobDisplay,
	type ChildRequest,
	type ChildResult,
	type CoreToolName,
	isTerminalState,
	type JobResult,
	type JobState,
	type JobSummary,
	MAX_ACTIVE_JOBS,
	MAX_ERROR_BYTES,
	MAX_RESULT_BYTES,
	MAX_RESULT_LINES,
	MAX_RETAINED_TERMINAL_JOBS,
	type StartJobInput,
} from "./job-types.js";
import { TRUNCATION_MARKER, truncateUtf8 } from "./safe-text.js";

interface InternalJob extends JobSummary {
	controller: AbortController;
	tools: CoreToolName[];
	terminal: Promise<void>;
	resolveTerminal: () => void;
	task?: Promise<void>;
	result?: string;
	error?: string;
	limitations: string[];
	deliveryAttempted: boolean;
	generation: number;
}

export interface JobRuntimeDependencies {
	runChild: (request: ChildRequest) => Promise<ChildResult>;
	deliverCompletion?: (result: JobResult, generation: number) => void;
	now?: () => number;
	createJobId?: () => string;
}

export class JobRuntime {
	private readonly jobs = new Map<string, InternalJob>();
	private readonly listeners = new Set<() => void>();
	private readonly now: () => number;
	private readonly createJobId: () => string;
	private generation = 0;
	private sessionActive = false;
	private omittedJobs = 0;

	constructor(private readonly dependencies: JobRuntimeDependencies) {
		this.now = dependencies.now ?? Date.now;
		this.createJobId = dependencies.createJobId ?? (() => `job_${randomUUID()}`);
	}

	beginSession(): number {
		if (this.sessionActive) throw new Error("Subagent runtime session is already active.");
		this.generation += 1;
		this.jobs.clear();
		this.omittedJobs = 0;
		this.sessionActive = true;
		this.notifyChanged();
		return this.generation;
	}

	get currentGeneration(): number {
		return this.generation;
	}

	get active(): boolean {
		return this.sessionActive;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	start(input: StartJobInput): { jobId: string; state: "queued"; timeout?: number } {
		if (!this.sessionActive) {
			throw new Error("Subagent runtime is unavailable because the session is not active.");
		}
		const activeCount = [...this.jobs.values()].filter((job) => !isTerminalState(job.state)).length;
		if (activeCount >= MAX_ACTIVE_JOBS) {
			throw new Error(`Active subagent job limit reached (${MAX_ACTIVE_JOBS}).`);
		}
		const jobId = this.uniqueJobId();
		let resolveTerminal!: () => void;
		const terminal = new Promise<void>((resolve) => {
			resolveTerminal = resolve;
		});
		const job: InternalJob = {
			jobId,
			state: "queued",
			createdAt: this.now(),
			...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
			controller: new AbortController(),
			tools: [...input.tools],
			terminal,
			resolveTerminal,
			limitations: [],
			deliveryAttempted: false,
			generation: this.generation,
		};
		this.jobs.set(jobId, job);
		this.notifyChanged();
		job.task = Promise.resolve().then(() => this.launch(job, input));
		return {
			jobId,
			state: "queued",
			...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
		};
	}

	inspect(): { jobs: JobSummary[]; omitted: number } {
		return {
			jobs: [...this.jobs.values()]
				.sort((left, right) => left.createdAt - right.createdAt)
				.map((job) => this.summary(job)),
			omitted: this.omittedJobs,
		};
	}

	activeJobsForDisplay(): ActiveJobDisplay[] {
		const now = this.now();
		return [...this.jobs.values()]
			.filter(
				(job): job is InternalJob & { state: "queued" | "running" } => !isTerminalState(job.state),
			)
			.sort((left, right) => left.createdAt - right.createdAt)
			.map((job) => ({
				...this.summary(job),
				state: job.state,
				elapsedMs: Math.max(0, now - (job.startedAt ?? job.createdAt)),
				tools: [...job.tools],
			}));
	}

	async awaitJob(jobId: string, timeoutMs?: number, signal?: AbortSignal): Promise<JobResult> {
		const job = this.requireJob(jobId);
		if (isTerminalState(job.state)) return this.result(job, false);
		if (signal?.aborted) throw abortError("Subagent await was cancelled.", signal.reason);
		let timeout: NodeJS.Timeout | undefined;
		let onAbort: (() => void) | undefined;
		try {
			const outcome = await Promise.race([
				job.terminal.then(() => "terminal" as const),
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
			if (outcome === "aborted") throw abortError("Subagent await was cancelled.", signal?.reason);
			if (isTerminalState(job.state)) return this.result(job, false);
			return this.result(job, outcome === "timeout");
		} finally {
			if (timeout) clearTimeout(timeout);
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
		}
	}

	async cancel(jobId: string): Promise<{ jobId: string; state: JobState }> {
		const job = this.requireJob(jobId);
		if (!isTerminalState(job.state)) {
			this.terminalize(
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

	async shutdown(): Promise<void> {
		if (!this.sessionActive) return;
		this.sessionActive = false;
		const jobs = [...this.jobs.values()];
		for (const job of jobs) {
			if (isTerminalState(job.state)) continue;
			this.terminalize(
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
		await Promise.allSettled(jobs.map((job) => job.task));
		this.generation += 1;
		this.jobs.clear();
		this.omittedJobs = 0;
		this.notifyChanged();
	}

	private async launch(job: InternalJob, input: StartJobInput): Promise<void> {
		if (!this.owns(job) || job.state !== "queued") return;
		job.state = "running";
		job.startedAt = this.now();
		this.notifyChanged();
		let child: ChildResult;
		try {
			child = await this.dependencies.runChild({
				...input,
				tools: [...input.tools],
				signal: job.controller.signal,
			});
		} catch (error) {
			child = {
				state: job.controller.signal.aborted ? "cancelled" : "failed",
				error: error instanceof Error ? error.message : String(error),
				limitations: [],
				truncated: false,
			};
		}
		if (!this.owns(job) || job.state !== "running") return;
		this.terminalize(job, child, true);
	}

	private terminalize(job: InternalJob, child: ChildResult, deliver: boolean): boolean {
		if (isTerminalState(job.state)) return false;
		const normalized = normalizeChildResult(child);
		job.state = normalized.state;
		job.finishedAt = this.now();
		job.result = normalized.result;
		job.error = normalized.error;
		job.limitations = [...normalized.limitations];
		job.resolveTerminal();
		this.notifyChanged();
		if (deliver) this.deliver(job);
		this.prune();
		return true;
	}

	private deliver(job: InternalJob): void {
		if (
			job.deliveryAttempted ||
			!this.sessionActive ||
			job.generation !== this.generation ||
			!this.dependencies.deliverCompletion
		) {
			return;
		}
		job.deliveryAttempted = true;
		try {
			this.dependencies.deliverCompletion(this.result(job, false), job.generation);
		} catch {
			// The terminal result remains available through subagent_await.
		}
	}

	private result(job: InternalJob, timedOut: boolean): JobResult {
		return {
			...this.summary(job),
			timedOut,
			...(!timedOut && job.result !== undefined ? { result: job.result } : {}),
			...(!timedOut && job.error !== undefined ? { error: job.error } : {}),
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
		};
	}

	private owns(job: InternalJob): boolean {
		return (
			this.sessionActive && job.generation === this.generation && this.jobs.get(job.jobId) === job
		);
	}

	private requireJob(jobId: string): InternalJob {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error("Unknown or expired subagent job.");
		return job;
	}

	private prune(): void {
		const terminal = [...this.jobs.values()]
			.filter((job) => isTerminalState(job.state))
			.sort(
				(left, right) =>
					(left.finishedAt ?? left.createdAt) - (right.finishedAt ?? right.createdAt),
			);
		for (const job of terminal.slice(
			0,
			Math.max(0, terminal.length - MAX_RETAINED_TERMINAL_JOBS),
		)) {
			if (this.jobs.delete(job.jobId)) this.omittedJobs += 1;
		}
	}

	private uniqueJobId(): string {
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const candidate = this.createJobId();
			if (!this.jobs.has(candidate)) return candidate;
		}
		throw new Error("Unable to allocate a unique subagent job ID.");
	}

	private notifyChanged(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// Observers cannot interrupt lifecycle cleanup.
			}
		}
	}
}

function normalizeChildResult(child: ChildResult): ChildResult {
	const result = child.result === undefined ? undefined : boundRaw(child.result, MAX_RESULT_BYTES);
	const error = child.error === undefined ? undefined : truncateUtf8(child.error, MAX_ERROR_BYTES);
	const limitations = child.limitations
		.slice(0, 16)
		.map((value) => truncateUtf8(value, 2 * 1024).text);
	const truncated =
		child.truncated ||
		(result?.truncated ?? false) ||
		(error?.truncated ?? false) ||
		limitations.length < child.limitations.length;
	if (truncated && !limitations.some((value) => /truncat/iu.test(value))) {
		limitations.push("Child result was truncated to runtime limits.");
	}
	return {
		state: child.state,
		...(result ? { result: result.text } : {}),
		...(error ? { error: error.text } : {}),
		limitations,
		truncated,
	};
}

function boundRaw(value: string, maxBytes: number): { text: string; truncated: boolean } {
	const lines = value.split("\n");
	const lineBounded =
		lines.length > MAX_RESULT_LINES
			? `${lines.slice(0, MAX_RESULT_LINES - 1).join("\n")}${TRUNCATION_MARKER}`
			: value;
	const bounded = truncateUtf8(lineBounded, maxBytes);
	return { text: bounded.text, truncated: lines.length > MAX_RESULT_LINES || bounded.truncated };
}

function abortError(message: string, reason?: unknown): Error {
	if (reason instanceof Error && reason.name === "AbortError") return reason;
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}
