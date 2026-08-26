import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, SubagentThinkingLevel } from "./agents/types.js";
import { revokeCapabilityGrant } from "./capability-grant.js";
import {
	appendBounded,
	DEFAULT_MAX_CONTEXT_BYTES,
	DEFAULT_MAX_MESSAGES,
	DEFAULT_MAX_OUTPUT_BYTES,
	DEFAULT_MAX_STDERR_BYTES,
	MAX_SUBAGENT_TIMEOUT_MS,
	truncateUtf8,
} from "./limits.js";
import { classifyStructuredOutcome } from "./outcome.js";
import { buildPiArgs } from "./pi-args.js";
import { resolvePiInvocation } from "./pi-invocation.js";
import { KILL_GRACE_MS, terminateProcess } from "./process-control.js";
import { JsonLineDecoder } from "./protocol.js";
import { parseAnyStructuredSubagentResult } from "./result-contract.js";
import { formatResultFailure, getResultFinalOutput, isResultError } from "./runner-outcome.js";
import { getFinalOutput } from "./runner-result.js";
import type { ChildLaunchPolicy, RecentActivityItem, SingleResult } from "./runner-types.js";
import {
	addUsageValue,
	mergeUsageStats,
	protocolUsageCost,
	protocolUsageCount,
} from "./runner-usage.js";
import type { OnUpdateCallback, SubagentDetails } from "./subagent-details.js";
import {
	formatTimeoutCheckpoint,
	formatTurnTerminationMessage,
	journalMessages,
	TimeoutProgressJournal,
	TURN_TERMINATION_VERSION,
} from "./timeout-checkpoint.js";
import {
	buildTimeoutFinalizationPrompt,
	resolveTimeoutFinalizationMs,
} from "./timeout-finalization.js";
import { TurnBudgetMonitor, type TurnBudgetStop } from "./turn-budget.js";

export type { PiArgsOptions } from "./pi-args.js";
export { buildPiArgs } from "./pi-args.js";
export { KILL_GRACE_MS, terminateProcess } from "./process-control.js";
export {
	formatResultFailure,
	getResultFinalOutput,
	isResultError,
} from "./runner-outcome.js";
export type { ChildLaunchPolicy, RecentActivityItem, SingleResult } from "./runner-types.js";
export type { UsageStats } from "./runner-usage.js";
export type { OnUpdateCallback, SubagentDetails } from "./subagent-details.js";

const MAX_RECENT_ACTIVITY_ITEMS = 10;
const MAX_RECENT_ACTIVITY_BYTES = 8 * 1024;
const MAX_RECENT_ACTIVITY_ARGUMENT_BYTES = 1024;

function boundMessageText(
	message: Message,
	maxBytes: number,
): { message?: Message; bytes: number; truncated: boolean } {
	const originalBytes = Buffer.byteLength(JSON.stringify(message), "utf8");
	if (Number.isSafeInteger(maxBytes) && maxBytes >= 0 && originalBytes <= maxBytes) {
		return { message, bytes: originalBytes, truncated: false };
	}
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return { bytes: 0, truncated: true };

	const content: Array<
		| { type: "text"; text: string }
		| { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
	> = [];
	const bounded = () => ({ ...message, content }) as Message;
	const fits = () => Buffer.byteLength(JSON.stringify(bounded()), "utf8") <= maxBytes;
	const addText = (text: string, prepend = false) => {
		if (!text.trim()) return;
		const part = { type: "text" as const, text: "" };
		if (prepend) content.unshift(part);
		else content.push(part);
		if (!fits()) {
			content.splice(content.indexOf(part), 1);
			return;
		}
		let low = 0;
		let high = Buffer.byteLength(text, "utf8");
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			part.text = truncateUtf8(text, middle).text;
			if (fits()) low = middle;
			else high = middle - 1;
		}
		part.text = truncateUtf8(text, low).text;
		if (!part.text.trim()) content.splice(content.indexOf(part), 1);
	};
	const addToolCall = (part: Extract<Message["content"][number], { type: "toolCall" }>) => {
		const toolCall = {
			type: "toolCall" as const,
			id: part.id,
			name: part.name,
			arguments: part.arguments,
		};
		content.unshift(toolCall);
		if (fits()) return;
		const arguments_: Record<string, unknown> = {};
		for (const key of ["command", "path", "file_path", "pattern", "url"]) {
			const value = part.arguments[key];
			if (typeof value === "string") arguments_[key] = truncateUtf8(value, 256).text;
		}
		toolCall.arguments = arguments_;
		if (fits()) return;
		toolCall.arguments = {};
		if (!fits()) content.shift();
	};

	if (message.role === "assistant") {
		for (let index = message.content.length - 1; index >= 0; index--) {
			const part = message.content[index];
			if (part.type === "text") addText(part.text, true);
			else if (part.type === "toolCall") addToolCall(part);
		}
	} else {
		for (const part of message.content) {
			if (typeof part === "object" && part && part.type === "text") addText(part.text);
		}
	}

	if (content.length === 0) return { bytes: 0, truncated: true };
	const result = bounded();
	const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
	return { message: result, bytes, truncated: true };
}
function compactRecentActivityArguments(args: Record<string, unknown>): Record<string, unknown> {
	if (Buffer.byteLength(JSON.stringify(args), "utf8") <= MAX_RECENT_ACTIVITY_ARGUMENT_BYTES)
		return args;
	const compact: Record<string, unknown> = {};
	for (const key of ["command", "path", "file_path", "pattern", "url", "selector"]) {
		const value = args[key];
		if (typeof value === "string") compact[key] = truncateUtf8(value, 256).text;
		else if (typeof value === "number" || typeof value === "boolean") compact[key] = value;
	}
	return compact;
}

function appendRecentActivity(result: SingleResult, message: Message): void {
	if (message.role !== "assistant") return;
	const append = (item: RecentActivityItem) => {
		result.recentActivity ??= [];
		result.recentActivityTotal = (result.recentActivityTotal ?? 0) + 1;
		result.recentActivity.push(item);
		if (result.recentActivity.length > MAX_RECENT_ACTIVITY_ITEMS) {
			result.recentActivity.splice(0, result.recentActivity.length - MAX_RECENT_ACTIVITY_ITEMS);
		}
		while (
			Buffer.byteLength(JSON.stringify(result.recentActivity), "utf8") > MAX_RECENT_ACTIVITY_BYTES
		) {
			result.recentActivity.shift();
		}
	};
	for (const part of message.content) {
		if (part.type === "text") {
			const text = part.text.trim();
			if (text) append({ type: "text", text: truncateUtf8(text, 1024).text });
		} else if (part.type === "toolCall") {
			append({
				type: "toolCall",
				name: part.name,
				args: compactRecentActivityArguments(part.arguments),
			});
		}
	}
}

export function buildFanInContext(
	results: SingleResult[],
	maxBytes = DEFAULT_MAX_CONTEXT_BYTES,
): string {
	const text = results
		.map((result, index) => {
			const failed = isResultError(result);
			const status = result.exitCode === -1 ? "running" : failed ? "failed" : "completed";
			const output = getResultFinalOutput(result);
			const error = result.errorMessage || result.stderr.trim();
			const resultText = failed
				? `${error ? "Error" : output ? "Partial output" : "Error"}:\n${formatResultFailure(result)}`
				: result.structuredResult
					? `Structured result:\n${JSON.stringify(result.structuredResult)}`
					: output
						? `Output:\n${output}`
						: "Output: (no output)";
			return [
				`## Result ${index + 1}: ${result.agent} (${status})`,
				`Task: ${result.task}`,
				resultText,
			].join("\n\n");
		})
		.join("\n\n---\n\n");
	return truncateUtf8(text, maxBytes).text;
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
	signal?: AbortSignal,
	onSkipped?: (item: TIn, index: number) => TOut,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			if (signal?.aborted && onSkipped) {
				results[current] = onSkipped(items[current], current);
				continue;
			}
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

export async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	thinkingLevel: SubagentThinkingLevel | undefined,
	timeoutMs: number,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	invocationOverride?: { command: string; argsPrefix?: string[] },
	launchPolicy?: ChildLaunchPolicy,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				contextTokens: 0,
				turns: 0,
			},
			thinkingLevel,
			step,
			finalOutput: "",
		};
	}

	const temporaryPrompts: Array<{ dir: string; filePath: string }> = [];
	let tmpPromptPath: string | null = null;
	let baseSystemPromptPath: string | null = null;

	let latestAssistantOutput = "";
	let terminalAssistantOutput: string | undefined;

	const progressJournal = new TimeoutProgressJournal();
	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task: launchPolicy?.displayTask ?? task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		},
		model: agent.model ?? undefined,
		thinkingLevel,
		step,
		timeoutMs,
		contract: launchPolicy?.contract,
		resultFormat: launchPolicy?.resultFormat,
		executionPlan: launchPolicy?.executionPlan,
		capabilityGrant: launchPolicy?.capabilityGrant,
	};
	const selectedAssistantOutput = () =>
		terminalAssistantOutput !== undefined
			? terminalAssistantOutput
			: latestAssistantOutput || getFinalOutput(currentResult.messages);
	const setErrorMessage = (message: string) => {
		const bounded = truncateUtf8(message, DEFAULT_MAX_STDERR_BYTES);
		currentResult.errorMessage = bounded.text;
		currentResult.truncated ||= bounded.truncated;
		return bounded.text;
	};

	const emitUpdate = () => {
		const latest = truncateUtf8(selectedAssistantOutput(), DEFAULT_MAX_OUTPUT_BYTES);
		currentResult.finalOutput = latest.text;
		currentResult.truncated ||= latest.truncated;
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: currentResult.finalOutput || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		const effectiveCwd = cwd ?? defaultCwd;
		try {
			if (!fs.statSync(effectiveCwd).isDirectory()) throw new Error("not a directory");
		} catch (error) {
			currentResult.exitCode = 1;
			currentResult.stopReason = "error";
			const reason = error instanceof Error ? error.message : String(error);
			currentResult.stderr = setErrorMessage(`Invalid subagent cwd: ${effectiveCwd} (${reason})`);
			return currentResult;
		}

		if (signal?.aborted) {
			currentResult.exitCode = 130;
			currentResult.aborted = true;
			currentResult.stopReason = "aborted";
			setErrorMessage("Subagent was aborted before start");
			return currentResult;
		}
		if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_SUBAGENT_TIMEOUT_MS) {
			currentResult.exitCode = 1;
			currentResult.stopReason = "error";
			setErrorMessage(
				`Invalid subagent timeout: expected 1-${MAX_SUBAGENT_TIMEOUT_MS}ms, received ${timeoutMs}`,
			);
			return currentResult;
		}

		if (launchPolicy?.baseSystemPrompt?.trim()) {
			const tmp = await writePromptToTempFile(`${agent.name}-base`, launchPolicy.baseSystemPrompt);
			temporaryPrompts.push(tmp);
			baseSystemPromptPath = tmp.filePath;
		}
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			temporaryPrompts.push(tmp);
			tmpPromptPath = tmp.filePath;
		}
		if (signal?.aborted) {
			currentResult.exitCode = 130;
			currentResult.aborted = true;
			currentResult.stopReason = "aborted";
			setErrorMessage("Subagent was aborted before launch");
			return currentResult;
		}

		const effectiveTools =
			launchPolicy && Object.hasOwn(launchPolicy, "tools") ? launchPolicy.tools : agent.tools;
		const selectedTools =
			effectiveTools === undefined
				? undefined
				: [...new Set([...effectiveTools, ...(launchPolicy?.additionalTools ?? [])])];
		const args = buildPiArgs({
			model: agent.model,
			thinkingLevel,
			tools: selectedTools,
			disableExtensions: launchPolicy?.disableExtensions,
			disableSkills: launchPolicy?.disableSkills,
			disablePromptTemplates: launchPolicy?.disablePromptTemplates,
			disableContextFiles: launchPolicy?.disableContextFiles,
			projectTrust: launchPolicy?.projectTrust,
			baseSystemPromptPath: baseSystemPromptPath ?? undefined,
			appendSystemPromptPaths: launchPolicy?.appendSystemPromptPaths,
			extensionPaths: launchPolicy?.extensionPaths,
			systemPromptPath: tmpPromptPath ?? undefined,
			task,
		});
		let invocation: { command: string; args: string[] };
		try {
			invocation = invocationOverride
				? {
						command: invocationOverride.command,
						args: [...(invocationOverride.argsPrefix ?? []), ...args],
					}
				: resolvePiInvocation(args);
		} catch (error) {
			currentResult.launchFailed = true;
			currentResult.exitCode = 1;
			currentResult.stderr = setErrorMessage(
				error instanceof Error ? error.message : String(error),
			);
			return currentResult;
		}
		let wasAborted = false;
		let timedOut = false;
		let budgetStop:
			| TurnBudgetStop
			| { reason: "work_timeout" | "orchestration_timeout"; limit: number }
			| undefined;

		const exitCode = await new Promise<number>((resolve) => {
			let settled = false;
			let cleanupTermination: (() => void) | undefined;
			let timeout: NodeJS.Timeout | undefined;
			let terminationDeadline: NodeJS.Timeout | undefined;
			let abortHandler: (() => void) | undefined;
			let budgetMonitor: TurnBudgetMonitor | undefined;
			const finish = (code: number) => {
				if (settled) return;
				settled = true;
				if (timeout) clearTimeout(timeout);
				if (terminationDeadline) clearTimeout(terminationDeadline);
				cleanupTermination?.();
				budgetMonitor?.dispose();
				if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
				resolve(code);
			};
			let proc: ReturnType<typeof spawn>;
			try {
				proc = spawn(invocation.command, invocation.args, {
					cwd: effectiveCwd,
					detached: process.platform !== "win32",
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
					env: {
						...process.env,
						...launchPolicy?.env,
						PI_SUBAGENT_DEPTH: String(
							(Number.parseInt(process.env.PI_SUBAGENT_DEPTH ?? "0", 10) || 0) + 1,
						),
					},
				});
			} catch (error) {
				currentResult.launchFailed = true;
				currentResult.stderr = setErrorMessage(
					error instanceof Error ? error.message : String(error),
				);
				finish(1);
				return;
			}

			const addMessage = (msg: Message) => {
				const boundedMessage = boundMessageText(msg, DEFAULT_MAX_OUTPUT_BYTES - 2);
				currentResult.truncated ||= boundedMessage.truncated;
				if (!boundedMessage.message) return;
				while (
					currentResult.messages.length >= DEFAULT_MAX_MESSAGES ||
					Buffer.byteLength(
						JSON.stringify([...currentResult.messages, boundedMessage.message]),
						"utf8",
					) > DEFAULT_MAX_OUTPUT_BYTES
				) {
					const removed = currentResult.messages.shift();
					if (!removed) break;
					currentResult.truncated = true;
				}
				if (
					Buffer.byteLength(
						JSON.stringify([...currentResult.messages, boundedMessage.message]),
						"utf8",
					) > DEFAULT_MAX_OUTPUT_BYTES
				) {
					currentResult.truncated = true;
					return;
				}
				currentResult.messages.push(boundedMessage.message);
			};
			const processEvent = (raw: unknown) => {
				if (!raw || typeof raw !== "object") return;
				const event = raw as { type?: string; message?: Message };
				if (event.type === "message_end" && event.message) {
					const msg = event.message;
					journalMessages(progressJournal, [msg]);
					if (msg.role === "assistant") {
						const output = truncateUtf8(getFinalOutput([msg]), DEFAULT_MAX_OUTPUT_BYTES);
						currentResult.truncated ||= output.truncated;
						if (output.text) latestAssistantOutput = output.text;
						if (msg.stopReason === "stop" || msg.stopReason === "length") {
							terminalAssistantOutput = output.text;
						}
					}
					appendRecentActivity(currentResult, msg);
					addMessage(msg);
					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						budgetMonitor?.recordToolCalls(
							msg.content.filter((part) => part.type === "toolCall").length,
						);
						budgetMonitor?.recordAssistantTurn(msg.stopReason);
						const usage = msg.usage;
						if (usage && typeof usage === "object") {
							const input = protocolUsageCount(usage.input);
							const output = protocolUsageCount(usage.output);
							const cacheRead = protocolUsageCount(usage.cacheRead);
							const cacheWrite = protocolUsageCount(usage.cacheWrite);
							const reportedTotal = protocolUsageCount(usage.totalTokens);
							const turnTotal =
								reportedTotal ||
								addUsageValue(addUsageValue(input, output), addUsageValue(cacheRead, cacheWrite));
							const cost = usage.cost && typeof usage.cost === "object" ? usage.cost : undefined;
							currentResult.usage.input = addUsageValue(currentResult.usage.input, input);
							currentResult.usage.output = addUsageValue(currentResult.usage.output, output);
							currentResult.usage.cacheRead = addUsageValue(
								currentResult.usage.cacheRead,
								cacheRead,
							);
							currentResult.usage.cacheWrite = addUsageValue(
								currentResult.usage.cacheWrite,
								cacheWrite,
							);
							currentResult.usage.cost = addUsageValue(
								currentResult.usage.cost,
								protocolUsageCost(cost?.total),
							);
							currentResult.usage.costInput = addUsageValue(
								currentResult.usage.costInput ?? 0,
								protocolUsageCost(cost?.input),
							);
							currentResult.usage.costOutput = addUsageValue(
								currentResult.usage.costOutput ?? 0,
								protocolUsageCost(cost?.output),
							);
							currentResult.usage.costCacheRead = addUsageValue(
								currentResult.usage.costCacheRead ?? 0,
								protocolUsageCost(cost?.cacheRead),
							);
							currentResult.usage.costCacheWrite = addUsageValue(
								currentResult.usage.costCacheWrite ?? 0,
								protocolUsageCost(cost?.cacheWrite),
							);
							currentResult.usage.totalTokens = addUsageValue(
								currentResult.usage.totalTokens ?? 0,
								turnTotal,
							);
							currentResult.usage.contextTokens = turnTotal;
						}
						if (typeof msg.provider === "string") currentResult.actualProvider = msg.provider;
						const actualModel =
							typeof msg.responseModel === "string"
								? msg.responseModel
								: typeof msg.model === "string"
									? msg.model
									: undefined;
						if (actualModel) currentResult.actualModel = actualModel;
						if (typeof msg.stopReason === "string") currentResult.stopReason = msg.stopReason;
						if (typeof msg.errorMessage === "string") setErrorMessage(msg.errorMessage);
					}
					emitUpdate();
				} else if (event.type === "tool_result_end" && event.message) {
					journalMessages(progressJournal, [event.message]);
					budgetMonitor?.recordActivity();
					addMessage(event.message);
					emitUpdate();
				}
			};
			const decoder = new JsonLineDecoder({
				onValue: processEvent,
				onMalformed: () => {
					currentResult.malformedEvents = (currentResult.malformedEvents ?? 0) + 1;
				},
				onOversized: () => {
					currentResult.truncated = true;
				},
			});
			const beginTermination = (exitCode: number) => {
				if (cleanupTermination || settled) return;
				cleanupTermination = terminateProcess(proc);
				terminationDeadline = setTimeout(() => {
					decoder.finish();
					proc.stdin?.destroy();
					proc.stdout?.destroy();
					proc.stderr?.destroy();
					finish(exitCode);
				}, KILL_GRACE_MS + 1_000);
			};
			const stopForBudget = (
				stop: TurnBudgetStop | { reason: "work_timeout" | "orchestration_timeout"; limit: number },
			) => {
				if (budgetStop || settled || wasAborted) return;
				budgetStop = stop;
				timedOut = stop.reason.endsWith("timeout");
				currentResult.timedOut = timedOut || undefined;
				currentResult.stopReason = timedOut ? "timeout" : "limit";
				const message = formatTurnTerminationMessage(stop.reason, stop.limit);
				setErrorMessage(message);
				const bounded = appendBounded(
					currentResult.stderr,
					`\n${message}.`,
					DEFAULT_MAX_STDERR_BYTES,
				);
				currentResult.stderr = bounded.text;
				currentResult.truncated ||= bounded.truncated;
				emitUpdate();
				beginTermination(124);
			};
			budgetMonitor = new TurnBudgetMonitor({
				...launchPolicy?.turnLimits,
				onExceeded: stopForBudget,
			});

			proc.once("spawn", () => {
				currentResult.processStarted = true;
				if (settled || budgetStop || wasAborted) return;
				timeout = setTimeout(() => {
					stopForBudget({
						reason: launchPolicy?.workTimeoutReason ?? "work_timeout",
						limit: launchPolicy?.workTimeoutReportLimit ?? timeoutMs,
					});
				}, timeoutMs);
				timeout.unref();
			});
			proc.stdout?.on("data", (data) => decoder.push(data));
			proc.stderr?.on("data", (data) => {
				const bounded = appendBounded(
					currentResult.stderr,
					data.toString(),
					DEFAULT_MAX_STDERR_BYTES,
				);
				currentResult.stderr = bounded.text;
				currentResult.truncated ||= bounded.truncated;
			});
			proc.on("close", (code) => {
				decoder.finish();
				finish(budgetStop ? 124 : wasAborted ? 130 : (code ?? 0));
			});
			proc.on("error", (error) => {
				currentResult.launchFailed = currentResult.processStarted ? undefined : true;
				const message = setErrorMessage(error.message);
				const bounded = appendBounded(
					currentResult.stderr,
					`${currentResult.stderr ? "\n" : ""}${message}`,
					DEFAULT_MAX_STDERR_BYTES,
				);
				currentResult.stderr = bounded.text;
				currentResult.truncated ||= bounded.truncated;
				if (currentResult.processStarted) beginTermination(1);
				else finish(1);
			});

			if (signal) {
				abortHandler = () => {
					if (budgetStop || settled) return;
					wasAborted = true;
					currentResult.aborted = true;
					currentResult.stopReason = "aborted";
					setErrorMessage("Subagent was aborted");
					beginTermination(130);
				};
				if (signal.aborted) abortHandler();
				else signal.addEventListener("abort", abortHandler, { once: true });
			}
		});

		if (signal?.aborted && budgetStop) {
			budgetStop = undefined;
			timedOut = false;
			currentResult.timedOut = undefined;
			currentResult.aborted = true;
			currentResult.stopReason = "aborted";
			setErrorMessage("Subagent was aborted");
		}
		currentResult.exitCode = currentResult.aborted ? 130 : exitCode;
		const final = truncateUtf8(selectedAssistantOutput(), DEFAULT_MAX_OUTPUT_BYTES);
		currentResult.finalOutput = final.text;
		currentResult.truncated ||= final.truncated;
		if (budgetStop) {
			currentResult.partialOutput = currentResult.finalOutput || undefined;
			currentResult.termination = {
				version: TURN_TERMINATION_VERSION,
				reason: budgetStop.reason,
				limit: budgetStop.limit,
				checkpoint: progressJournal.checkpoint(task, currentResult.partialOutput),
				finalization: { attempted: false, status: "skipped", durationMs: 0 },
			};
		}
		const remainingFinalizationMs = launchPolicy?.orchestrationDeadlineAt
			? Math.floor(launchPolicy.orchestrationDeadlineAt - Date.now())
			: undefined;
		if (
			budgetStop &&
			budgetStop.reason !== "orchestration_timeout" &&
			launchPolicy?.finalizeOnTimeout !== false &&
			!signal?.aborted &&
			(remainingFinalizationMs === undefined || remainingFinalizationMs > 0)
		) {
			const finalizationStartedAt = Date.now();
			const requestedFinalizationMs = resolveTimeoutFinalizationMs(
				timeoutMs,
				launchPolicy?.timeoutFinalizationMs,
			);
			const finalizationMs = Math.min(
				requestedFinalizationMs,
				remainingFinalizationMs ?? requestedFinalizationMs,
			);
			const summary = await runSingleAgent(
				defaultCwd,
				agents,
				agentName,
				buildTimeoutFinalizationPrompt({
					task,
					partialOutput: currentResult.partialOutput,
					recentActivity: currentResult.recentActivity,
					checkpoint: currentResult.termination?.checkpoint,
					terminationReason: budgetStop.reason,
					resultFormat: launchPolicy?.timeoutResultFormat,
				}),
				cwd,
				step,
				signal,
				thinkingLevel,
				finalizationMs,
				undefined,
				makeDetails,
				invocationOverride,
				{
					...launchPolicy,
					tools: [],
					disableExtensions: true,
					disableSkills: true,
					disablePromptTemplates: true,
					disableContextFiles: true,
					appendSystemPromptPaths: undefined,
					finalizeOnTimeout: false,
					turnLimits: undefined,
					workTimeoutReason: "work_timeout",
					workTimeoutReportLimit: finalizationMs,
					orchestrationDeadlineAt: undefined,
				},
			);
			mergeUsageStats(currentResult.usage, summary.usage);
			const summaryOutput = getResultFinalOutput(summary).trim();
			if (summary.exitCode === 0 && summaryOutput) {
				currentResult.timeoutSummary = summaryOutput;
				currentResult.finalOutput = summaryOutput;
				if (currentResult.termination) {
					currentResult.termination.finalization = {
						attempted: true,
						status: "completed",
						durationMs: Date.now() - finalizationStartedAt,
					};
				}
			} else {
				currentResult.timeoutSummaryError =
					summary.errorMessage || summary.stderr.trim() || "Summary produced no final text";
				if (currentResult.termination) {
					currentResult.termination.finalization = {
						attempted: true,
						status: summary.timedOut ? "timed_out" : "failed",
						durationMs: Date.now() - finalizationStartedAt,
						error: currentResult.timeoutSummaryError,
					};
				}
			}
			currentResult.truncated ||= summary.truncated;
		}
		if (currentResult.termination && !currentResult.finalOutput.trim()) {
			currentResult.finalOutput = formatTimeoutCheckpoint(currentResult.termination.checkpoint);
		}
		if (currentResult.exitCode === 0 && launchPolicy?.resultFormat !== undefined) {
			currentResult.structuredResult = parseAnyStructuredSubagentResult(
				currentResult.finalOutput ?? "",
				launchPolicy.resultFormat,
			);
			currentResult.resultContractInvalid =
				launchPolicy.resultFormat !== "text" && currentResult.structuredResult === undefined;
			if (
				currentResult.structuredResult?.version === "pi-subagents:result:v2" &&
				launchPolicy.executionPlan
			) {
				currentResult.structuredResult.provenance = {
					...currentResult.structuredResult.provenance,
					...(launchPolicy.executionPlan.taskId
						? { taskId: launchPolicy.executionPlan.taskId }
						: {}),
					taskGeneration: launchPolicy.executionPlan.taskGeneration,
					executionPlanId: launchPolicy.executionPlan.id,
					cancellationLineage: [...launchPolicy.executionPlan.cancellationLineage],
				};
			}
			if (currentResult.structuredResult?.version === "pi-subagents:result:v2") {
				currentResult.outcome = classifyStructuredOutcome(
					currentResult.structuredResult.status,
					currentResult.structuredResult.reasonCode,
				);
			} else if (currentResult.resultContractInvalid) {
				currentResult.outcome = classifyStructuredOutcome(
					"contract-invalid",
					"malformed-structured-result",
				);
			}
		}
		if (
			currentResult.exitCode === 0 &&
			currentResult.stopReason !== "error" &&
			(currentResult.stopReason === "toolUse" || !currentResult.finalOutput.trim())
		) {
			currentResult.exitCode = 1;
			currentResult.stopReason = "error";
			setErrorMessage("Subagent completed without final text");
		}
		if (currentResult.capabilityGrant?.state === "active") {
			currentResult.capabilityGrant = revokeCapabilityGrant(
				currentResult.capabilityGrant,
				"turn-settled",
				Date.now(),
			);
		}
		currentResult.policy = {
			inherited: ["environment"],
			overridden: [
				"cwd",
				...(agent.model ? ["model"] : []),
				...(thinkingLevel ? ["thinkingLevel"] : []),
				...(effectiveTools !== undefined ? ["tools"] : []),
				...(launchPolicy?.disableExtensions ? ["extensions"] : []),
				...(launchPolicy?.disableSkills ? ["skills"] : []),
				...(launchPolicy?.disablePromptTemplates ? ["promptTemplates"] : []),
				...(launchPolicy?.disableContextFiles ? ["contextFiles"] : []),
			],
			unsupported: ["approvalPolicy", "sandboxProfile", "providerHeaders"],
		};
		return currentResult;
	} finally {
		for (const temporary of temporaryPrompts.reverse()) {
			try {
				fs.unlinkSync(temporary.filePath);
			} catch {
				/* ignore */
			}
			try {
				fs.rmdirSync(temporary.dir);
			} catch {
				/* ignore */
			}
		}
	}
}
