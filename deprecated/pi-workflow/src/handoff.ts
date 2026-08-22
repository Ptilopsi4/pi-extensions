import { randomUUID } from "node:crypto";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { serializeGoalState } from "./goal/persistence.js";
import { buildGoalPrompt } from "./goal/prompts.js";
import { createGoal, GOAL_STATE_ENTRY_TYPE } from "./goal/runtime.js";
import type {
	FreshImplementationRequest,
	FreshImplementationResult,
} from "./plan/fresh-implementation.js";
import { formatImplementationHandoff } from "./plan/prompt.js";
import type { PlanModeState } from "./plan/state.js";
import { WORKFLOW_GOAL_OBJECTIVE } from "./workflow-contract.js";

export { WORKFLOW_GOAL_OBJECTIVE } from "./workflow-contract.js";

type NewSessionOptions = Exclude<Parameters<ExtensionCommandContext["newSession"]>[0], undefined>;
type ReplacementContext = Parameters<NonNullable<NewSessionOptions["withSession"]>>[0];

export function formatWorkflowGoalHandoff(
	planHandoff: string,
	goal: Parameters<typeof buildGoalPrompt>[0],
) {
	return `${planHandoff}\n\n${buildGoalPrompt(goal)}`;
}

export async function startFreshWorkflowImplementation(
	ctx: ExtensionCommandContext,
	request: FreshImplementationRequest,
): Promise<FreshImplementationResult> {
	if (ctx.mode === "print" || ctx.mode === "json") {
		throw new Error(
			"Fresh workflow implementation is unavailable in print/JSON mode. Use TUI or RPC.",
		);
	}

	await ctx.waitForIdle();
	if (!request.isCurrent()) return { kind: "stale" };
	if (!(await preflightModel(ctx, request.isCurrent))) return { kind: "rejected" };
	if (!request.isCurrent()) return { kind: "stale" };

	const activeImplementation = {
		id: randomUUID(),
		goalId: destinationGoalId(),
		plan: request.plan,
		source: request.source,
		startedAt: Date.now(),
		retention: request.retention,
	};
	const destinationPlanState: PlanModeState = {
		enabled: false,
		awaitingAction: false,
		activeImplementation,
	};
	const destinationGoal = createGoal(
		WORKFLOW_GOAL_OBJECTIVE,
		undefined,
		0,
		activeImplementation.goalId,
	);
	const implementationPrompt = formatImplementationHandoff(request.plan);
	const handoff = formatWorkflowGoalHandoff(implementationPrompt, destinationGoal);
	const parentSession = ctx.sessionManager.getSessionFile();
	let setupError: string | undefined;
	let kickoffError: string | undefined;

	if (ctx.mode === "rpc") ctx.ui.notify("Starting fresh Goal implementation session…", "info");

	let result: Awaited<ReturnType<ExtensionCommandContext["newSession"]>>;
	try {
		result = await ctx.newSession({
			...(parentSession ? { parentSession } : {}),
			setup: async (sessionManager) => {
				let planStateSaved = false;
				try {
					sessionManager.appendCustomEntry(request.stateEntryType, destinationPlanState);
					planStateSaved = true;
					sessionManager.appendCustomEntry(
						GOAL_STATE_ENTRY_TYPE,
						serializeGoalState(destinationGoal, [], undefined),
					);
				} catch (error: unknown) {
					setupError = safeErrorDetail(error);
					if (planStateSaved) {
						try {
							sessionManager.appendCustomEntry(request.stateEntryType, {
								enabled: false,
								awaitingAction: false,
							});
						} catch {
							// A destination that cannot publish compensation remains read-only;
							// the recovery editor never claims that Goal state is active.
						}
					}
				}
			},

			withSession: async (replacementCtx) => {
				if (setupError) {
					recoverSetupFailure(replacementCtx, implementationPrompt, setupError);
					return;
				}
				try {
					await replacementCtx.sendUserMessage(handoff);
					replacementCtx.ui.notify(
						"Fresh Goal implementation session started with the exact approved plan.",
						"info",
					);
				} catch (error: unknown) {
					kickoffError = safeErrorDetail(error);
					replacementCtx.ui.notify(
						`Fresh session created, but Goal implementation did not start: ${kickoffError}. Send a message to continue, use /goal to inspect the retained Goal, or resume the parent planning session.`,
						"error",
					);
				}
			},
		});
	} catch (error: unknown) {
		safeNotify(
			ctx,
			`Unable to start a fresh Goal implementation session: ${safeErrorDetail(error)}. The source plan remains available.`,
			"error",
		);
		return { kind: "rejected" };
	}

	if (result.cancelled) {
		ctx.ui.notify(
			"Fresh Goal implementation cancelled. The source plan remains available.",
			"info",
		);
		return { kind: "cancelled" };
	}
	return setupError || kickoffError ? { kind: "partial" } : { kind: "started" };
}

async function preflightModel(ctx: ExtensionCommandContext, isCurrent: () => boolean) {
	const model = ctx.model;
	if (!model) {
		ctx.ui.notify("Unable to implement the plan: no model is selected.", "warning");
		return false;
	}
	let auth: Awaited<ReturnType<ExtensionCommandContext["modelRegistry"]["getApiKeyAndHeaders"]>>;
	try {
		auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	} catch (error: unknown) {
		if (isCurrent()) {
			ctx.ui.notify(`Unable to implement the plan: ${safeErrorDetail(error)}`, "error");
		}
		return false;
	}
	if (!isCurrent()) return false;
	if (!auth.ok) {
		ctx.ui.notify(`Unable to implement the plan: ${safeErrorDetail(auth.error)}`, "warning");
		return false;
	}
	return true;
}

function recoverSetupFailure(ctx: ReplacementContext, handoff: string, setupError: string) {
	ctx.ui.setEditorText(handoff);
	ctx.ui.notify(
		`Fresh session created, but linked Plan and Goal state could not be saved: ${setupError}. The implementation request is in the editor; submit it to continue or resume the parent planning session.`,
		"error",
	);
}

function destinationGoalId() {
	return randomUUID();
}

function safeNotify(
	ctx: ExtensionCommandContext,
	message: string,
	level: "info" | "warning" | "error",
) {
	try {
		ctx.ui.notify(message, level);
	} catch {
		// The source context can become stale after successful replacement teardown.
	}
}

function safeErrorDetail(error: unknown) {
	const detail = error instanceof Error ? error.message : String(error);
	const normalized =
		[...detail]
			.map((character) => {
				const codePoint = character.codePointAt(0) ?? 0;
				return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
			})
			.join("")
			.replace(/\s+/gu, " ")
			.trim() || "unknown error";
	const characters = [...normalized];
	return characters.length > 500 ? `${characters.slice(0, 499).join("")}…` : normalized;
}
