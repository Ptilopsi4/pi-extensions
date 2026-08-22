import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_GOAL_SETTINGS,
	type GoalSettings,
	normalizeGoalSettings,
} from "./goal/settings.js";
import {
	normalizePlanModeSettings,
	type PlanModeSettings,
	type PlanModeSettingsPatch,
} from "./plan/settings.js";

export const WORKFLOW_SETTINGS_FILE = "pi-workflow.json";
const MAX_SETTINGS_BYTES = 64 * 1024;
export const PLAN_HANDOFF_BEHAVIORS = ["review", "automatic"] as const;

export type PlanHandoffBehavior = (typeof PLAN_HANDOFF_BEHAVIORS)[number];

export interface WorkflowSettingsSnapshot {
	planHandoff: PlanHandoffBehavior;
	plan: PlanModeSettings;
	goal: GoalSettings;
}

export type WorkflowSettingsLoadResult =
	| { kind: "missing" }
	| { kind: "invalid"; reason: string }
	| { kind: "loaded"; settings: WorkflowSettingsSnapshot };

type SettingsDocument = Record<string, unknown>;

interface LoadedDocument {
	document: SettingsDocument;
	settings: WorkflowSettingsSnapshot;
}

interface WriteOptions {
	signal?: AbortSignal;
	beforeRename?: (temporaryPath: string, settingsPath: string) => void;
}

export function workflowSettingsPath(): string {
	return join(getAgentDir(), WORKFLOW_SETTINGS_FILE);
}

export function readWorkflowSettings(
	settingsPath = workflowSettingsPath(),
): WorkflowSettingsLoadResult {
	const loaded = readDocument(settingsPath);
	return loaded.kind === "loaded" ? { kind: "loaded", settings: loaded.value.settings } : loaded;
}

export function updateWorkflowPlanHandoff(
	behavior: PlanHandoffBehavior,
	settingsPath = workflowSettingsPath(),
	options: WriteOptions = {},
): WorkflowSettingsSnapshot {
	if (!PLAN_HANDOFF_BEHAVIORS.includes(behavior)) {
		throw new Error(`Unsupported Plan handoff behavior: ${String(behavior)}`);
	}
	const current = documentForMutation(settingsPath);
	const workflow = ownRecord(current.workflow) ?? {};
	const document = {
		...current,
		workflow: { ...workflow, planHandoff: behavior },
	};
	const settings = normalizeWorkflowDocument(document);
	if (!settings) throw invalidSettingsError(settingsPath, "invalid settings shape");
	publishDocument(settingsPath, document, options);
	return settings;
}

export function readWorkflowPlanSettings(settingsPath = workflowSettingsPath()) {
	const loaded = readWorkflowSettings(settingsPath);
	if (loaded.kind !== "loaded") return loaded;
	return { kind: "loaded" as const, settings: loaded.settings.plan };
}

export async function updateWorkflowPlanSettings(
	patch: PlanModeSettingsPatch,
	options: WriteOptions & { settingsPath?: string } = {},
): Promise<PlanModeSettings> {
	options.signal?.throwIfAborted();
	const settingsPath = options.settingsPath ?? workflowSettingsPath();
	const current = documentForMutation(settingsPath);
	const plan = { ...(ownRecord(current.plan) ?? {}) };
	if (patch.thinkingLevel !== undefined) plan.thinkingLevel = patch.thinkingLevel;
	if (patch.defaultPlanTools === null) delete plan.defaultPlanTools;
	else if (patch.defaultPlanTools !== undefined) {
		plan.defaultPlanTools = [...patch.defaultPlanTools];
	}
	if (patch.defaultPlanExportPath === null) delete plan.defaultPlanExportPath;
	else if (patch.defaultPlanExportPath !== undefined) {
		plan.defaultPlanExportPath = patch.defaultPlanExportPath;
	}
	if (patch.toggleShortcut === null) delete plan.toggleShortcut;
	else if (patch.toggleShortcut !== undefined) plan.toggleShortcut = patch.toggleShortcut;
	const normalized = normalizeWorkflowPlanSettings(plan);
	if (!normalized) throw invalidSettingsError(settingsPath, "invalid Plan settings shape");
	const document = { ...current, plan };
	if (!normalizeWorkflowDocument(document)) {
		throw invalidSettingsError(settingsPath, "invalid settings shape");
	}
	publishDocument(settingsPath, document, options);
	return normalized;
}

export function readWorkflowGoalSettings(settingsPath = workflowSettingsPath()) {
	const loaded = readWorkflowSettings(settingsPath);
	if (loaded.kind !== "loaded") return loaded;
	return { kind: "loaded" as const, settings: loaded.settings.goal };
}

export function saveWorkflowGoalSettings(
	settings: GoalSettings,
	settingsPath = workflowSettingsPath(),
	options: WriteOptions = {},
): void {
	const normalized = normalizeGoalSettings(settings);
	if (!normalized) throw new Error("Refusing to save invalid pi-workflow Goal settings.");
	const current = documentForMutation(settingsPath);
	const goal = ownRecord(current.goal) ?? {};
	const experimental = ownRecord(goal.experimental) ?? {};
	const rpc = ownRecord(goal.rpc) ?? {};
	const continuationLimits = ownRecord(goal.continuationLimits) ?? {};
	const document = {
		...current,
		goal: {
			...goal,
			toolVisibility: normalized.toolVisibility,
			experimental: { ...experimental, goals: normalized.experimental.goals },
			rpc: { ...rpc, enabled: normalized.rpc.enabled },
			continuationLimits: {
				...continuationLimits,
				automaticTurns: normalized.continuationLimits.automaticTurns,
				noProgressTurns: normalized.continuationLimits.noProgressTurns,
			},
		},
	};
	if (!normalizeWorkflowDocument(document)) {
		throw invalidSettingsError(settingsPath, "invalid settings shape");
	}
	publishDocument(settingsPath, document, options);
}

function normalizeWorkflowDocument(value: unknown): WorkflowSettingsSnapshot | undefined {
	const document = ownRecord(value);
	if (!document) return undefined;
	const workflow = section(document, "workflow");
	const plan = section(document, "plan");
	const goal = section(document, "goal");
	if (!workflow || !plan || !goal) return undefined;
	const planHandoff = Object.hasOwn(workflow, "planHandoff") ? workflow.planHandoff : "review";
	if (!PLAN_HANDOFF_BEHAVIORS.includes(planHandoff as PlanHandoffBehavior)) return undefined;
	const normalizedPlan = normalizeWorkflowPlanSettings(plan);
	const normalizedGoal = normalizeGoalSettings(goal);
	if (!normalizedPlan || !normalizedGoal) return undefined;
	return {
		planHandoff: planHandoff as PlanHandoffBehavior,
		plan: normalizedPlan,
		goal: normalizedGoal,
	};
}

function normalizeWorkflowPlanSettings(value: unknown): PlanModeSettings | undefined {
	const plan = ownRecord(value);
	if (!plan) return undefined;
	const supported = { ...plan };
	delete supported.implementationPlanRetention;
	return normalizePlanModeSettings(supported);
}

function section(document: SettingsDocument, key: string): SettingsDocument | undefined {
	if (!Object.hasOwn(document, key)) return {};
	return ownRecord(document[key]);
}

function readDocument(
	settingsPath: string,
):
	| { kind: "missing" }
	| { kind: "invalid"; reason: string }
	| { kind: "loaded"; value: LoadedDocument } {
	let descriptor: number | undefined;
	try {
		descriptor = openSync(
			settingsPath,
			constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0),
		);
		const stats = fstatSync(descriptor);
		if (!stats.isFile()) throw new Error("settings path is not a regular file");
		if (stats.size > MAX_SETTINGS_BYTES) {
			throw new Error(`settings file exceeds ${MAX_SETTINGS_BYTES} bytes`);
		}
		const buffer = readFileSync(descriptor);
		if (buffer.byteLength > MAX_SETTINGS_BYTES) {
			throw new Error(`settings file exceeds ${MAX_SETTINGS_BYTES} bytes`);
		}
		let contents: string;
		try {
			contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
		} catch {
			return { kind: "invalid", reason: `${settingsPath}: settings file is not valid UTF-8` };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(contents) as unknown;
		} catch {
			return { kind: "invalid", reason: `${settingsPath}: invalid JSON` };
		}
		const document = ownRecord(parsed);
		const settings = normalizeWorkflowDocument(parsed);
		if (!document || !settings) {
			return { kind: "invalid", reason: `${settingsPath}: invalid settings shape` };
		}
		return { kind: "loaded", value: { document, settings } };
	} catch (error: unknown) {
		if (isNodeError(error) && error.code === "ENOENT") return { kind: "missing" };
		const reason =
			isNodeError(error) && error.code === "ELOOP"
				? "settings path is not a regular file"
				: formatError(error);
		return { kind: "invalid", reason: `${settingsPath}: ${reason}` };
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}

function documentForMutation(settingsPath: string): SettingsDocument {
	const loaded = readDocument(settingsPath);
	if (loaded.kind === "missing") return {};
	if (loaded.kind === "invalid") throw invalidSettingsError(settingsPath, loaded.reason);
	return loaded.value.document;
}

function publishDocument(
	settingsPath: string,
	document: SettingsDocument,
	options: WriteOptions,
): void {
	options.signal?.throwIfAborted();
	const contents = `${JSON.stringify(document, null, 2)}\n`;
	if (Buffer.byteLength(contents, "utf8") > MAX_SETTINGS_BYTES) {
		throw new Error(`settings document exceeds ${MAX_SETTINGS_BYTES} bytes`);
	}
	const directory = dirname(settingsPath);
	mkdirSync(directory, { recursive: true });
	options.signal?.throwIfAborted();
	const temporaryPath = join(directory, `.${basename(settingsPath)}.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporaryPath, contents, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		options.beforeRename?.(temporaryPath, settingsPath);
		options.signal?.throwIfAborted();
		renameSync(temporaryPath, settingsPath);
	} finally {
		try {
			rmSync(temporaryPath, { force: true });
		} catch {
			// Cleanup must not replace the publication result.
		}
	}
}

function ownRecord(value: unknown): SettingsDocument | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as SettingsDocument)
		: undefined;
}

function invalidSettingsError(settingsPath: string, reason: string) {
	return new Error(`pi-workflow settings at ${settingsPath} are invalid: ${reason}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export { DEFAULT_GOAL_SETTINGS };
