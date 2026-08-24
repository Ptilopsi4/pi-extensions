import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { SchedulingDecision } from "./adaptive-scheduler.js";
import type { AgentScope } from "./agents/types.js";
import type { OrchestrationMetrics } from "./orchestration-metrics.js";
import type { PanelSynthesis } from "./panel-contract.js";
import type { PanelEvidenceArtifact } from "./panel-evidence.js";
import type { PanelFailure } from "./panel-failure.js";
import type { PanelPhaseBudgets, PanelPreset } from "./panel-planning.js";
import type { SingleResult } from "./runner-types.js";
import type { WorkItemLedgerSnapshot } from "./work-item-ledger.js";

export interface PanelDetails {
	id: string;
	preset: PanelPreset;
	sharedTaskPreview: string;
	state: "running" | "completed" | "degraded" | "insufficient-panel" | "failed" | "cancelled";
	reviewerIds: string[];
	validReviewCount: number;
	failedReviewCount: number;
	blockingObjectionCount: number;
	dissentCount: number;
	budgets: PanelPhaseBudgets;
	evidence: PanelEvidenceArtifact[];
	failures: PanelFailure[];
	synthesis?: PanelSynthesis;
	synthesizerResult?: SingleResult;
	cleanupComplete: boolean;
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain" | "workflow" | "panel";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	aggregator?: SingleResult;
	workflow?: WorkItemLedgerSnapshot;
	schedulerDecisions?: SchedulingDecision[];
	metrics?: OrchestrationMetrics;
	panel?: PanelDetails;
	isError?: boolean;
}

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;
