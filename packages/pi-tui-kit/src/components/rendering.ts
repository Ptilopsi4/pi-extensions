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

export function renderFrame<ScreenId extends string, ActionId extends string>(
	title: string,
	lines: readonly string[],
	content: readonly string[],
	destination: "back" | "close",
	width: number,
	options: MenuScreenComponentOptions<ScreenId, ActionId>,
	confirmAction = "select",
): string[] {
	const safeWidth = Math.max(1, width);
	const rule = renderHorizontalRule(safeWidth, options.theme);
	const result = [
		rule,
		...wrapTextWithAnsi(
			options.theme.fg("accent", options.theme.bold(safeMenuText(title))),
			safeWidth,
		),
		...lines.flatMap((line) =>
			wrapTextWithAnsi(options.theme.fg("muted", safeMenuText(line)), safeWidth),
		),
		...(content.length > 0 ? ["", ...content] : []),
		...wrapTextWithAnsi(
			options.theme.fg("dim", menuHint(options.keybindings, destination, confirmAction)),
			safeWidth,
		),
		rule,
	];
	return result.map((line) => truncateToWidth(line, safeWidth, ""));
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
