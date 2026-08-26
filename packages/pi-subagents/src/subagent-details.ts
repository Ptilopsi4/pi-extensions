import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentScope } from "./agents/types.js";
import type { SingleResult } from "./runner-types.js";

export interface SubagentDetails {
	mode: "single";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	isError?: boolean;
}

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;
