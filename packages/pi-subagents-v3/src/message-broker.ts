import { randomBytes, randomUUID } from "node:crypto";
import net, { type AddressInfo, type Server, type Socket } from "node:net";
import type { BrokerCredentials } from "./types.js";

export const BROKER_HOST = "127.0.0.1" as const;
export const BROKER_ENV = {
	host: "PI_SUBAGENT_BROKER_HOST",
	port: "PI_SUBAGENT_BROKER_PORT",
	token: "PI_SUBAGENT_BROKER_TOKEN",
} as const;
export const MAX_MESSAGE_BYTES = 50 * 1024;
export const MAX_FRAME_BYTES = 384 * 1024;
export const MAX_ERROR_BYTES = 8 * 1024;
export const MAX_RESPONSE_LINES = 2_000;
export const MAX_OUTSTANDING_REQUESTS = 4;
export const MAX_IDENTIFIER_LENGTH = 128;

const MAX_CONNECTIONS = 32;
const REQUEST_FRAME_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_RETAINED_CONSUMED_REQUESTS = 4;

export interface BrokerQuestion {
	requestId: string;
	jobId: string;
	message: string;
}

export interface BrokerReplyAcknowledgement {
	requestId: string;
	accepted: boolean;
	duplicate: boolean;
}

export interface MessageBrokerOptions {
	onQuestion(question: BrokerQuestion): void;
	createServer?: (listener: (socket: Socket) => void) => Server;
	now?: () => number;
	requestFrameTimeoutMs?: number;
}

interface JobRecord {
	jobId: string;
	generation: number;
	token: string;
}

interface RequestWaiter {
	socket: Socket;
	timer?: NodeJS.Timeout;
}

interface QuestionRecord extends BrokerQuestion {
	createdAt: number;
	answer?: string;
	consumedAt?: number;
	waiter?: RequestWaiter;
}

type BrokerRequest =
	| { type: "ask"; token: string; message: string }
	| { type: "wait"; token: string; requestId: string; timeoutMs?: number };

/** Session-scoped authenticated loopback transport for child questions and main-agent replies. */
export class MessageBroker {
	private server?: Server;
	private starting?: Promise<void>;
	private address?: { host: typeof BROKER_HOST; port: number };
	private failure?: string;
	private generation = 0;
	private readonly sockets = new Set<Socket>();
	private readonly jobsByToken = new Map<string, JobRecord>();
	private readonly tokenByJob = new Map<string, string>();
	private readonly questions = new Map<string, QuestionRecord>();
	private readonly pendingQuestionListeners = new Set<() => void>();
	private readonly createServer: (listener: (socket: Socket) => void) => Server;
	private readonly now: () => number;
	private readonly requestFrameTimeoutMs: number;

	constructor(private readonly options: MessageBrokerOptions) {
		this.createServer = options.createServer ?? ((listener) => net.createServer(listener));
		this.now = options.now ?? Date.now;
		this.requestFrameTimeoutMs = options.requestFrameTimeoutMs ?? REQUEST_FRAME_TIMEOUT_MS;
		if (!Number.isFinite(this.requestFrameTimeoutMs) || this.requestFrameTimeoutMs <= 0) {
			throw new Error("Subagent broker frame timeout must be positive.");
		}
	}

	async start(): Promise<void> {
		if (this.server && this.address && !this.failure) return;
		if (this.starting) return this.starting;
		const ownerGeneration = ++this.generation;
		this.failure = undefined;
		this.starting = new Promise<void>((resolve, reject) => {
			const server = this.createServer((socket) => this.accept(socket));
			server.maxConnections = MAX_CONNECTIONS;
			const onStartError = (error: Error) => {
				server.close(() => undefined);
				reject(error);
			};
			server.once("error", onStartError);
			server.listen({ host: BROKER_HOST, port: 0 }, () => {
				server.off("error", onStartError);
				if (ownerGeneration !== this.generation) {
					server.close(() => undefined);
					reject(new Error("Subagent message broker start was superseded."));
					return;
				}
				const address = server.address();
				if (!isLoopbackAddress(address)) {
					server.close(() => undefined);
					reject(new Error("Subagent message broker did not bind to loopback."));
					return;
				}
				this.server = server;
				this.address = { host: BROKER_HOST, port: address.port };
				server.on("error", (error) => this.fail(error));
				server.unref();
				resolve();
			});
		})
			.catch((error) => {
				const message = boundedError(error instanceof Error ? error.message : String(error));
				this.failure = message;
				throw new Error(`Subagent message broker failed to start: ${message}`);
			})
			.finally(() => {
				this.starting = undefined;
			});
		return this.starting;
	}

	assertReady(): void {
		if (this.server && this.address && !this.failure) return;
		throw new Error(
			this.failure
				? `Subagent messaging is unavailable: ${this.failure}`
				: "Subagent messaging is unavailable because the session broker is not ready.",
		);
	}

	issueCredentials(input: { jobId: string; generation: number }): BrokerCredentials {
		this.assertReady();
		if (this.tokenByJob.has(input.jobId)) {
			throw new Error(`Subagent messaging credentials already exist for ${input.jobId}.`);
		}
		const token = randomBytes(32).toString("hex");
		const record: JobRecord = { ...input, token };
		this.jobsByToken.set(token, record);
		this.tokenByJob.set(input.jobId, token);
		return { host: BROKER_HOST, port: this.address?.port ?? 0, token };
	}

	revokeJob(jobId: string, reason = "Subagent job is no longer active."): void {
		const token = this.tokenByJob.get(jobId);
		if (token) {
			this.tokenByJob.delete(jobId);
			this.jobsByToken.delete(token);
		}
		for (const question of [...this.questions.values()]) {
			if (question.jobId !== jobId) continue;
			if (question.waiter) this.respondError(question.waiter.socket, reason);
			this.clearWaiter(question);
			this.questions.delete(question.requestId);
		}
	}

	reply(requestId: string, message: string): BrokerReplyAcknowledgement {
		this.assertReady();
		validateRequestId(requestId);
		validateMessage(message, "Subagent reply");
		if (lineCount(message) > MAX_RESPONSE_LINES) {
			throw new Error(`Subagent reply must contain at most ${MAX_RESPONSE_LINES} lines.`);
		}
		const question = this.questions.get(requestId);
		if (!question) throw new Error("Unknown or expired subagent request.");
		if (question.answer !== undefined) {
			return { requestId, accepted: false, duplicate: true };
		}
		question.answer = message;
		if (question.waiter) {
			const socket = question.waiter.socket;
			this.clearWaiter(question);
			this.respond(socket, { ok: true, response: message }, () => this.markConsumed(question));
		}
		return { requestId, accepted: true, duplicate: false };
	}

	hasPendingQuestion(): boolean {
		return [...this.questions.values()].some((question) => question.answer === undefined);
	}

	subscribePendingQuestion(listener: () => void): () => void {
		this.pendingQuestionListeners.add(listener);
		if (this.hasPendingQuestion()) listener();
		return () => this.pendingQuestionListeners.delete(listener);
	}

	async shutdown(): Promise<void> {
		++this.generation;
		const starting = this.starting;
		if (starting) await starting.catch(() => undefined);
		for (const jobId of [...this.tokenByJob.keys()]) {
			this.revokeJob(jobId, "Subagent session shut down.");
		}
		this.questions.clear();
		this.pendingQuestionListeners.clear();
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		const server = this.server;
		this.server = undefined;
		this.address = undefined;
		this.failure = undefined;
		if (!server?.listening) return;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	private accept(socket: Socket): void {
		if (!this.server || this.failure || this.sockets.size >= MAX_CONNECTIONS) {
			socket.destroy();
			return;
		}
		this.sockets.add(socket);
		socket.setNoDelay(true);
		let frame = Buffer.alloc(0);
		let handled = false;
		const frameTimer = setTimeout(() => {
			if (handled) return;
			handled = true;
			this.respondError(socket, "Subagent broker request frame timed out.");
		}, this.requestFrameTimeoutMs);
		frameTimer.unref();
		const cleanup = () => {
			clearTimeout(frameTimer);
			this.sockets.delete(socket);
			for (const question of this.questions.values()) {
				if (question.waiter?.socket === socket) this.clearWaiter(question);
			}
		};
		socket.on("data", (chunk: Buffer) => {
			if (handled) return;
			frame = Buffer.concat([frame, chunk]);
			if (frame.byteLength > MAX_FRAME_BYTES) {
				handled = true;
				clearTimeout(frameTimer);
				this.respondError(socket, "Subagent broker request exceeded its size limit.");
				return;
			}
			const newline = frame.indexOf(0x0a);
			if (newline < 0) return;
			handled = true;
			clearTimeout(frameTimer);
			socket.removeAllListeners("data");
			const trailing = frame
				.subarray(newline + 1)
				.toString("utf8")
				.trim();
			if (trailing) {
				this.respondError(socket, "Subagent broker accepts one request per connection.");
				return;
			}
			this.handleFrame(socket, frame.subarray(0, newline).toString("utf8"));
		});
		socket.once("close", cleanup);
		socket.once("error", cleanup);
	}

	private handleFrame(socket: Socket, frame: string): void {
		let request: BrokerRequest;
		try {
			const parsed = JSON.parse(frame) as unknown;
			if (!isRecord(parsed)) throw new Error();
			request = parsed as BrokerRequest;
		} catch {
			this.respondError(socket, "Malformed subagent broker request.");
			return;
		}
		const job = typeof request.token === "string" ? this.jobsByToken.get(request.token) : undefined;
		if (!job) {
			this.respondError(socket, "Unauthenticated subagent broker request.");
			return;
		}
		try {
			if (request.type === "ask") {
				this.handleAsk(socket, job, request);
				return;
			}
			if (request.type === "wait") {
				this.handleWait(socket, job, request);
				return;
			}
			throw new Error("Unsupported subagent broker request.");
		} catch (error) {
			this.respondError(socket, error instanceof Error ? error.message : String(error));
		}
	}

	private handleAsk(socket: Socket, job: JobRecord, request: BrokerRequest): void {
		if (request.type !== "ask" || typeof request.message !== "string") {
			throw new Error("Subagent ask requires a message string.");
		}
		validateMessage(request.message, "Subagent question");
		const outstanding = [...this.questions.values()].filter(
			(question) => question.jobId === job.jobId && question.consumedAt === undefined,
		).length;
		if (outstanding >= MAX_OUTSTANDING_REQUESTS) {
			throw new Error(
				`Subagent job may have at most ${MAX_OUTSTANDING_REQUESTS} outstanding requests.`,
			);
		}
		const question: QuestionRecord = {
			requestId: `req_${randomUUID()}`,
			jobId: job.jobId,
			message: request.message,
			createdAt: this.now(),
		};
		this.questions.set(question.requestId, question);
		try {
			this.options.onQuestion({
				requestId: question.requestId,
				jobId: question.jobId,
				message: question.message,
			});
		} catch (error) {
			this.questions.delete(question.requestId);
			throw error;
		}
		for (const listener of [...this.pendingQuestionListeners]) listener();
		this.respond(socket, { ok: true, requestId: question.requestId });
	}

	private handleWait(socket: Socket, job: JobRecord, request: BrokerRequest): void {
		if (request.type !== "wait" || typeof request.requestId !== "string") {
			throw new Error("Subagent wait requires a request ID.");
		}
		validateRequestId(request.requestId);
		if (request.timeoutMs !== undefined) validateTimeout(request.timeoutMs);
		const question = this.questions.get(request.requestId);
		if (!question || question.jobId !== job.jobId) {
			throw new Error("Unknown or expired subagent request.");
		}
		if (question.consumedAt !== undefined && question.answer !== undefined) {
			this.respond(socket, { ok: true, response: question.answer });
			return;
		}
		if (question.answer !== undefined) {
			this.respond(socket, { ok: true, response: question.answer }, () =>
				this.markConsumed(question),
			);
			return;
		}
		if (question.waiter) {
			throw new Error(`A wait is already active for subagent request ${request.requestId}.`);
		}
		const waiter: RequestWaiter = { socket };
		question.waiter = waiter;
		if (request.timeoutMs !== undefined) {
			waiter.timer = setTimeout(() => {
				if (question.waiter !== waiter) return;
				this.clearWaiter(question);
				this.respondError(socket, "Subagent response wait timed out.");
			}, request.timeoutMs);
			waiter.timer.unref();
		}
	}

	private markConsumed(question: QuestionRecord): void {
		if (this.questions.get(question.requestId) !== question || question.answer === undefined)
			return;
		question.consumedAt ??= this.now();
		const consumed = [...this.questions.values()]
			.filter(
				(candidate) => candidate.jobId === question.jobId && candidate.consumedAt !== undefined,
			)
			.sort((left, right) => (left.consumedAt ?? 0) - (right.consumedAt ?? 0));
		for (const expired of consumed.slice(
			0,
			Math.max(0, consumed.length - MAX_RETAINED_CONSUMED_REQUESTS),
		)) {
			this.questions.delete(expired.requestId);
		}
	}

	private clearWaiter(question: QuestionRecord): void {
		if (question.waiter?.timer) clearTimeout(question.waiter.timer);
		question.waiter = undefined;
	}

	private respondError(socket: Socket, error: string): void {
		this.respond(socket, { ok: false, error: boundedError(error) });
	}

	private respond(socket: Socket, value: Record<string, unknown>, onFlushed?: () => void): void {
		if (socket.destroyed) return;
		let content = `${JSON.stringify(value)}\n`;
		if (Buffer.byteLength(content, "utf8") > MAX_FRAME_BYTES) {
			content = `${JSON.stringify({ ok: false, error: "Subagent broker response exceeded its size limit." })}\n`;
		}
		socket.end(content, onFlushed);
	}

	private fail(error: Error): void {
		this.failure = boundedError(error.message);
		for (const jobId of [...this.tokenByJob.keys()]) {
			this.revokeJob(jobId, "Subagent message broker failed.");
		}
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		this.address = undefined;
	}
}

export function brokerEnvironment(credentials: BrokerCredentials): NodeJS.ProcessEnv {
	return {
		[BROKER_ENV.host]: credentials.host,
		[BROKER_ENV.port]: String(credentials.port),
		[BROKER_ENV.token]: credentials.token,
	};
}

export function validateMessage(message: string, label: string): void {
	if (!message.trim()) throw new Error(`${label} is required.`);
	if (message.includes("\0")) throw new Error(`${label} must not contain NUL bytes.`);
	if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) {
		throw new Error(`${label} must be at most ${MAX_MESSAGE_BYTES} UTF-8 bytes.`);
	}
}

export function sanitizeTerminalText(value: string): string {
	return [...value]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			if (character === "\n" || character === "\t") return true;
			if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return false;
			return !(
				(codePoint >= 0x202a && codePoint <= 0x202e) ||
				(codePoint >= 0x2066 && codePoint <= 0x2069)
			);
		})
		.join("");
}

function validateRequestId(requestId: string): void {
	if (
		requestId.length > MAX_IDENTIFIER_LENGTH ||
		!/^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestId)
	) {
		throw new Error("Invalid subagent request ID.");
	}
}

function validateTimeout(timeoutMs: number): void {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error("Subagent wait timeout is outside the supported range.");
	}
}

function lineCount(value: string): number {
	let count = 1;
	for (const character of value) if (character === "\n") count++;
	return count;
}

function boundedError(error: string): string {
	const bytes = Buffer.from(error, "utf8");
	if (bytes.length <= MAX_ERROR_BYTES) return error;
	return `${bytes
		.subarray(0, Math.max(0, MAX_ERROR_BYTES - 18))
		.toString("utf8")
		.replace(/�+$/gu, "")}\n… [truncated]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackAddress(address: AddressInfo | string | null): address is AddressInfo {
	return Boolean(address && typeof address !== "string" && address.address === BROKER_HOST);
}
