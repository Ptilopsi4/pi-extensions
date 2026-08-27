import { type ChildProcess, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
	type ChildRequest,
	type ChildResult,
	MAX_ERROR_BYTES,
	MAX_RESULT_BYTES,
	MAX_RESULT_LINES,
	MAX_TIMEOUT_MS,
	MAX_TIMEOUT_SECONDS,
} from "./job-types.js";
import { resolvePiInvocation } from "./pi-invocation.js";
import { terminateProcess } from "./process-control.js";
import { TRUNCATION_MARKER, truncateUtf8, truncateUtf8Tail } from "./safe-text.js";

const MAX_EVENT_LINE_BYTES = 256 * 1024;
const TERMINATION_GRACE_MS = 1_000;
const FORCE_CLOSE_MS = 2_500;

interface AssistantEvent {
	type?: string;
	message?: {
		role?: string;
		content?: Array<{ type?: string; text?: string }>;
		stopReason?: string;
		errorMessage?: string;
	};
}

interface ProcessSettlement {
	code: number;
	cancelled: boolean;
	timedOut: boolean;
	launchError?: string;
}

export function resolveTimeoutMs(timeout: number | undefined): number | undefined {
	if (timeout === undefined) return undefined;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds.");
	}
	const timeoutMs = timeout * 1_000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds.`);
	}
	return timeoutMs;
}

export function buildPiArgs(request: Omit<ChildRequest, "signal">): string[] {
	const args = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--model",
		request.model,
		"--thinking",
		request.thinkingLevel,
		request.projectTrusted ? "--approve" : "--no-approve",
	];
	if (request.tools.length === 0) args.push("--no-builtin-tools");
	else args.push("--tools", request.tools.join(","));
	args.push(`Task: ${request.task}`);
	return args;
}

export async function runChild(request: ChildRequest): Promise<ChildResult> {
	if (request.signal.aborted) return cancelledResult();
	try {
		return await executeProcess(resolvePiInvocation(buildPiArgs(request)), request);
	} catch (error) {
		if (request.signal.aborted) return cancelledResult();
		return {
			state: "failed",
			error: truncateUtf8(error instanceof Error ? error.message : String(error), MAX_ERROR_BYTES)
				.text,
			limitations: [],
			truncated: false,
		};
	}
}

async function executeProcess(
	invocation: { command: string; args: string[] },
	request: ChildRequest,
): Promise<ChildResult> {
	const timeoutMs = resolveTimeoutMs(request.timeout);
	let latestOutput = "";
	let terminalOutput: string | undefined;
	let terminalStopReason: "stop" | "length" | undefined;
	let errorMessage = "";
	let assistantFailed = false;
	let stderr = "";
	let truncated = false;
	let malformedEvents = 0;
	const decoder = new JsonLineDecoder(
		(value) => {
			const event = value as AssistantEvent;
			if (event.type !== "message_end" || event.message?.role !== "assistant") return;
			const rawText = (event.message.content ?? [])
				.filter((part) => part.type === "text" && typeof part.text === "string")
				.map((part) => part.text)
				.join("\n")
				.trim();
			if (rawText) {
				const bounded = boundRawText(rawText, MAX_RESULT_BYTES, MAX_RESULT_LINES);
				latestOutput = bounded.text;
				truncated ||= bounded.truncated;
				if (event.message.stopReason === "stop" || event.message.stopReason === "length") {
					terminalOutput = bounded.text;
					terminalStopReason = event.message.stopReason;
				}
			}
			if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
				assistantFailed = true;
			}
			if (event.message.errorMessage) {
				const bounded = truncateUtf8(event.message.errorMessage, MAX_ERROR_BYTES);
				errorMessage = bounded.text;
				truncated ||= bounded.truncated;
			}
		},
		() => {
			malformedEvents += 1;
		},
	);

	const settlement = await new Promise<ProcessSettlement>((resolve) => {
		let child: ChildProcess;
		let settled = false;
		let spawned = false;
		let cancelled = false;
		let timedOut = false;
		let deadline: NodeJS.Timeout | undefined;
		let forceClose: NodeJS.Timeout | undefined;
		let stopTermination: (() => void) | undefined;
		const finish = (code: number, launchError?: string) => {
			if (settled) return;
			settled = true;
			if (deadline) clearTimeout(deadline);
			if (forceClose) clearTimeout(forceClose);
			stopTermination?.();
			request.signal.removeEventListener("abort", onAbort);
			resolve({ code, cancelled, timedOut, launchError });
		};
		const terminate = (code: number) => {
			if (settled || stopTermination) return;
			stopTermination = terminateProcess(child as ReturnType<typeof spawn>, TERMINATION_GRACE_MS);
			forceClose = setTimeout(() => {
				decoder.finish();
				child.stdout?.destroy();
				child.stderr?.destroy();
				finish(code);
			}, FORCE_CLOSE_MS);
			forceClose.unref();
		};
		const onAbort = () => {
			if (settled) return;
			cancelled = true;
			terminate(130);
		};

		try {
			child = spawn(invocation.command, invocation.args, {
				cwd: request.cwd,
				detached: process.platform !== "win32",
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: childEnvironment(),
			});
		} catch (error) {
			finish(1, error instanceof Error ? error.message : String(error));
			return;
		}
		request.signal.addEventListener("abort", onAbort, { once: true });
		if (request.signal.aborted) onAbort();
		child.once("spawn", () => {
			spawned = true;
			if (settled || cancelled || timeoutMs === undefined) return;
			deadline = setTimeout(() => {
				timedOut = true;
				terminate(124);
			}, timeoutMs);
			deadline.unref();
		});
		child.stdout?.on("data", (chunk) => decoder.push(chunk));
		child.stderr?.on("data", (chunk) => {
			const bounded = truncateUtf8Tail(`${stderr}${chunk.toString()}`, MAX_ERROR_BYTES);
			stderr = bounded.text;
			truncated ||= bounded.truncated;
		});
		child.once("close", (code) => {
			decoder.finish();
			finish(cancelled ? 130 : timedOut ? 124 : (code ?? 1));
		});
		child.once("error", (error) => {
			const bounded = truncateUtf8(error.message, MAX_ERROR_BYTES);
			errorMessage = bounded.text;
			truncated ||= bounded.truncated;
			if (spawned) terminate(1);
			else finish(1, error.message);
		});
	});

	const output = terminalOutput ?? latestOutput;
	const limitations = malformedEvents
		? [`Ignored ${malformedEvents} malformed or oversized child event(s).`]
		: [];
	if (truncated) limitations.push("Child output was truncated to runtime limits.");
	if (terminalStopReason === "length") {
		limitations.push("Child output ended at the model output limit and may be incomplete.");
	}
	if (settlement.cancelled) return cancelledResult(output, limitations, truncated);
	if (settlement.timedOut) {
		return {
			state: "timed_out",
			...(output ? { result: output } : {}),
			error: "Subagent execution timed out.",
			limitations,
			truncated,
		};
	}
	const error = settlement.launchError || errorMessage || stderr.trim();
	if (settlement.code === 0 && terminalStopReason === "stop" && !assistantFailed && !errorMessage) {
		return {
			state: "completed",
			result: terminalOutput,
			limitations,
			truncated,
		};
	}
	const failure =
		error ||
		(terminalStopReason === "length"
			? "Subagent output reached the model limit."
			: assistantFailed
				? "Subagent model turn failed."
				: settlement.code === 0
					? "Subagent exited without a terminal assistant result."
					: `Subagent exited with code ${settlement.code}.`);
	if (output) {
		return {
			state: "partial",
			result: output,
			error: failure,
			limitations,
			truncated,
		};
	}
	return { state: "failed", error: failure, limitations, truncated };
}

function boundRawText(
	value: string,
	maxBytes: number,
	maxLines: number,
): { text: string; truncated: boolean } {
	const lines = value.split("\n");
	const lineBounded =
		lines.length > maxLines
			? `${lines.slice(0, Math.max(0, maxLines - 1)).join("\n")}${TRUNCATION_MARKER}`
			: value;
	const bounded = truncateUtf8(lineBounded, maxBytes);
	return { text: bounded.text, truncated: lines.length > maxLines || bounded.truncated };
}

function childEnvironment(): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	delete environment.PI_SUBAGENT_PEER_HOST;
	delete environment.PI_SUBAGENT_PEER_PORT;
	delete environment.PI_SUBAGENT_PEER_TOKEN;
	environment.PI_SUBAGENT_DEPTH = String(parentDepth() + 1);
	return environment;
}

function parentDepth(): number {
	const parsed = Number.parseInt(process.env.PI_SUBAGENT_DEPTH ?? "0", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function cancelledResult(
	result?: string,
	limitations: string[] = [],
	truncated = false,
): ChildResult {
	return {
		state: "cancelled",
		...(result ? { result } : {}),
		error: "Subagent execution was cancelled.",
		limitations,
		truncated,
	};
}

export class JsonLineDecoder {
	private buffer = "";
	private dropping = false;
	private readonly decoder = new StringDecoder("utf8");

	constructor(
		private readonly onValue: (value: unknown) => void,
		private readonly onMalformed: () => void,
	) {}

	push(chunk: Buffer | string): void {
		this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
		this.drain(false);
	}

	finish(): void {
		this.buffer += this.decoder.end();
		this.drain(true);
		this.buffer = "";
		this.dropping = false;
	}

	private drain(flush: boolean): void {
		while (true) {
			const newline = this.buffer.indexOf("\n");
			if (newline < 0) break;
			const line = this.buffer.slice(0, newline).replace(/\r$/u, "");
			this.buffer = this.buffer.slice(newline + 1);
			if (this.dropping) {
				this.dropping = false;
				continue;
			}
			this.parse(line);
		}
		if (!flush && Buffer.byteLength(this.buffer, "utf8") > MAX_EVENT_LINE_BYTES) {
			this.onMalformed();
			this.buffer = "";
			this.dropping = true;
		}
		if (flush && this.buffer && !this.dropping) this.parse(this.buffer.replace(/\r$/u, ""));
	}

	private parse(line: string): void {
		if (!line.trim()) return;
		if (Buffer.byteLength(line, "utf8") > MAX_EVENT_LINE_BYTES) {
			this.onMalformed();
			return;
		}
		try {
			this.onValue(JSON.parse(line));
		} catch {
			this.onMalformed();
		}
	}
}
