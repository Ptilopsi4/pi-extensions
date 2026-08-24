import type { Message } from "@earendil-works/pi-ai";
import type { AgentSource, SubagentThinkingLevel } from "./agents/types.js";
import type { CapabilityGrant } from "./capability-grant.js";
import type { TargetPolicyAudit } from "./cwd-policy.js";
import type { DelegationContract } from "./delegation-contract.js";
import type { ExecutionPlan } from "./execution-plan.js";
import type { ClassifiedSubagentOutcome } from "./outcome.js";
import type { AnyStructuredSubagentResult, SubagentResultFormat } from "./result-contract.js";
import type { UsageStats } from "./runner-usage.js";
import type { TurnTerminationReport } from "./timeout-checkpoint.js";
import type { TurnLimits } from "./turn-budget.js";

export type RecentActivityItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

export interface SingleResult {
	agent: string;
	agentSource: AgentSource | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	actualProvider?: string;
	actualModel?: string;
	recentActivity?: RecentActivityItem[];
	recentActivityTotal?: number;
	thinkingLevel?: SubagentThinkingLevel;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	finalOutput?: string;
	partialOutput?: string;
	timeoutSummary?: string;
	timeoutSummaryError?: string;
	termination?: TurnTerminationReport;
	timedOut?: boolean;
	timeoutMs?: number;
	aborted?: boolean;
	truncated?: boolean;
	malformedEvents?: number;
	launchFailed?: boolean;
	processStarted?: boolean;
	target?: TargetPolicyAudit;
	policy?: {
		inherited: string[];
		overridden: string[];
		unsupported: string[];
	};
	contract?: DelegationContract;
	resultFormat?: SubagentResultFormat;
	structuredResult?: AnyStructuredSubagentResult;
	resultContractInvalid?: boolean;
	outcome?: ClassifiedSubagentOutcome;
	attemptCount?: number;
	hedged?: boolean;
	executionPlan?: ExecutionPlan;
	capabilityGrant?: CapabilityGrant;
}

export interface ChildLaunchPolicy {
	tools?: string[];
	disableExtensions?: boolean;
	disableSkills?: boolean;
	disablePromptTemplates?: boolean;
	disableContextFiles?: boolean;
	projectTrust?: boolean;
	baseSystemPrompt?: string;
	appendSystemPromptPaths?: string[];
	/** Package-owned explicit child extensions loaded even when unrelated extensions are disabled. */
	extensionPaths?: string[];
	/** Package-owned tools added to the child allowlist without changing delegated execution tools. */
	additionalTools?: string[];
	/** Ephemeral child-process environment consumed and cleared by a package-owned bridge. */
	env?: NodeJS.ProcessEnv;
	/** Internal timeout recovery control; omitted means enabled. */
	finalizeOnTimeout?: boolean;
	/** Internal hard deadline for the summary attempt. */
	timeoutFinalizationMs?: number;
	/** Optional stateful result contract retained during timeout finalization. */
	timeoutResultFormat?: SubagentResultFormat;
	/** Optional non-wall-clock limits for this turn. */
	turnLimits?: TurnLimits;
	/** Override the timeout reason when an orchestration deadline caps this child. */
	workTimeoutReason?: "work_timeout" | "orchestration_timeout";
	/** Public limit value reported when the effective child timeout is only the remaining budget. */
	workTimeoutReportLimit?: number;
	/** Absolute blocking-workflow deadline that also caps model finalization. */
	orchestrationDeadlineAt?: number;
	/** Completion contract requested for this turn. */
	resultFormat?: SubagentResultFormat;
	/** Normalized request contract retained in result details. */
	contract?: DelegationContract;
	/** Original task summary shown in result details when the executed prompt has contract metadata. */
	displayTask?: string;
	/** Immutable audit or enforcement decision made before launch. */
	executionPlan?: ExecutionPlan;
	/** Executor-owned authority lifetime bound to the accepted plan generation. */
	capabilityGrant?: CapabilityGrant;
}
