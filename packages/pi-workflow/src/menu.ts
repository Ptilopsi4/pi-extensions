import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu } from "@narumitw/pi-tui-kit";
import { safeGoalMenuText, safeTerminalText } from "./goal/errors.js";
import type { GoalStatus } from "./goal/prompts.js";
import { PLAN_HANDOFF_BEHAVIORS, type PlanHandoffBehavior } from "./settings.js";

export interface WorkflowMenuState {
	plan: "off" | "planning" | "ready" | "saved" | "implementing";
	goal?: { status: GoalStatus; objective: string };
	planHandoff: PlanHandoffBehavior;
	settingsIssue?: string;
	settingsPath: string;
}

export interface WorkflowMenuController {
	getState(): WorkflowMenuState;
	setPlanHandoff(value: PlanHandoffBehavior): void;
	showPlan(ctx: ExtensionCommandContext): Promise<void>;
	showGoal(ctx: ExtensionCommandContext): Promise<void>;
	showPlanSettings(ctx: ExtensionCommandContext): Promise<void>;
	showGoalSettings(ctx: ExtensionCommandContext): Promise<void>;
}

type Screen = "main" | "settings" | "status" | "help" | "invalid";
type Action =
	| "open-plan"
	| "open-goal"
	| "set-handoff"
	| "open-plan-settings"
	| "open-goal-settings";

const HANDOFF_LABELS: Record<PlanHandoffBehavior, string> = {
	review: "Review first",
	automatic: "Automatic",
};

export function createWorkflowMenu(controller: WorkflowMenuController) {
	return defineMenu<WorkflowMenuState, Screen, Action, ExtensionCommandContext>({
		start: "main",
		screens: {
			main: ({ state }) => ({
				kind: "actions",
				title: "Workflow",
				lines: summaryLines(state),
				items: [
					{
						id: "plan",
						label: "Plan…",
						description: planDescription(state.plan),
						action: "open-plan",
					},
					{
						id: "goal",
						label: "Goal…",
						description: state.goal
							? `${statusLabel(state.goal.status)} · ${safeGoalMenuText(state.goal.objective)}`
							: "Start or manage autonomous Goal work",
						action: "open-goal",
					},
					{
						id: "settings",
						label: "Settings",
						to: state.settingsIssue ? "invalid" : "settings",
					},
					{ id: "status", label: "Status", to: "status" },
					{ id: "help", label: "Help", to: "help" },
					{ id: "close", label: "Close", close: true },
				],
				hint: "close",
			}),
			settings: ({ state }) => ({
				kind: "settings",
				title: "Workflow Settings",
				lines: [
					`User settings · ${safeTerminalText(state.settingsPath)}`,
					"Changes save immediately. Plan and Goal settings open their complete editors.",
				],
				items: [
					{
						id: "planHandoff",
						label: "Plan handoff",
						description:
							"Review the authoritative plan before Goal starts, or pre-authorize automatic handoff.",
						currentValue: HANDOFF_LABELS[state.planHandoff],
						values: PLAN_HANDOFF_BEHAVIORS.map((behavior) => HANDOFF_LABELS[behavior]),
						action: "set-handoff",
					},
					{
						id: "planSettings",
						label: "Plan settings",
						description: "Thinking, tools, and export destination.",
						currentValue: "Open…",
						action: "open-plan-settings",
					},
					{
						id: "goalSettings",
						label: "Goal settings",
						description: "Safety limits, tools, queue, and managed-run RPC.",
						currentValue: "Open…",
						action: "open-goal-settings",
					},
				],
			}),
			status: ({ state }) => ({
				kind: "detail",
				title: "Workflow Status",
				lines: [
					...summaryLines(state),
					...(state.goal
						? [`Goal objective: ${safeGoalMenuText(state.goal.objective, 4_000)}`]
						: []),
					`Settings: ${safeTerminalText(state.settingsPath)}`,
					...(state.settingsIssue
						? [`Settings issue: ${safeTerminalText(state.settingsIssue)}`]
						: []),
				],
				hint: "back",
			}),
			help: () => ({
				kind: "detail",
				title: "How Workflow works",
				lines: [
					"Use /plan alone to produce, save, export, revise, or discard an authoritative Plan without execution.",
					"Use /goal alone when managed execution does not need a prior Plan.",
					"Choosing Implement transfers the exact approved Plan to Goal in one implementation request.",
					"The linked Plan remains available until Goal completes, is cleared, or is superseded.",
					"Use /goal to pause, resume, edit, inspect, or clear managed execution.",
					"Review-first handoff is the safe default. Automatic handoff must be explicitly enabled.",
					"Do not load pi-workflow together with pi-plan-mode or pi-goal.",
				],
				hint: "back",
			}),
			invalid: ({ state }) => ({
				kind: "detail",
				title: "Workflow Settings · Read only",
				lines: [
					`Invalid settings file. Fix ${safeTerminalText(state.settingsPath)} and run /reload. The file will not be overwritten.`,
					safeTerminalText(state.settingsIssue ?? "The settings file is invalid."),
				],
				hint: "back",
			}),
		},
		actions: {
			"open-plan": async ({ ctx, signal }) => {
				if (signal.aborted) return { kind: "rejected" };
				await controller.showPlan(ctx);
				return signal.aborted ? { kind: "rejected" } : { kind: "stay" };
			},
			"open-goal": async ({ ctx, signal }) => {
				if (signal.aborted) return { kind: "rejected" };
				await controller.showGoal(ctx);
				return signal.aborted ? { kind: "rejected" } : { kind: "stay" };
			},
			"set-handoff": async ({ value }) => {
				const behavior = handoffFromLabel(value);
				if (!behavior) return { kind: "rejected" };
				controller.setPlanHandoff(behavior);
				return { kind: "stay" };
			},
			"open-plan-settings": async ({ ctx, signal }) => {
				if (signal.aborted) return { kind: "rejected" };
				await controller.showPlanSettings(ctx);
				return signal.aborted ? { kind: "rejected" } : { kind: "stay" };
			},
			"open-goal-settings": async ({ ctx, signal }) => {
				if (signal.aborted) return { kind: "rejected" };
				await controller.showGoalSettings(ctx);
				return signal.aborted ? { kind: "rejected" } : { kind: "stay" };
			},
		},
	});
}

export async function showWorkflowMenu(
	ctx: ExtensionCommandContext,
	controller: WorkflowMenuController,
	options: { signal: AbortSignal; isCurrent(): boolean },
) {
	return runMenu(ctx, createWorkflowMenu(controller), {
		getState: () => controller.getState(),
		signal: options.signal,
		isCurrent: options.isCurrent,
	});
}

function summaryLines(state: WorkflowMenuState) {
	return [
		`Plan: ${planLabel(state.plan)}`,
		`Goal: ${state.goal ? statusLabel(state.goal.status) : "Off"}`,
		`Handoff: ${HANDOFF_LABELS[state.planHandoff]}`,
	];
}

function planLabel(state: WorkflowMenuState["plan"]) {
	return {
		off: "Off",
		planning: "Planning",
		ready: "Ready",
		saved: "Saved",
		implementing: "Implementing",
	}[state];
}

function planDescription(state: WorkflowMenuState["plan"]) {
	return {
		off: "Start a read-only planning workflow",
		planning: "Continue or manage the active Plan",
		ready: "Review and hand the approved Plan to Goal",
		saved: "Show, run with Goal, export, or clear the saved Plan",
		implementing: "Show or export the linked Plan, or manage Goal",
	}[state];
}

function statusLabel(status: GoalStatus) {
	return status
		.split("_")
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function handoffFromLabel(value: string | undefined) {
	return PLAN_HANDOFF_BEHAVIORS.find((behavior) => HANDOFF_LABELS[behavior] === value);
}
