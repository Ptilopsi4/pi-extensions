import type { SubagentRuntimeSettings } from "./agents/types.js";

export const STATEFUL_LIMIT_FIELDS = [
	"maxAgents",
	"maxActiveTurns",
	"maxChildrenPerAgent",
	"maxDepth",
	"maxStoredAgents",
] as const;

export type StatefulLimitField = (typeof STATEFUL_LIMIT_FIELDS)[number];

export interface StatefulLimits {
	maxAgents: number;
	maxActiveTurns: number;
	maxChildrenPerAgent: number;
	maxDepth: number;
	maxStoredAgents: number;
}

export interface StatefulLimitDefinition {
	field: StatefulLimitField;
	label: string;
	description: string;
	defaultValue: number;
	minimum: number;
}

export const STATEFUL_LIMIT_DEFINITIONS: readonly StatefulLimitDefinition[] = [
	{
		field: "maxAgents",
		label: "Subagents saved for follow-up",
		description: "Working, queued, and reusable background subagents kept in one session",
		defaultValue: 16,
		minimum: 1,
	},
	{
		field: "maxActiveTurns",
		label: "Subagents working at once",
		description: "Background subagent turns that may run at the same time",
		defaultValue: 4,
		minimum: 1,
	},
	{
		field: "maxChildrenPerAgent",
		label: "Direct children per subagent",
		description: "Subagents that one parent subagent may keep for follow-up",
		defaultValue: 8,
		minimum: 1,
	},
	{
		field: "maxDepth",
		label: "Nested subagent levels",
		description: "Child levels allowed below a top-level subagent",
		defaultValue: 3,
		minimum: 0,
	},
	{
		field: "maxStoredAgents",
		label: "Stored subagent records",
		description: "Background subagent records kept on disk for each session",
		defaultValue: 50,
		minimum: 1,
	},
];

const definitionsByField = new Map(
	STATEFUL_LIMIT_DEFINITIONS.map((definition) => [definition.field, definition]),
);

export function statefulLimitDefinition(field: StatefulLimitField): StatefulLimitDefinition {
	const definition = definitionsByField.get(field);
	if (!definition) throw new Error(`Unknown stateful limit: ${field}`);
	return definition;
}

export function isStatefulLimitField(value: string): value is StatefulLimitField {
	return (STATEFUL_LIMIT_FIELDS as readonly string[]).includes(value);
}

export function isValidStatefulLimit(field: StatefulLimitField, value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= statefulLimitDefinition(field).minimum
	);
}

export function resolveStatefulLimits(settings?: SubagentRuntimeSettings): StatefulLimits {
	return Object.fromEntries(
		STATEFUL_LIMIT_DEFINITIONS.map((definition) => [
			definition.field,
			settings?.[definition.field] ?? definition.defaultValue,
		]),
	) as unknown as StatefulLimits;
}
