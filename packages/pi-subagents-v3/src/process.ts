import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { CHILD_COMMUNICATION_TOOL_NAMES } from "./child-communication-tools.js";
import { brokerEnvironment } from "./message-broker.js";
import type { ChildRequest, ChildResult } from "./types.js";

const CORE_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_EVENT_LINE_BYTES = 256 * 1024;
const KILL_GRACE_MS = 1_000;

interface ProcessSettlement {
	code: number;
	cancelled: boolean;
	timedOut: boolean;
	launchError?: string;
}

export function resolveTimeoutMs(timeout: number | undefined): number | undefined {
	if (timeout === undefined) return undefined;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds");
	}
	const timeoutMs = timeout * 1000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
	}
	return timeoutMs;
}

interface AssistantEvent {
	type?: string;
	message?: {
		role?: string;
		content?: Array<{ type?: string; text?: string }>;
		stopReason?: string;
		errorMessage?: string;
	};
}

export async function runChild(request: ChildRequest): Promise<ChildResult> {
	if (request.signal.aborted) return cancelledResult();
	try {
		const invocation = resolvePiInvocation(buildPiArgs(request));
		return await executeProcess(invocation, request);
	} catch (error) {
		if (request.signal.aborted) return cancelledResult();
		return {
			state: "failed",
			error: boundedText(error instanceof Error ? error.message : String(error), MAX_ERROR_BYTES)
				.text,
			limitations: [],
			truncated: false,
		};
	}
}

export function buildPiArgs(request: ChildRequest): string[] {
	const args = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"-e",
		childCommunicationBridgePath(),
		"--model",
		request.model,
		"--thinking",
		request.thinkingLevel,
		request.projectTrusted ? "--approve" : "--no-approve",
	];
	const tools = [...new Set([...request.tools, ...CHILD_COMMUNICATION_TOOL_NAMES])];
	args.push("--tools", tools.join(","));
	args.push(`Task: ${request.task}`);
	return args;
}

export function childCommunicationBridgePath(): string {
	return fileURLToPath(new URL("./child-communication-bridge.ts", import.meta.url));
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
			const text = (event.message.content ?? [])
				.filter((part) => part.type === "text" && typeof part.text === "string")
				.map((part) => part.text)
				.join("\n")
				.trim();
			if (text) {
				const bounded = boundedText(text, MAX_OUTPUT_BYTES);
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
				const bounded = boundedText(event.message.errorMessage, MAX_ERROR_BYTES);
				errorMessage = bounded.text;
				truncated ||= bounded.truncated;
			}
		},
		() => {
			malformedEvents++;
		},
	);

	const settlement = await new Promise<ProcessSettlement>((resolve) => {
		let process: ChildProcess;
		let settled = false;
		let spawned = false;
		let cancelled = false;
		let timedOut = false;
		let deadline: NodeJS.Timeout | undefined;
		let forceClose: NodeJS.Timeout | undefined;
		let escalation: NodeJS.Timeout | undefined;
		const finish = (code: number, launchError?: string) => {
			if (settled) return;
			settled = true;
			if (deadline) clearTimeout(deadline);
			if (forceClose) clearTimeout(forceClose);
			if (escalation) clearTimeout(escalation);
			request.signal.removeEventListener("abort", onAbort);
			resolve({ code, cancelled, timedOut, launchError });
		};
		const terminate = (code: number) => {
			if (settled) return;
			signalProcess(process, "SIGTERM");
			escalation = setTimeout(() => signalProcess(process, "SIGKILL"), KILL_GRACE_MS);
			escalation.unref();
			forceClose = setTimeout(() => {
				decoder.finish();
				process.stdout?.destroy();
				process.stderr?.destroy();
				finish(code);
			}, KILL_GRACE_MS * 2);
			forceClose.unref();
		};
		const onAbort = () => {
			if (settled) return;
			cancelled = true;
			terminate(130);
		};

		try {
			process = spawn(invocation.command, invocation.args, {
				cwd: request.cwd,
				detached: globalThis.process.platform !== "win32",
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...globalThis.process.env,
					...brokerEnvironment(request.communication),
					PI_SUBAGENT_DEPTH: String(
						(Number.parseInt(globalThis.process.env.PI_SUBAGENT_DEPTH ?? "0", 10) || 0) + 1,
					),
				},
			});
		} catch (error) {
			finish(1, error instanceof Error ? error.message : String(error));
			return;
		}
		request.signal.addEventListener("abort", onAbort, { once: true });
		if (request.signal.aborted) onAbort();
		process.once("spawn", () => {
			spawned = true;
			if (settled || cancelled || timeoutMs === undefined) return;
			deadline = setTimeout(() => {
				timedOut = true;
				terminate(124);
			}, timeoutMs);
			deadline.unref();
		});
		process.stdout?.on("data", (chunk) => decoder.push(chunk));
		process.stderr?.on("data", (chunk) => {
			const bounded = boundedTail(`${stderr}${chunk.toString()}`, MAX_ERROR_BYTES);
			stderr = bounded.text;
			truncated ||= bounded.truncated;
		});
		process.once("close", (code) => {
			decoder.finish();
			finish(cancelled ? 130 : timedOut ? 124 : (code ?? 1));
		});
		process.once("error", (error) => {
			const bounded = boundedText(error.message, MAX_ERROR_BYTES);
			errorMessage = bounded.text;
			truncated ||= bounded.truncated;
			if (spawned) terminate(1);
			else finish(1, error.message);
		});
	});

	const output = terminalOutput ?? latestOutput;
	const limitations =
		malformedEvents > 0
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
	return {
		state: "failed",
		error: failure,
		limitations,
		truncated,
	};
}

function resolvePiInvocation(args: string[]): { command: string; args: string[] } {
	const packageDirectory = fs.realpathSync(getPackageDir());
	const manifestPath = path.join(packageDirectory, "package.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
		name?: string;
		bin?: { pi?: string };
	};
	if (manifest.name !== CORE_PACKAGE_NAME || typeof manifest.bin?.pi !== "string") {
		throw new Error("Loaded Pi core package does not declare a valid bin.pi entry.");
	}
	const declared = manifest.bin.pi;
	if (path.isAbsolute(declared)) throw new Error("Pi core bin.pi must be package-relative.");
	const cliPath = fs.realpathSync(path.resolve(packageDirectory, declared));
	const relative = path.relative(packageDirectory, cliPath);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error("Pi core bin.pi escapes its package directory.");
	}
	if (!fs.statSync(cliPath).isFile()) throw new Error("Pi core bin.pi is not a file.");
	if (
		globalThis.process.versions.bun &&
		/^pi(?:\.exe)?$/iu.test(path.basename(globalThis.process.execPath)) &&
		path.dirname(fs.realpathSync(globalThis.process.execPath)) === packageDirectory
	) {
		return { command: globalThis.process.execPath, args };
	}
	return { command: globalThis.process.execPath, args: [cliPath, ...args] };
}

function signalProcess(process: ChildProcess, signal: NodeJS.Signals): void {
	if (globalThis.process.platform !== "win32" && process.pid) {
		try {
			globalThis.process.kill(-process.pid, signal);
			return;
		} catch {
			// Fall back to the immediate child.
		}
	}
	try {
		process.kill(signal);
	} catch {
		// The process may already be terminal.
	}
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

function boundedText(text: string, maxBytes: number): { text: string; truncated: boolean } {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= maxBytes) return { text, truncated: false };
	return {
		text: `${bytes
			.subarray(0, Math.max(0, maxBytes - 18))
			.toString("utf8")
			.replace(/�+$/gu, "")}\n… [truncated]`,
		truncated: true,
	};
}

function boundedTail(text: string, maxBytes: number): { text: string; truncated: boolean } {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= maxBytes) return { text, truncated: false };
	return {
		text: `… [truncated]\n${bytes
			.subarray(bytes.length - Math.max(0, maxBytes - 18))
			.toString("utf8")
			.replace(/^�+/gu, "")}`,
		truncated: true,
	};
}

class JsonLineDecoder {
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
