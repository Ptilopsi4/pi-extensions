import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type ExtensionContext, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import {
	resolvePlanExportPath as resolveConfiguredPlanExportPath,
	safePlanExportNotification,
} from "./plan-export-path.js";
import { DEFAULT_PLAN_EXPORT_PATH } from "./settings.js";
import type { PlanModeState } from "./state.js";

export type { PlanExportDestination } from "./plan-export-path.js";
export { planExportDestination } from "./plan-export-path.js";
export { DEFAULT_PLAN_EXPORT_PATH };

export interface PlanExportResult {
	path: string;
}

export interface PlanExportLifecycle {
	signal: AbortSignal;
	isCurrent(): boolean;
	getState?(): PlanModeState;
	finishReady?(): void;
}

export async function exportStoredPlan(
	state: PlanModeState,
	requestedPath: string | undefined,
	ctx: ExtensionContext,
	lifecycle?: PlanExportLifecycle,
	defaultPath = DEFAULT_PLAN_EXPORT_PATH,
) {
	const plan =
		(state.enabled ? state.latestPlan : undefined)?.trim() ??
		state.savedPlan?.plan.trim() ??
		state.activeImplementation?.plan.trim();
	if (!plan) {
		const error = new Error(
			"No completed plan is available to export. Use /plan finalize when planning is complete.",
		);
		if (!ctx.hasUI) throw error;
		ctx.ui.notify(error.message, "warning");
		return false;
	}

	const isCurrent = () =>
		!lifecycle ||
		(lifecycle.isCurrent() && (!lifecycle.getState || lifecycle.getState() === state));
	let result: PlanExportResult;
	try {
		result = await exportPlanToFile(
			plan,
			requestedPath,
			ctx.cwd,
			lifecycle?.signal,
			isCurrent,
			defaultPath,
		);
	} catch (error: unknown) {
		if (lifecycle?.signal.aborted || !isCurrent()) return false;
		if (!ctx.hasUI) throw error;
		const detail = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(safePlanExportNotification(`Unable to export plan: ${detail}`), "error");
		return false;
	}

	if (!isCurrent()) return false;
	const finishedReady =
		state.enabled && Boolean(state.latestPlan?.trim()) && lifecycle?.finishReady !== undefined;
	if (finishedReady) lifecycle.finishReady?.();
	const detail = finishedReady ? " Plan mode disabled." : "";
	ctx.ui.notify(safePlanExportNotification(`Plan exported to ${result.path}.${detail}`), "info");
	return true;
}

export function resolvePlanExportPath(
	requestedPath: string | undefined,
	cwd: string,
	defaultPath = DEFAULT_PLAN_EXPORT_PATH,
) {
	return resolveConfiguredPlanExportPath(requestedPath, cwd, defaultPath);
}

export async function exportPlanToFile(
	plan: string,
	requestedPath: string | undefined,
	cwd: string,
	signal?: AbortSignal,
	isCurrent: () => boolean = () => true,
	defaultPath = DEFAULT_PLAN_EXPORT_PATH,
): Promise<PlanExportResult> {
	const path = resolvePlanExportPath(requestedPath, cwd, defaultPath);
	await withFileMutationQueue(path, async () => {
		throwIfCancelled(signal, isCurrent);
		await mkdir(dirname(path), { recursive: true });
		throwIfCancelled(signal, isCurrent);
		try {
			await writeFile(path, `${plan}\n`, { encoding: "utf8", flag: "wx" });
		} catch (error: unknown) {
			if (isNodeError(error) && error.code === "EEXIST") {
				throw new Error(
					`Plan export target already exists: ${path}. Choose another path or remove it first.`,
				);
			}
			throw error;
		}
	});
	return { path };
}

function throwIfCancelled(signal: AbortSignal | undefined, isCurrent: () => boolean) {
	if (!signal?.aborted && isCurrent()) return;
	throw signal?.reason instanceof Error
		? signal.reason
		: new DOMException("Plan export cancelled", "AbortError");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
