import type { ColorSpec } from "../format/style.js";
import { defineModule } from "./types.js";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

function thinkingLevelOf(value: string): ThinkingLevel | undefined {
	return THINKING_LEVELS.find((level) => level === value);
}

/** Built-in dark-theme gradient fallback for headless or unknown-theme renders. */
const DARK_LEVEL_STYLES: Readonly<Record<ThinkingLevel, string>> = {
	off: "bold #505050",
	minimal: "bold #6e6e6e",
	low: "bold #5f87af",
	medium: "bold #81a2be",
	high: "bold #b294bb",
	xhigh: "bold #d183e8",
	max: "bold #ff5fff",
};

export const thinkingModule = defineModule({
	name: "thinking",
	variables: ["symbol", "level"],
	defaults: {
		format: "[$symbol $level ]($style)",
		symbol: "🧠",
		style: "bold purple",
		disabled: false,
	},
	// Empty defaults mean "follow the current native TUI theme"; the built-in
	// dark gradient remains a fallback when no theme colors are available.
	styleDefaults: Object.fromEntries(
		THINKING_LEVELS.map((level) => [`style_${level}`, ""]),
	) as Record<`style_${ThinkingLevel}`, string>,
	styleVariables: ["style"],
	resolveStyleVariables: ({ runtime, styles, style }) => {
		const level = thinkingLevelOf(runtime.thinkingLevel);
		if (!level) return { style };
		const customized = styles[`style_${level}`];
		if (customized) return { style: customized };
		const themed = runtime.thinkingTheme?.[level];
		if (themed) return { style: colorSpecToStyleString(themed) };
		return { style: DARK_LEVEL_STYLES[level] ?? style };
	},
	values: ({ runtime }) => ({ level: runtime.thinkingLevel }),
});

export function colorSpecToStyleString(spec: ColorSpec): string {
	switch (spec.kind) {
		case "named":
			return spec.name;
		case "fixed":
			return `${spec.value}`;
		case "rgb":
			return `#${byteHex(spec.red)}${byteHex(spec.green)}${byteHex(spec.blue)}`;
	}
}

function byteHex(value: number): string {
	return value.toString(16).padStart(2, "0");
}
