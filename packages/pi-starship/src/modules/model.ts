import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";
import { parseColor } from "../format/style.js";
import { modelColorHex } from "./model-color.js";
import { defineModule, type ModuleOptionValue } from "./types.js";

const TRUNCATION_DIRECTIONS = ["start", "middle", "end"] as const;
type TruncationDirection = (typeof TRUNCATION_DIRECTIONS)[number];
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const modelModule = defineModule({
	name: "model",
	variables: ["symbol", "model"],
	defaults: {
		format: "[$symbol $model ]($style)",
		symbol: "🤖",
		style: "bold blue",
		disabled: false,
	},
	options: {
		truncation_length: { kind: "integer", default: 0, minimum: 0, maximum: 1000 },
		truncation_symbol: { kind: "string", default: "…" },
		truncation_direction: {
			kind: "string-enum",
			default: "end",
			values: TRUNCATION_DIRECTIONS,
		},
		model_aliases: { kind: "string-map", default: {} },
		model_styles: { kind: "style-map", default: {} },
		hash_colors: { kind: "boolean", default: true },
	},
	styleVariables: ["style"],
	resolveStyleVariables: ({ runtime, style, options }) => {
		const id = runtime.model?.id;
		if (!id) return { style };
		const map = styleMapOption(options, "model_styles");
		const exact = map[id];
		if (exact) return { style: exact };
		let longest: string | undefined;
		let longestLength = 0;
		for (const [key, value] of Object.entries(map)) {
			if (key.length > longestLength && id.startsWith(key)) {
				longest = value;
				longestLength = key.length;
			}
		}
		if (longest) return { style: longest };
		if (options.hash_colors === false) return { style };
		// Hash coloring applies when the style has no explicit color: the built-in
		// default and modifier-only styles keep their modifiers while the hash
		// supplies the color; an explicit color stays fully user-controlled.
		if (style === DEFAULT_MODEL_STYLE || !hasExplicitColor(style)) {
			return { style: hashModelStyle(id, style) };
		}
		return { style };
	},
	values: ({ runtime, options }) => {
		if (!runtime.model) return undefined;
		const length = typeof options.truncation_length === "number" ? options.truncation_length : 0;
		const symbol = typeof options.truncation_symbol === "string" ? options.truncation_symbol : "…";
		const direction = isTruncationDirection(options.truncation_direction)
			? options.truncation_direction
			: "end";
		const aliases = options.model_aliases;
		const aliasMap =
			aliases && typeof aliases === "object" && !Array.isArray(aliases)
				? (aliases as Readonly<Record<string, string>>)
				: undefined;
		const alias =
			aliasMap && Object.hasOwn(aliasMap, runtime.model.id)
				? aliasMap[runtime.model.id]
				: undefined;
		return {
			model: truncateModel(alias ?? shortenModel(runtime.model.id), length, symbol, direction),
		};
	},
});

export function truncateModel(
	model: string,
	length: number,
	symbol: string,
	direction: TruncationDirection,
): string {
	const safeModel = sanitizeTerminalText(model);
	if (length === 0) return safeModel;
	const graphemes = [...graphemeSegmenter.segment(safeModel)].map(({ segment }) => segment);
	if (graphemes.length <= length) return safeModel;
	const safeSymbol = sanitizeTerminalText(symbol);

	switch (direction) {
		case "start":
			return `${safeSymbol}${graphemes.slice(-length).join("")}`;
		case "middle": {
			const headLength = Math.ceil(length / 2);
			const tailLength = Math.floor(length / 2);
			const tail = tailLength > 0 ? graphemes.slice(-tailLength).join("") : "";
			return `${graphemes.slice(0, headLength).join("")}${safeSymbol}${tail}`;
		}
		case "end":
			return `${graphemes.slice(0, length).join("")}${safeSymbol}`;
	}
}

function isTruncationDirection(value: unknown): value is TruncationDirection {
	return TRUNCATION_DIRECTIONS.includes(value as TruncationDirection);
}

export function shortenModel(model: string): string {
	return model
		.replace(/^claude-/u, "")
		.replace(/^gpt-/u, "gpt ")
		.replace(/-20\d{6}$/u, "")
		.replace(/-latest$/u, "");
}

const DEFAULT_MODEL_STYLE = "bold blue";

function styleMapOption(
	options: Readonly<Record<string, ModuleOptionValue>>,
	name: string,
): Readonly<Record<string, string>> {
	const value = options[name];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Readonly<Record<string, string>>)
		: {};
}

/** Replace the color of the module style with the deterministic model hash color. */
export function hashModelStyle(modelId: string, baseStyle: string): string {
	const modifiers = baseStyle
		.split(/\s+/u)
		.filter(Boolean)
		.filter((token) => token !== "none" && !parseColor(token));
	return [...modifiers, modelColorHex(modelId)].join(" ");
}

function hasExplicitColor(style: string): boolean {
	return style
		.split(/\s+/u)
		.filter(Boolean)
		.some((token) => {
			if (token === "none") return false;
			const normalized = token.replace(/^(?:fg:|bg:)+/u, "");
			return parseColor(normalized) !== undefined;
		});
}
