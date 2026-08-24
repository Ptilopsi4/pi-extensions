#!/usr/bin/env node

import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
	ASYNC_SUBAGENT_BENCHMARK_VERSION,
	type AsyncSubagentBenchmarkOptions,
	type AsyncSubagentBenchmarkTrialPlan,
	type AsyncSubagentBenchmarkTrialRecord,
	analyzeBenchmarkEvents,
	BenchmarkDeadlineError,
	benchmarkPairCount,
	buildAsyncSubagentBenchmarkPrompt,
	createAlternatingTrialPlan,
	FIXED_BENCHMARK_TASK,
	FIXED_EVIDENCE_RUBRIC,
	parseAsyncSubagentBenchmarkArgs,
	redactBenchmarkValue,
	runAfterReadinessWithDeadline,
	summarizeAsyncSubagentBenchmark,
	withDeadline,
} from "../packages/pi-subagents/src/async-subagent-benchmark.ts";

const help = `Usage:
  just benchmark-async-subagents --model <provider/model> [options]
  just benchmark-async-subagents --run --model <provider/model> --output <file> [options]

Options:
  --mode <quick|extended>       Run 3 or 10 paired trials (default: quick)
  --model <provider/model>      Fixed parent and child model (required)
  --thinking <level>            Fixed thinking level (default: medium)
  --timeout-ms <ms>             Hard deadline after readiness (default: 120000)
  --readiness-timeout-ms <ms>   RPC readiness deadline (default: 15000)
  --output <file>               Redacted JSON record path (required with --run)
  --pi <command>                Pi executable (default: pi)
  --workspace <path>            Benchmark target workspace (default: repository root)
  --extension <path>            Extension entrypoint (default: target pi-subagents source)
  --run                         Execute live-provider trials; otherwise preview only
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
	process.stdout.write(help);
	process.exit(0);
}

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseAsyncSubagentBenchmarkArgs(process.argv.slice(2));
const root = path.resolve(options.workspace ?? sourceRoot);
const extensionPath = options.extension
	? path.resolve(root, options.extension)
	: path.join(root, "packages/pi-subagents/src/index.ts");
const plan = createAlternatingTrialPlan(options.mode);
const configuration = {
	version: ASYNC_SUBAGENT_BENCHMARK_VERSION,
	mode: options.mode,
	pairs: benchmarkPairCount(options.mode),
	model: options.model,
	thinkingLevel: options.thinkingLevel,
	agent: "explorer",
	context: "parent context files disabled; detached child context none",
	task: FIXED_BENCHMARK_TASK,
	evidenceRubric: FIXED_EVIDENCE_RUBRIC,
	timeoutMs: options.timeoutMs,
	readinessTimeoutMs: options.readinessTimeoutMs,
	pairConcurrency: 3,
	environment: {
		node: process.version,
		platform: process.platform,
		architecture: process.arch,
		piCommand: options.piCommand,
		repository: repositoryIdentity(root),
		extensionPath: displayPath(extensionPath, root),
	},
	order: plan,
};

if (!options.run) {
	process.stdout.write(
		`${JSON.stringify(
			{
				...configuration,
				preview: true,
				note: "No provider request was made. Add --run and --output to execute the benchmark.",
			},
			null,
			2,
		)}\n`,
	);
	process.exit(0);
}

const outputPath = path.resolve(options.outputPath as string);
const activeClients = new Set<RpcBenchmarkClient>();
let signalCleanupStarted = false;
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		if (signalCleanupStarted) return;
		signalCleanupStarted = true;
		void Promise.allSettled([...activeClients].map((client) => client.stop())).finally(() => {
			process.exit(signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : 143);
		});
	});
}
const records: AsyncSubagentBenchmarkTrialRecord[] = [];
let writeChain = Promise.resolve();
const persist = async (): Promise<void> => {
	const sorted = [...records].sort(
		(left, right) => left.pairIndex - right.pairIndex || left.orderIndex - right.orderIndex,
	);
	const document = {
		...configuration,
		preview: false,
		generatedAt: new Date().toISOString(),
		rawRecords: sorted,
		summary: summarizeAsyncSubagentBenchmark(sorted),
	};
	await mkdir(path.dirname(outputPath), { recursive: true });
	const temporaryPath = `${outputPath}.${process.pid}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
	await rename(temporaryPath, outputPath);
};
const saveRecord = async (record: AsyncSubagentBenchmarkTrialRecord): Promise<void> => {
	records.push(record);
	writeChain = writeChain.then(persist);
	await writeChain;
};

await persist();
const pairs = groupPairs(plan);
await runPool(pairs, 3, async (pair) => {
	for (const trial of pair) {
		if (signalCleanupStarted) return;
		const record = await runTrial(options, trial, extensionPath, root);
		await saveRecord(record);
		process.stderr.write(
			`pair ${trial.pairIndex + 1}/${configuration.pairs} ${trial.arm}: ${record.outcome}, evidence=${record.evidenceScore}, completion=${record.completionObserved}\n`,
		);
	}
});
await writeChain;
process.stdout.write(
	`${JSON.stringify(
		{
			outputPath,
			summary: summarizeAsyncSubagentBenchmark(records),
		},
		null,
		2,
	)}\n`,
);

async function runTrial(
	options: AsyncSubagentBenchmarkOptions,
	trial: AsyncSubagentBenchmarkTrialPlan,
	extension: string,
	cwd: string,
): Promise<AsyncSubagentBenchmarkTrialRecord> {
	const launchedAt = performance.now();
	const launchedTimestamp = new Date().toISOString();
	const events: unknown[] = [];
	let client: RpcBenchmarkClient | undefined;
	let readinessMs = 0;
	let elapsedMs = 0;
	let cost: number | null = null;
	let outcome: AsyncSubagentBenchmarkTrialRecord["outcome"] = "process-error";
	let readinessTimedOut = false;
	let error: string | undefined;

	try {
		client = startRpcClient(options, trial.arm, extension, cwd, (value) => events.push(value));
		activeClients.add(client);
		try {
			await withDeadline(
				client.request("get_state"),
				options.readinessTimeoutMs,
				"Pi RPC readiness timed out",
			);
		} catch (readinessError) {
			readinessMs = performance.now() - launchedAt;
			readinessTimedOut = readinessError instanceof BenchmarkDeadlineError;
			throw readinessError;
		}
		readinessMs = performance.now() - launchedAt;
		const trialStarted = performance.now();
		await runAfterReadinessWithDeadline(
			Promise.resolve(),
			async () => {
				await client?.request("prompt", {
					message: buildAsyncSubagentBenchmarkPrompt(trial.arm, options.thinkingLevel),
				});
				while (!analyzeBenchmarkEvents(trial.arm, events).resultMarker) {
					await client?.waitForEvent("message_end");
				}
				const stats = await client?.request("get_session_stats");
				cost = benchmarkCost(stats);
			},
			options.timeoutMs,
		);
		elapsedMs = performance.now() - trialStarted;
		const analysis = analyzeBenchmarkEvents(trial.arm, events);
		outcome = analysis.resultMarker ? "completed" : "invalid-output";
	} catch (caught) {
		if (readinessMs > 0 && elapsedMs === 0 && !readinessTimedOut) {
			elapsedMs = Math.max(0, performance.now() - launchedAt - readinessMs);
		}
		outcome = readinessTimedOut
			? "readiness-timeout"
			: caught instanceof BenchmarkDeadlineError
				? "timed-out"
				: classifyError(caught);
		error = errorText(caught);
	} finally {
		await client?.stop();
		if (client) activeClients.delete(client);
	}

	const analysis = redactBenchmarkValue(analyzeBenchmarkEvents(trial.arm, events)) as ReturnType<
		typeof analyzeBenchmarkEvents
	>;
	return {
		version: ASYNC_SUBAGENT_BENCHMARK_VERSION,
		pairIndex: trial.pairIndex,
		orderIndex: trial.orderIndex,
		arm: trial.arm,
		outcome,
		readinessMs: round(readinessMs),
		elapsedMs: round(elapsedMs),
		cost,
		startedAt: launchedTimestamp,
		completedAt: new Date().toISOString(),
		...analysis,
		events: redactBenchmarkValue(events) as unknown[],
		...(client?.stderr ? { stderr: String(redactBenchmarkValue(client.stderr)) } : {}),
		...(error ? { error: String(redactBenchmarkValue(error)) } : {}),
	};
}

function rpcProtocolError(message: string): Error {
	const error = new Error(message);
	error.name = "RpcProtocolError";
	return error;
}

interface RpcResponse extends Record<string, unknown> {
	type: "response";
	success: boolean;
	id?: string;
}

interface RpcBenchmarkClient {
	request(type: string, payload?: Record<string, unknown>): Promise<RpcResponse>;
	waitForEvent(type: string): Promise<Record<string, unknown>>;
	stop(): Promise<void>;
	readonly stderr: string;
}

function startRpcClient(
	options: AsyncSubagentBenchmarkOptions,
	arm: AsyncSubagentBenchmarkTrialPlan["arm"],
	extension: string,
	cwd: string,
	onRecord: (value: unknown) => void,
): RpcBenchmarkClient {
	const agentDir = mkdtempSync(path.join(os.tmpdir(), `pi-subagent-benchmark-${arm}-`));
	copyBenchmarkAuthentication(agentDir);
	writeFileSync(
		path.join(agentDir, "pi-subagents.json"),
		`${JSON.stringify(
			arm === "sync"
				? { blocking: { enabled: true }, stateful: { enabled: false } }
				: {
						blocking: { enabled: false },
						stateful: { enabled: true, completionDelivery: "auto-resume" },
					},
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);
	const child = spawn(
		options.piCommand,
		[
			"--mode",
			"rpc",
			"--no-session",
			"--model",
			options.model,
			"--thinking",
			options.thinkingLevel,
			"--no-extensions",
			"-e",
			extension,
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
			"--no-approve",
		],
		{
			cwd,
			detached: process.platform !== "win32",
			env: { ...process.env, NO_COLOR: "1", PI_CODING_AGENT_DIR: agentDir },
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	return createRpcClient(child, onRecord, () => rmSync(agentDir, { recursive: true, force: true }));
}

function createRpcClient(
	child: ChildProcessWithoutNullStreams,
	onRecord: (value: unknown) => void,
	cleanup: () => void,
): RpcBenchmarkClient {
	let buffer = "";
	let stderr = "";
	let nextId = 0;
	let closed = false;
	let protocolError: Error | undefined;
	const pending = new Map<
		string,
		{ resolve: (response: RpcResponse) => void; reject: (error: Error) => void }
	>();
	const eventWaiters = new Map<
		string,
		Array<{ resolve: (event: Record<string, unknown>) => void; reject: (error: Error) => void }>
	>();

	const fail = (failure: Error): void => {
		protocolError ??= failure;
		for (const request of pending.values()) request.reject(failure);
		pending.clear();
		for (const waiters of eventWaiters.values()) {
			for (const waiter of waiters) waiter.reject(failure);
		}
		eventWaiters.clear();
	};
	const handleLine = (rawLine: string): void => {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (!line) return;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			fail(rpcProtocolError("Pi RPC emitted malformed JSONL"));
			return;
		}
		onRecord(value);
		if (!isRecord(value) || typeof value.type !== "string") return;
		if (value.type === "response" && typeof value.id === "string") {
			const request = pending.get(value.id);
			if (!request) return;
			pending.delete(value.id);
			const response = value as RpcResponse;
			if (response.success) request.resolve(response);
			else request.reject(rpcProtocolError(String(response.error ?? "RPC request failed")));
			return;
		}
		const waiters = eventWaiters.get(value.type);
		const waiter = waiters?.shift();
		if (waiter) waiter.resolve(value);
		if (waiters?.length === 0) eventWaiters.delete(value.type);
	};

	child.stdout.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) break;
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			handleLine(line);
		}
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16 * 1024);
	});
	child.once("error", (caught) => fail(caught));
	child.once("close", (code, signal) => {
		closed = true;
		if (buffer) handleLine(buffer);
		fail(
			protocolError ??
				new Error(
					`Pi RPC exited before completion (code=${code ?? "null"}, signal=${signal ?? "null"})`,
				),
		);
	});

	const request = (type: string, payload: Record<string, unknown> = {}): Promise<RpcResponse> => {
		if (closed || protocolError)
			return Promise.reject(protocolError ?? new Error("Pi RPC is closed"));
		const id = `async_benchmark_${++nextId}`;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`, (caught) => {
				if (!caught) return;
				pending.delete(id);
				reject(caught);
			});
		});
	};
	const waitForEvent = (type: string): Promise<Record<string, unknown>> => {
		if (closed || protocolError)
			return Promise.reject(protocolError ?? new Error("Pi RPC is closed"));
		return new Promise((resolve, reject) => {
			const waiters = eventWaiters.get(type) ?? [];
			waiters.push({ resolve, reject });
			eventWaiters.set(type, waiters);
		});
	};
	const waitForClose = (timeoutMs: number): Promise<boolean> =>
		new Promise((resolve) => {
			if (closed) {
				resolve(true);
				return;
			}
			const timer = setTimeout(() => {
				child.off("close", onClose);
				resolve(false);
			}, timeoutMs);
			const onClose = (): void => {
				clearTimeout(timer);
				resolve(true);
			};
			child.once("close", onClose);
		});
	let stopPromise: Promise<void> | undefined;
	const stop = (): Promise<void> => {
		stopPromise ??= (async () => {
			try {
				if (!closed) {
					child.stdin.end();
					signalProcessGroup(child, "SIGTERM");
					if (!(await waitForClose(500))) {
						signalProcessGroup(child, "SIGKILL");
						await waitForClose(500);
					}
				}
			} finally {
				cleanup();
			}
		})();
		return stopPromise;
	};
	return {
		request,
		waitForEvent,
		stop,
		get stderr() {
			return stderr;
		},
	};
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// Fall back to the immediate process.
		}
	}
	try {
		child.kill(signal);
	} catch {
		// The process may already be gone.
	}
}

function benchmarkCost(response: RpcResponse | undefined): number | null {
	const data = response && isRecord(response.data) ? response.data : undefined;
	return data && typeof data.cost === "number" && Number.isFinite(data.cost) ? data.cost : null;
}

function classifyError(error: unknown): AsyncSubagentBenchmarkTrialRecord["outcome"] {
	return error instanceof Error && error.name === "RpcProtocolError"
		? "protocol-error"
		: "process-error";
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function groupPairs(
	plan: readonly AsyncSubagentBenchmarkTrialPlan[],
): AsyncSubagentBenchmarkTrialPlan[][] {
	const pairs = new Map<number, AsyncSubagentBenchmarkTrialPlan[]>();
	for (const trial of plan) {
		const pair = pairs.get(trial.pairIndex) ?? [];
		pair.push(trial);
		pairs.set(trial.pairIndex, pair);
	}
	return [...pairs.values()].map((pair) =>
		pair.sort((left, right) => left.orderIndex - right.orderIndex),
	);
}

async function runPool<T>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let nextIndex = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (nextIndex < items.length) {
				const item = items[nextIndex++];
				await worker(item);
			}
		}),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyBenchmarkAuthentication(targetDir: string): void {
	const sourceDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	for (const name of ["auth.json", "pi-accounts.json", "models-store.json"] as const) {
		const source = path.join(sourceDir, name);
		try {
			if (!lstatSync(source).isFile()) continue;
			const target = path.join(targetDir, name);
			copyFileSync(source, target);
			chmodSync(target, 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

function displayPath(value: string, cwd: string): string {
	const relative = path.relative(cwd, value);
	if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
	return path.basename(value);
}

function repositoryIdentity(cwd: string): {
	commit: string | null;
	dirty: boolean;
	stateDigest: string | null;
} {
	try {
		const runGit = (args: string[]): Buffer =>
			execFileSync("git", args, {
				cwd,
				encoding: "buffer",
				maxBuffer: 32 * 1024 * 1024,
				stdio: ["ignore", "pipe", "ignore"],
			});
		const commit = runGit(["rev-parse", "HEAD"]).toString("utf8").trim();
		const status = runGit(["status", "--porcelain=v1", "-z"]);
		const hash = createHash("sha256")
			.update(status)
			.update(runGit(["diff", "--binary", "HEAD"]));
		const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z"])
			.toString("utf8")
			.split("\0")
			.filter(Boolean)
			.sort();
		for (const relativePath of untracked) {
			hash
				.update(relativePath)
				.update("\0")
				.update(readFileSync(path.join(cwd, relativePath)));
		}
		return { commit, dirty: status.length > 0, stateDigest: hash.digest("hex") };
	} catch {
		return { commit: null, dirty: true, stateDigest: null };
	}
}

function round(value: number): number {
	return Number(value.toFixed(3));
}
