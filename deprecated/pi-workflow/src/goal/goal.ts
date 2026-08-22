import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type GoalCommandHandle, registerGoalCommand } from "./command-registration.js";
import { GoalCommandController } from "./commands.js";
import { registerGoalLifecycle } from "./lifecycle.js";
import type { ActiveGoal } from "./persistence.js";
import { GoalRunController } from "./run-protocol.js";
import { GoalRuntime } from "./runtime.js";
import type { GoalSettings, GoalSettingsLoadResult } from "./settings.js";
import { registerGoalTools } from "./tools.js";

export interface GoalOptions {
	settingsPath?: string;
	readSettings?(settingsPath?: string): GoalSettingsLoadResult;
	reportSettingsIssues?: boolean;
	saveSettings?(settings: GoalSettings, settingsPath: string): void;
	canStartGoal?(): string | undefined;
	onGoalSuperseded?(previousGoal: ActiveGoal, nextGoal: ActiveGoal | undefined): void;
	activateRestoredGoal?(ctx: ExtensionContext, goal: ActiveGoal): boolean;
}

export interface GoalHandle {
	runtime: GoalRuntime;
	commands: GoalCommandController;
	runController: GoalRunController;
	ui: GoalCommandHandle;
}

function registerGoalRuntime(pi: ExtensionAPI, options: GoalOptions = {}): GoalHandle {
	const runtime = new GoalRuntime(pi);
	const commands = new GoalCommandController(
		runtime,
		options.canStartGoal,
		options.onGoalSuperseded,
	);
	const runController = new GoalRunController(runtime, commands);

	// Keep registration order explicit: managed-run bus listeners exist before tools,
	// command routing, and session lifecycle bind the per-factory runtime.
	runController.register(pi);
	registerGoalTools(pi, runtime);
	const ui = registerGoalCommand(pi, runtime, commands, options);
	registerGoalLifecycle(pi, runtime, commands, runController, options);
	return { runtime, commands, runController, ui };
}

export default function goal(pi: ExtensionAPI, options: GoalOptions = {}) {
	return registerGoalRuntime(pi, options);
}

export {
	assistantUsageTokens,
	cumulativeAssistantTokens,
	formatDuration,
	formatTokenCount,
} from "./accounting.js";

export {
	completeGoalArguments,
	parseCommand,
	parseTokenBudget,
	validateObjective,
} from "./command.js";

export { buildGoalSystemPrompt } from "./prompts.js";

export {
	findFinalAssistantMessage,
	formatStatus,
	isContradictoryCompletionSummary,
	isRetryableGoalInterruption,
	isUsageLimitedGoalInterruption,
} from "./runtime.js";
