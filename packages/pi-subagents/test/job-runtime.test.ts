import assert from "node:assert/strict";
import { test } from "vitest";
import { JobRuntime } from "../src/job-runtime.js";
import type { ChildRequest, ChildResult, StartJobInput } from "../src/job-types.js";

const terminalStates = ["completed", "partial", "failed", "timed_out", "cancelled"] as const;

test("bounded runtime accepts every terminal state and delivers each completion once", async () => {
	const deliveries: string[] = [];
	let counter = 0;
	const runtime = new JobRuntime({
		createJobId: () => `job_${++counter}`,
		runChild: async (request) => result(request.task as (typeof terminalStates)[number]),
		deliverCompletion: (value) => deliveries.push(`${value.jobId}:${value.state}`),
	});
	runtime.beginSession();
	const jobs = terminalStates.map((state) => runtime.start(input(state)));
	for (const [index, job] of jobs.entries()) {
		const waited = await runtime.awaitJob(job.jobId);
		assert.equal(waited.state, terminalStates[index]);
		assert.equal(waited.timedOut, false);
	}
	assert.deepEqual(
		deliveries,
		terminalStates.map((state, index) => `job_${index + 1}:${state}`),
	);
	await runtime.shutdown();
});

test("await timeout and caller cancellation do not cancel an active job", async () => {
	let release!: (value: ChildResult) => void;
	const runtime = new JobRuntime({
		createJobId: () => "job_wait",
		runChild: () => new Promise((resolve) => (release = resolve)),
	});
	runtime.beginSession();
	const job = runtime.start(input("pending"));
	await Promise.resolve();
	const timed = await runtime.awaitJob(job.jobId, 1);
	assert.equal(timed.timedOut, true);
	assert.equal(timed.state, "running");
	const controller = new AbortController();
	const cancelledWait = runtime.awaitJob(job.jobId, undefined, controller.signal);
	controller.abort();
	await assert.rejects(cancelledWait, (error: Error) => error.name === "AbortError");
	assert.equal(runtime.inspect().jobs[0]?.state, "running");
	release(result("completed"));
	assert.equal((await runtime.awaitJob(job.jobId)).state, "completed");
	await runtime.shutdown();
});

test("cancellation is idempotent and wins over stale child settlement", async () => {
	let request!: ChildRequest;
	let release!: (value: ChildResult) => void;
	const deliveries: string[] = [];
	const runtime = new JobRuntime({
		createJobId: () => "job_cancel",
		runChild: (value) => {
			request = value;
			return new Promise((resolve) => {
				release = resolve;
				value.signal.addEventListener("abort", () => resolve(result("completed")), { once: true });
			});
		},
		deliverCompletion: (value) => deliveries.push(value.state),
	});
	runtime.beginSession();
	const job = runtime.start(input("pending"));
	await Promise.resolve();
	const first = await runtime.cancel(job.jobId);
	const second = await runtime.cancel(job.jobId);
	assert.equal(request.signal.aborted, true);
	assert.deepEqual(first, { jobId: job.jobId, state: "cancelled" });
	assert.deepEqual(second, first);
	release(result("completed"));
	await Promise.resolve();
	assert.equal((await runtime.awaitJob(job.jobId)).state, "cancelled");
	assert.deepEqual(deliveries, ["cancelled"]);
	await runtime.shutdown();
});

test("runtime enforces eight active jobs and retains thirty-two newest terminal summaries", async () => {
	let counter = 0;
	const pending = new JobRuntime({
		createJobId: () => `active_${++counter}`,
		runChild: waitForAbort,
	});
	pending.beginSession();
	const active = Array.from({ length: 8 }, (_, index) => pending.start(input(`pending-${index}`)));
	assert.throws(() => pending.start(input("ninth")), /limit reached \(8\)/u);
	await Promise.all(active.map((job) => pending.cancel(job.jobId)));
	await pending.shutdown();

	counter = 0;
	const terminal = new JobRuntime({
		createJobId: () => `terminal_${++counter}`,
		runChild: async () => result("completed"),
	});
	terminal.beginSession();
	for (let index = 0; index < 33; index += 1) {
		const job = terminal.start(input(`done-${index}`));
		await terminal.awaitJob(job.jobId);
	}
	const snapshot = terminal.inspect();
	assert.equal(snapshot.jobs.length, 32);
	assert.equal(snapshot.omitted, 1);
	assert.equal(snapshot.jobs[0]?.jobId, "terminal_2");
	await assert.rejects(() => terminal.awaitJob("terminal_1"), /Unknown or expired/u);
	await terminal.shutdown();
});

test("shutdown cancels queued work before launch and clears all session state", async () => {
	let launches = 0;
	const runtime = new JobRuntime({
		createJobId: () => "job_queued",
		runChild: async () => {
			launches += 1;
			return result("completed");
		},
	});
	runtime.beginSession();
	runtime.start(input("queued"));
	await runtime.shutdown();
	assert.equal(launches, 0);
	assert.deepEqual(runtime.inspect(), { jobs: [], omitted: 0 });
});

function input(task: string): StartJobInput {
	return {
		task,
		tools: ["read"],
		model: "test/model",
		thinkingLevel: "medium",
		cwd: process.cwd(),
		projectTrusted: false,
	};
}

function result(state: (typeof terminalStates)[number]): ChildResult {
	return {
		state,
		...(state === "completed" || state === "partial" ? { result: state } : {}),
		...(state === "completed" ? {} : { error: state }),
		limitations: [],
		truncated: false,
	};
}

async function waitForAbort(request: ChildRequest): Promise<ChildResult> {
	if (!request.signal.aborted) {
		await new Promise<void>((resolve) =>
			request.signal.addEventListener("abort", () => resolve(), { once: true }),
		);
	}
	return result("cancelled");
}
