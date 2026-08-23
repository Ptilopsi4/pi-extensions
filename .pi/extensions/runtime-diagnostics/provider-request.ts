const PLAN_MODE_MARKER = "[CODEX-LIKE PLAN MODE ACTIVE]";
const MAX_TOOL_NAMES = 200;
const MAX_TOOL_NAME_LENGTH = 128;

export interface ProviderRequestDiagnostic {
	version: 1;
	requestIndex: number;
	capturedAt: number;
	sessionId: string;
	provider: string | null;
	model: string | null;
	planModeMarkerPresent: boolean;
	topLevelToolNames: string[];
	transcriptToolNames: string[];
}

export interface ProviderRequestIdentity {
	requestIndex: number;
	capturedAt: number;
	sessionId: string;
	provider?: string;
	model?: string;
}

export function extractProviderRequestDiagnostic(
	payload: unknown,
	identity: ProviderRequestIdentity,
): ProviderRequestDiagnostic {
	const root = asRecord(payload);
	return {
		version: 1,
		requestIndex: identity.requestIndex,
		capturedAt: identity.capturedAt,
		sessionId: identity.sessionId,
		provider: identity.provider ?? null,
		model: identity.model ?? null,
		planModeMarkerPresent: containsMarker(root?.instructions),
		topLevelToolNames: extractToolNames(root?.tools),
		transcriptToolNames: extractTranscriptToolNames(root?.input),
	};
}

export function isProviderRequestDiagnostic(value: unknown): value is ProviderRequestDiagnostic {
	const record = asRecord(value);
	return (
		record?.version === 1 &&
		typeof record.requestIndex === "number" &&
		Number.isInteger(record.requestIndex) &&
		typeof record.capturedAt === "number" &&
		typeof record.sessionId === "string" &&
		(record.provider === null || typeof record.provider === "string") &&
		(record.model === null || typeof record.model === "string") &&
		typeof record.planModeMarkerPresent === "boolean" &&
		isStringArray(record.topLevelToolNames) &&
		isStringArray(record.transcriptToolNames)
	);
}

function extractTranscriptToolNames(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	const names: string[] = [];
	for (const item of input) {
		const record = asRecord(item);
		if (record?.type !== "additional_tools" && record?.type !== "tool_search_output") {
			continue;
		}
		names.push(...extractToolNames(record.tools));
		if (record.type === "tool_search_output") {
			const output = asRecord(record.output);
			names.push(...extractToolNames(Array.isArray(record.output) ? record.output : output?.tools));
		}
	}
	return uniqueNames(names);
}

function extractToolNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const names: string[] = [];
	for (const candidate of value) {
		const record = asRecord(candidate);
		if (!record) continue;
		const functionDefinition = asRecord(record.function);
		const customDefinition = asRecord(record.custom);
		const name = firstName(record.name, functionDefinition?.name, customDefinition?.name);
		if (name) names.push(name);
	}
	return uniqueNames(names);
}

function containsMarker(value: unknown): boolean {
	if (typeof value === "string") return value.includes(PLAN_MODE_MARKER);
	if (Array.isArray(value)) return value.some(containsMarker);
	const record = asRecord(value);
	if (!record) return false;
	return containsMarker(record.text) || containsMarker(record.content);
}

function firstName(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value !== "string") continue;
		const normalized = value.trim();
		if (!normalized) continue;
		return normalized.length > MAX_TOOL_NAME_LENGTH
			? `${normalized.slice(0, MAX_TOOL_NAME_LENGTH - 1)}…`
			: normalized;
	}
	return undefined;
}

function uniqueNames(names: readonly string[]): string[] {
	return [...new Set(names)]
		.sort((left, right) => left.localeCompare(right))
		.slice(0, MAX_TOOL_NAMES);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
