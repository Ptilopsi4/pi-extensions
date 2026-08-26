import type {
	CompletionDelivery,
	DelegationCwdPolicy,
	SubagentSettings,
	SubagentTransportKind,
} from "../agents/types.js";
import {
	resolveStatefulLimits,
	STATEFUL_LIMIT_FIELDS,
	type StatefulLimitField,
} from "../stateful-limits.js";
import { hasOwn, isPlainObject } from "./schema.js";

const DEFAULT_COMPLETION_DELIVERY: CompletionDelivery = "next-turn";
export const DEFAULT_DELEGATION_CWD_POLICY: DelegationCwdPolicy = "trusted-targets";

type SettingsSource = "default" | "user settings";

export interface InspectedSubagentSettingsDocument {
	path: string;
	raw?: Record<string, unknown>;
	settings?: SubagentSettings;
	error?: string;
}

export interface CompletionDeliverySettingsSnapshot {
	path: string;
	value: CompletionDelivery;
	source: SettingsSource;
	error?: string;
}

export interface StatefulEnabledSettingsSnapshot {
	path: string;
	value: boolean;
	source: SettingsSource;
	error?: string;
}

export interface StatefulTransportSettingsSnapshot {
	path: string;
	value: SubagentTransportKind;
	source: SettingsSource;
	error?: string;
}

export interface StatefulLimitFieldSnapshot {
	value: number;
	source: SettingsSource;
}

export interface StatefulLimitSettingsSnapshot {
	path: string;
	writePath: string;
	values?: Record<StatefulLimitField, StatefulLimitFieldSnapshot>;
	error?: string;
}

export interface CwdPolicyFieldSnapshot<T> {
	value: T;
	source: SettingsSource;
}

export interface CwdPolicySettingsSnapshot {
	path: string;
	delegation: CwdPolicyFieldSnapshot<DelegationCwdPolicy>;
	error?: string;
}

export interface SubagentSettingsSnapshot {
	path: string;
	settings?: SubagentSettings;
	source: SettingsSource;
	error?: string;
}

export interface UsageRecordingSettingsSnapshot {
	path: string;
	enabled: boolean;
	source: SettingsSource;
	error?: string;
}

export function buildSubagentSettingsSnapshot(
	inspected: InspectedSubagentSettingsDocument,
): SubagentSettingsSnapshot {
	return {
		path: inspected.path,
		settings: inspected.settings,
		source: inspected.settings ? "user settings" : "default",
		...(inspected.error ? { error: inspected.error } : {}),
	};
}

export function buildUsageRecordingSettingsSnapshot(
	inspected: InspectedSubagentSettingsDocument,
): UsageRecordingSettingsSnapshot {
	if (!inspected.raw || !inspected.settings) {
		return {
			path: inspected.path,
			enabled: false,
			source: "default",
			...(inspected.error ? { error: inspected.error } : {}),
		};
	}
	const explicit =
		isPlainObject(inspected.raw.usageRecording) && hasOwn(inspected.raw.usageRecording, "enabled");
	return {
		path: inspected.path,
		enabled: inspected.settings.usageRecording?.enabled === true,
		source: explicit ? "user settings" : "default",
	};
}

export function buildCwdPolicySettingsSnapshot(
	inspected: InspectedSubagentSettingsDocument,
): CwdPolicySettingsSnapshot {
	if (!inspected.raw || !inspected.settings) {
		return {
			path: inspected.path,
			delegation: { value: DEFAULT_DELEGATION_CWD_POLICY, source: "default" },
			...(inspected.error ? { error: inspected.error } : {}),
		};
	}
	const rawPolicy = isPlainObject(inspected.raw.cwdPolicy) ? inspected.raw.cwdPolicy : undefined;
	return {
		path: inspected.path,
		delegation: {
			value: inspected.settings.cwdPolicy?.delegation ?? DEFAULT_DELEGATION_CWD_POLICY,
			source: rawPolicy && hasOwn(rawPolicy, "delegation") ? "user settings" : "default",
		},
	};
}

export function buildStatefulEnabledSettingsSnapshot(
	inspected: InspectedSubagentSettingsDocument,
): StatefulEnabledSettingsSnapshot {
	if (!inspected.raw || !inspected.settings) {
		return {
			path: inspected.path,
			value: true,
			source: "default",
			...(inspected.error ? { error: inspected.error } : {}),
		};
	}
	const explicit =
		isPlainObject(inspected.raw.stateful) && hasOwn(inspected.raw.stateful, "enabled");
	return {
		path: inspected.path,
		value: inspected.settings.stateful?.enabled !== false,
		source: explicit ? "user settings" : "default",
	};
}

export function buildCompletionDeliverySettingsSnapshot(
	inspected: InspectedSubagentSettingsDocument,
): CompletionDeliverySettingsSnapshot {
	if (!inspected.raw || !inspected.settings) {
		return {
			path: inspected.path,
			value: DEFAULT_COMPLETION_DELIVERY,
			source: "default",
			...(inspected.error ? { error: inspected.error } : {}),
		};
	}
	const explicit =
		isPlainObject(inspected.raw.stateful) && hasOwn(inspected.raw.stateful, "completionDelivery");
	return {
		path: inspected.path,
		value: inspected.settings.stateful?.completionDelivery ?? DEFAULT_COMPLETION_DELIVERY,
		source: explicit ? "user settings" : "default",
	};
}

export function buildStatefulTransportSettingsSnapshot(
	inspected: InspectedSubagentSettingsDocument,
): StatefulTransportSettingsSnapshot {
	if (!inspected.raw || !inspected.settings) {
		return {
			path: inspected.path,
			value: "subprocess",
			source: "default",
			...(inspected.error ? { error: inspected.error } : {}),
		};
	}
	const explicit =
		isPlainObject(inspected.raw.stateful) && hasOwn(inspected.raw.stateful, "transport");
	return {
		path: inspected.path,
		value: inspected.settings.stateful?.transport ?? "subprocess",
		source: explicit ? "user settings" : "default",
	};
}

export function buildStatefulLimitSettingsSnapshot(
	inspected: InspectedSubagentSettingsDocument,
	writePath: string,
): StatefulLimitSettingsSnapshot {
	if (inspected.error) {
		return { path: inspected.path, writePath, error: inspected.error };
	}
	const resolved = resolveStatefulLimits(inspected.settings?.stateful);
	const rawStateful = isPlainObject(inspected.raw?.stateful) ? inspected.raw.stateful : undefined;
	return {
		path: inspected.path,
		writePath,
		values: Object.fromEntries(
			STATEFUL_LIMIT_FIELDS.map((field) => [
				field,
				{
					value: resolved[field],
					source: rawStateful && hasOwn(rawStateful, field) ? "user settings" : "default",
				},
			]),
		) as unknown as Record<StatefulLimitField, StatefulLimitFieldSnapshot>,
	};
}
