import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const WRITER_PATTERN =
	/^runtime-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/u;
const MAX_EVENT_BYTES = 8 * 1024;
const WRITE_TIMEOUT_MS = 2_000;

export interface UsageEventStorePort {
	readonly path: string;
	append(event: unknown): Promise<void>;
	prune(retentionDays: number): Promise<void>;
	close(): Promise<void>;
}

export class UsageEventStore implements UsageEventStorePort {
	readonly path: string;
	private readonly writerPath: string;
	private mutationTail: Promise<void> = Promise.resolve();
	private readonly lifecycle = new AbortController();
	private closed = false;

	constructor(rootPath: string, options: { createId?: () => string; now?: () => number } = {}) {
		this.path = rootPath;
		this.createId = options.createId ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.writerPath = path.join(rootPath, `runtime-${validId(this.createId())}.jsonl`);
	}

	private readonly createId: () => string;
	private readonly now: () => number;

	append(event: unknown): Promise<void> {
		if (this.closed) return Promise.reject(new Error("Usage recording storage is closed."));
		const frame = encodeEvent(event);
		return this.enqueue(() =>
			withTimeout(
				(signal) => this.appendFrame(frame, signal),
				this.lifecycle.signal,
				WRITE_TIMEOUT_MS,
				"Usage recording write timed out",
			),
		);
	}

	prune(retentionDays: number): Promise<void> {
		if (this.closed) return Promise.reject(new Error("Usage recording storage is closed."));
		return this.enqueue(() =>
			withTimeout(
				async (signal) => {
					await ensurePrivateDirectory(this.path);
					signal.throwIfAborted();
					const cutoff = this.now() - retentionDays * 24 * 60 * 60 * 1000;
					for (const entry of await readdir(this.path, { withFileTypes: true })) {
						signal.throwIfAborted();
						if (!entry.isFile() || !WRITER_PATTERN.test(entry.name)) continue;
						const candidate = path.join(this.path, entry.name);
						if (candidate === this.writerPath) continue;
						let metadata: Awaited<ReturnType<typeof lstat>>;
						try {
							metadata = await lstat(candidate);
						} catch (error) {
							if (isNodeError(error) && error.code === "ENOENT") continue;
							throw error;
						}
						if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.mtimeMs >= cutoff) {
							continue;
						}
						await rm(candidate, { force: true });
					}
				},
				this.lifecycle.signal,
				WRITE_TIMEOUT_MS,
				"Usage recording retention cleanup timed out",
			),
		);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.lifecycle.abort(new DOMException("Usage recording storage closed", "AbortError"));
		await this.mutationTail;
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const result = this.mutationTail.then(operation);
		this.mutationTail = result.catch(() => undefined);
		return result;
	}

	private async appendFrame(frame: string, signal: AbortSignal): Promise<void> {
		await ensurePrivateDirectory(this.path);
		signal.throwIfAborted();
		await assertOptionalPrivateRegularFile(this.writerPath);
		signal.throwIfAborted();
		await writeFile(this.writerPath, frame, {
			encoding: "utf8",
			flag: "a",
			mode: 0o600,
			signal,
		});
		if (process.platform !== "win32") await chmod(this.writerPath, 0o600);
	}
}

export function encodeEvent(event: unknown): string {
	const frame = `${JSON.stringify(event)}\n`;
	if (Buffer.byteLength(frame) > MAX_EVENT_BYTES) {
		throw new Error("Usage recording event exceeds the storage bound.");
	}
	return frame;
}

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
	try {
		const metadata = await lstat(directoryPath);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error("Usage recording storage must be a regular directory, not a link.");
		}
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ENOENT") throw error;
		await mkdir(directoryPath, { recursive: true, mode: 0o700 });
		const metadata = await lstat(directoryPath);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error("Usage recording storage must be a regular directory, not a link.");
		}
	}
	if (process.platform !== "win32") await chmod(directoryPath, 0o700);
}

async function assertOptionalPrivateRegularFile(filePath: string): Promise<void> {
	try {
		const metadata = await lstat(filePath);
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error("Usage recording writers must be regular files, not links.");
		}
		if (process.platform !== "win32") await chmod(filePath, 0o600);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return;
		throw error;
	}
}

async function withTimeout<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	lifecycleSignal: AbortSignal,
	timeoutMs: number,
	message: string,
): Promise<T> {
	lifecycleSignal.throwIfAborted();
	const controller = new AbortController();
	const abortLifecycle = () =>
		controller.abort(
			lifecycleSignal.reason ?? new DOMException("Usage recording storage closed", "AbortError"),
		);
	lifecycleSignal.addEventListener("abort", abortLifecycle, { once: true });
	const timer = setTimeout(
		() => controller.abort(new DOMException(message, "TimeoutError")),
		timeoutMs,
	);
	try {
		return await operation(controller.signal);
	} catch (error) {
		if (controller.signal.aborted) throw controller.signal.reason;
		throw error;
	} finally {
		clearTimeout(timer);
		lifecycleSignal.removeEventListener("abort", abortLifecycle);
	}
}

function validId(value: string): string {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
		throw new Error("Usage recording storage received an invalid writer identity.");
	}
	return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
