export const USAGE_RECORDING_DIRECTORY = "pi-subagents-usage";
export const USAGE_RECORDING_RETENTION_DAYS = 30;
export const USAGE_RECORDING_STUDY_ID = "pi-subagents-surface-v1";

export interface SubagentUsageRecordingSettings {
	enabled?: boolean;
}

export function resolveUsageRecordingEnabled(
	settings: SubagentUsageRecordingSettings | undefined,
): boolean {
	return settings?.enabled === true;
}
