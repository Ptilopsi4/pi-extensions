import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runChild } from "./job-process.js";
import { JobRuntime, type JobRuntimeDependencies } from "./job-runtime.js";
import { registerJobTools } from "./job-tools.js";
import type { ChildRequest, ChildResult, JobResult } from "./job-types.js";
import { createJobWidget } from "./job-widget.js";
import { boundText, safeTerminalText } from "./safe-text.js";

export const SUBAGENT_COMPLETION_MESSAGE_TYPE = "pi-subagent-completion";
const MAX_COMPLETION_BYTES = 40 * 1024;

export interface BoundedSubagentsDependencies {
	runChild?: (request: ChildRequest) => Promise<ChildResult>;
	now?: JobRuntimeDependencies["now"];
	createJobId?: JobRuntimeDependencies["createJobId"];
}

export default function boundedSubagents(
	pi: ExtensionAPI,
	dependencies: BoundedSubagentsDependencies = {},
): void {
	let activeSession: ExtensionContext["sessionManager"] | undefined;
	let lifecycleGeneration = 0;
	const runtime = new JobRuntime({
		runChild: dependencies.runChild ?? runChild,
		now: dependencies.now,
		createJobId: dependencies.createJobId,
		deliverCompletion(result, generation) {
			if (!activeSession || !runtime.active || generation !== runtime.currentGeneration) {
				return;
			}
			deliverCompletion(pi, result);
		},
	});
	const widget = createJobWidget(runtime);
	const owner = {
		isCurrent(ctx: ExtensionContext) {
			return runtime.active && ctx.sessionManager === activeSession;
		},
		generation() {
			return lifecycleGeneration;
		},
	};

	registerJobTools(pi, { runtime, owner });
	registerCommand(pi, runtime, owner);

	pi.on("session_start", async (_event, ctx) => {
		const generation = ++lifecycleGeneration;
		activeSession = undefined;
		widget.shutdown();
		await runtime.shutdown();
		if (generation !== lifecycleGeneration) return;
		runtime.beginSession();
		activeSession = ctx.sessionManager;
		widget.start(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.sessionManager !== activeSession) return;
		lifecycleGeneration += 1;
		widget.shutdown(ctx);
		activeSession = undefined;
		await runtime.shutdown();
	});
}

function deliverCompletion(pi: ExtensionAPI, result: JobResult): void {
	const content = boundText(
		[
			"Message Type: SUBAGENT_COMPLETION",
			"Protocol: pi-subagents:bounded-completion:v1",
			"This is the terminal result of one isolated background job.",
			safeTerminalText(JSON.stringify(result, null, 2)),
		].join("\n"),
		MAX_COMPLETION_BYTES,
	).text;
	pi.sendMessage(
		{
			customType: SUBAGENT_COMPLETION_MESSAGE_TYPE,
			content,
			display: true,
			details: result,
		},
		{ deliverAs: "steer", triggerTurn: false },
	);
}

function registerCommand(
	pi: ExtensionAPI,
	runtime: JobRuntime,
	owner: { isCurrent(ctx: ExtensionContext): boolean },
): void {
	const completions = [
		{ value: "status", label: "status", description: "Show bounded current-session job status" },
		{ value: "help", label: "help", description: "Show bounded subagent tools and safety help" },
	];
	pi.registerCommand("subagents", {
		description: "Show bounded subagent job status or help",
		getArgumentCompletions(prefix: string) {
			const normalized = prefix.trim().toLowerCase();
			const matches = completions.filter((item) => item.value.startsWith(normalized));
			return matches.length > 0 ? matches : null;
		},
		async handler(args, ctx) {
			if (!owner.isCurrent(ctx)) throw abortError("Subagent session is not active.");
			const normalized = args.trim().toLowerCase();
			if (normalized === "" || normalized === "status") {
				publishCommandOutput(ctx, formatStatus(runtime));
				return;
			}
			if (normalized === "help") {
				publishCommandOutput(ctx, helpText());
				return;
			}
			const message = `Unknown /subagents arguments: ${safeTerminalText(args).trim() || "(empty)"}`;
			if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.notify(message, "warning");
			throw new Error(message);
		},
	});
}

function publishCommandOutput(ctx: ExtensionContext, message: string): void {
	if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.notify(message, "info");
}

function formatStatus(runtime: JobRuntime): string {
	const snapshot = runtime.inspect();
	const counts = new Map<string, number>();
	for (const job of snapshot.jobs) counts.set(job.state, (counts.get(job.state) ?? 0) + 1);
	const states = [...counts.entries()].map(([state, count]) => `${state}: ${count}`).join(", ");
	return [
		"Bounded subagents",
		`Jobs retained: ${snapshot.jobs.length}${snapshot.omitted > 0 ? ` (${snapshot.omitted} omitted)` : ""}`,
		states || "No jobs in the current session.",
	].join("\n");
}

function helpText(): string {
	return [
		"Bounded subagents",
		"subagent_spawn starts one fresh isolated background job.",
		"subagent_await joins a job without cancelling it on caller timeout.",
		"subagent_cancel stops one active job.",
		"subagent_inspect returns privacy-bounded current-session metadata.",
		"Jobs receive no parent conversation, retained memory, settings, mailbox, or communication channel.",
	].join("\n");
}

function abortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}
