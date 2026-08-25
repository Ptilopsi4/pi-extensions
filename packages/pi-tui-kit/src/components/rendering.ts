import { stripVTControlCharacters } from "node:util";
import { type Input, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { HorizontalRule } from "../horizontal-rule.js";
import { formatInteractionHints } from "../interaction-hints.js";
import { replaceTerminalControls, safeMenuText } from "../text.js";
import type { ActionMenuItem } from "../types.js";
import type { MenuKeybindings, MenuScreenComponentOptions } from "./contracts.js";

export { safeMenuText } from "../text.js";

export function actionMenuItemPresentation(item: ActionMenuItem<string, string>): {
	label: string;
	description?: string;
} {
	const label = safeMenuText(item.label);
	const description = item.description ? safeMenuText(item.description) : undefined;
	return { label: item.disabled ? `[-] ${label}` : label, description };
}

export function actionMenuUnavailableDescription(
	item: ActionMenuItem<string, string>,
): string | undefined {
	if (!item.disabled) return undefined;
	const reason = safeMenuText(item.disabledReason ?? "");
	return reason ? `Unavailable: ${reason}` : undefined;
}

export function actionMenuDialogLabel(item: ActionMenuItem<string, string>): string {
	const label = safeMenuText(item.label);
	const reason = safeMenuText(item.disabledReason ?? "");
	if (!item.disabled || !reason) return label;
	return `[-] ${label} (unavailable: ${reason})`;
}

interface FrameLayoutOptions {
	confirmAction?: string;
	hint?: string;
	pinnedContentRows?: number;
	priorityTailRows?: number;
}

export function renderFrame<ScreenId extends string, ActionId extends string>(
	title: string,
	lines: readonly string[],
	content: readonly string[],
	destination: "back" | "close",
	width: number,
	options: MenuScreenComponentOptions<ScreenId, ActionId>,
	layout: FrameLayoutOptions = {},
): string[] {
	const safeWidth = Math.max(1, width);
	const rule = renderHorizontalRule(safeWidth, options.theme);
	const titleRows = wrapTextWithAnsi(
		options.theme.fg("accent", options.theme.bold(safeMenuText(title))),
		safeWidth,
	);
	const contextRows = lines.flatMap((line) =>
		wrapTextWithAnsi(options.theme.fg("muted", safeMenuText(line)), safeWidth),
	);
	const hintRows = wrapTextWithAnsi(
		options.theme.fg(
			"dim",
			layout.hint ??
				options.interactionHint ??
				menuHint(options.keybindings, destination, layout.confirmAction ?? "select"),
		),
		safeWidth,
	);
	const fullFrame = [
		rule,
		...titleRows,
		...contextRows,
		...(content.length > 0 ? ["", ...content] : []),
		...hintRows,
		rule,
	];
	const maxRows = componentRows(options.tui.terminal.rows);
	const result =
		fullFrame.length <= maxRows
			? fullFrame
			: compactFrame(
					rule,
					titleRows,
					contextRows,
					content,
					hintRows,
					maxRows,
					layout.pinnedContentRows ?? 0,
					layout.priorityTailRows ?? 0,
				);
	return result.map((line) => truncateToWidth(line, safeWidth, ""));
}

function compactFrame(
	rule: string,
	titleRows: readonly string[],
	contextRows: readonly string[],
	contentRows: readonly string[],
	hintRows: readonly string[],
	maxRows: number,
	pinnedContentRows: number,
	priorityTailRows: number,
): string[] {
	const framed = maxRows >= 5;
	const availableRows = framed ? maxRows - 2 : maxRows;
	const compactContentRows = contentRows.filter(
		(line) => stripVTControlCharacters(line).trim().length > 0,
	);
	const body =
		compactContentRows.length > 0
			? compactInteractiveRows(
					titleRows,
					contextRows,
					compactContentRows,
					hintRows,
					availableRows,
					pinnedContentRows,
					priorityTailRows,
				)
			: compactStaticRows(titleRows, contextRows, hintRows, availableRows);
	return framed ? [rule, ...body, rule] : body;
}

function compactInteractiveRows(
	titleRows: readonly string[],
	contextRows: readonly string[],
	contentRows: readonly string[],
	hintRows: readonly string[],
	availableRows: number,
	pinnedContentRows: number,
	priorityTailRows: number,
): string[] {
	const hintBudget = hintRows.length > 0 && availableRows > 1 ? 1 : 0;
	const minimumContentRows = Math.min(
		availableRows - hintBudget,
		minimumFocusedRows(contentRows, pinnedContentRows, priorityTailRows),
	);
	let remainingRows = Math.max(0, availableRows - hintBudget - minimumContentRows);
	const titleBudget = titleRows.length > 0 && remainingRows > 0 ? 1 : 0;
	remainingRows -= titleBudget;
	const extraHintBudget = Math.min(Math.max(0, hintRows.length - hintBudget), remainingRows);
	remainingRows -= extraHintBudget;
	const contentBudget = Math.min(contentRows.length, minimumContentRows + remainingRows);
	remainingRows -= contentBudget - minimumContentRows;
	const contextBudget = Math.min(contextRows.length, remainingRows);
	const boundedContent = focusedRows(
		contentRows,
		contentBudget,
		pinnedContentRows,
		priorityTailRows,
	);
	const totalHintBudget = hintBudget + extraHintBudget;
	const boundedHints = totalHintBudget > 0 ? hintRows.slice(-totalHintBudget) : [];
	return [
		...titleRows.slice(0, titleBudget),
		...contextRows.slice(0, contextBudget),
		...boundedContent,
		...boundedHints,
	];
}

function compactStaticRows(
	titleRows: readonly string[],
	contextRows: readonly string[],
	hintRows: readonly string[],
	availableRows: number,
): string[] {
	const titleBudget = titleRows.length > 0 ? 1 : 0;
	const hintBudget = Math.min(hintRows.length, Math.max(0, availableRows - titleBudget));
	const contextBudget = Math.max(0, availableRows - titleBudget - hintBudget);
	return [
		...titleRows.slice(0, titleBudget),
		...contextRows.slice(0, contextBudget),
		...(hintBudget > 0 ? hintRows.slice(-hintBudget) : []),
	];
}

function minimumFocusedRows(rows: readonly string[], pinnedRows: number, priorityTailRows: number) {
	const priorities = priorityRowIndexes(rows, pinnedRows, priorityTailRows);
	return Math.max(1, priorities.size);
}

function focusedRows(
	rows: readonly string[],
	budget: number,
	pinnedRows = 0,
	priorityTailRows = 0,
): readonly string[] {
	if (budget <= 0) return [];
	if (rows.length <= budget) return rows;
	const indexes = priorityRowIndexes(rows, pinnedRows, priorityTailRows, budget);
	const selectedIndex = selectedRowIndex(rows);
	const fillOrder = Array.from({ length: rows.length }, (_, index) => index).sort((left, right) => {
		if (selectedIndex < 0) return left - right;
		return Math.abs(left - selectedIndex) - Math.abs(right - selectedIndex) || left - right;
	});
	for (const index of fillOrder) {
		if (indexes.size >= budget) break;
		indexes.add(index);
	}
	return [...indexes]
		.sort((left, right) => left - right)
		.map((index) => rows[index])
		.filter((line): line is string => line !== undefined);
}

function priorityRowIndexes(
	rows: readonly string[],
	pinnedRows: number,
	priorityTailRows: number,
	budget = Number.POSITIVE_INFINITY,
) {
	const indexes = new Set<number>();
	const pinned = Math.max(0, Math.min(rows.length, Math.floor(pinnedRows)));
	for (let index = 0; index < pinned && indexes.size < budget; index += 1) indexes.add(index);
	const selectedIndex = selectedRowIndex(rows);
	if (selectedIndex >= 0 && indexes.size < budget) indexes.add(selectedIndex);
	const tailStart = Math.max(pinned, rows.length - Math.max(0, Math.floor(priorityTailRows)));
	for (let index = tailStart; index < rows.length && indexes.size < budget; index += 1) {
		indexes.add(index);
	}
	return indexes;
}

function selectedRowIndex(rows: readonly string[]) {
	return rows.findIndex((line) => /^[→›]\s/u.test(stripVTControlCharacters(line)));
}

export function componentRows(rows: number) {
	const terminalRows = Number.isFinite(rows) ? Math.floor(rows) : 24;
	return Math.max(1, terminalRows - 3);
}

export function renderHorizontalRule(
	width: number,
	theme: MenuScreenComponentOptions<string, string>["theme"],
): string {
	return (
		new HorizontalRule({
			ruleStyle: (text) => theme.fg("border", text),
		}).render(Math.max(1, width))[0] ?? ""
	);
}

export function menuHint(
	keybindings: MenuKeybindings,
	destination: "back" | "close",
	confirmAction: string,
) {
	return formatInteractionHints(keybindings, [
		{ bindings: ["tui.select.up", "tui.select.down"], label: "navigate" },
		...(confirmAction ? [{ bindings: ["tui.select.confirm"] as const, label: confirmAction }] : []),
		{
			bindings: ["tui.select.cancel"],
			excludeKeys: ["ctrl+c"],
			label: destination,
		},
		...(destination === "back" ? [{ keys: ["ctrl+c"], label: "close" }] : []),
	]);
}

export function handleSearchInput(input: Input, data: string) {
	input.handleInput(data);
	const value = replaceTerminalControls(input.getValue());
	if (value !== input.getValue()) input.setValue(value);
}
