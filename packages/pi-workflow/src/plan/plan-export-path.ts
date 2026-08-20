import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

export interface PlanExportDestination {
	configuredPath: string;
	resolvedPath: string;
}

export function planExportDestination(defaultPath: string, cwd: string): PlanExportDestination {
	return {
		configuredPath: safePlanExportNotification(defaultPath),
		resolvedPath: safePlanExportNotification(resolvePlanExportPath(undefined, cwd, defaultPath)),
	};
}

export function resolvePlanExportPath(
	requestedPath: string | undefined,
	cwd: string,
	defaultPath: string,
) {
	const rawPath = requestedPath?.trim() || defaultPath;
	const normalizedPath = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
	if (!normalizedPath.trim()) throw new Error("Plan export path must not be empty.");
	if (normalizedPath.includes("\0")) {
		throw new Error("Plan export path must not contain NUL bytes.");
	}
	return resolve(cwd, normalizedPath);
}

export function safePlanExportNotification(value: string) {
	let sanitized = "";
	for (const character of stripVTControlCharacters(value)) {
		const codePoint = character.codePointAt(0);
		sanitized +=
			codePoint !== undefined && codePoint > 0x1f && !(codePoint >= 0x7f && codePoint <= 0x9f)
				? character
				: " ";
	}
	return sanitized;
}
