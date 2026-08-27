import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeConfig } from "../src/config.js";
import { renderStatusline } from "../src/modules/index.js";
import type { StarshipRuntimeSnapshot } from "../src/modules/types.js";
import { ansiToColorSpec } from "../src/pi-starship.js";

const ESC = String.fromCharCode(27);

function fixture(overrides: Partial<StarshipRuntimeSnapshot> = {}): StarshipRuntimeSnapshot {
	return {
		cwd: "/work/pi-extensions",
		model: { provider: "anthropic", id: "claude-sonnet-4-20250514" },
		thinkingLevel: "high",
		turnCount: 0,
		activeTools: new Map(),
		isStreaming: false,
		contextUsage: undefined,
		tokenTotals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		usingSubscription: false,
		gitBranch: null,
		gitStatus: {
			ahead: 0,
			behind: 0,
			stashed: 0,
			conflicted: 0,
			deleted: 0,
			renamed: 0,
			modified: 0,
			staged: 0,
			typechanged: 0,
			untracked: 0,
			worktreeAdded: 0,
			worktreeDeleted: 0,
			worktreeModified: 0,
			worktreeTypechanged: 0,
			indexAdded: 0,
			indexDeleted: 0,
			indexModified: 0,
			indexTypechanged: 0,
		},
		extensionStatuses: new Map(),
		now: new Date(2026, 0, 1, 9, 5),
		...overrides,
	};
}

test("ansiToColorSpec parses 256-color and truecolor prefixes", () => {
	assert.deepEqual(ansiToColorSpec(`${ESC}[38;5;80m`), { kind: "fixed", value: 80 });
	assert.deepEqual(ansiToColorSpec(`${ESC}[38;2;178;148;187m`), {
		kind: "rgb",
		red: 178,
		green: 148,
		blue: 187,
	});
	assert.equal(ansiToColorSpec("plain"), undefined);
	assert.equal(ansiToColorSpec(`${ESC}[38;5;999m`), undefined);
	assert.equal(ansiToColorSpec(`${ESC}[39m`), undefined);
});

test("thinking uses the built-in dark gradient without a theme", () => {
	const rendered = renderStatusline(normalizeConfig({}).config, fixture());
	// #b294bb for the high level.
	assert.ok(rendered.ansi.includes(`38;2;178;148;187`), rendered.ansi);
});

test("thinking follows the native theme colors when provided", () => {
	const runtime = fixture({
		thinkingTheme: {
			high: { kind: "rgb", red: 255, green: 0, blue: 0 },
		},
	});
	const rendered = renderStatusline(normalizeConfig({}).config, runtime);
	assert.ok(rendered.ansi.includes(`38;2;255;0;0`), rendered.ansi);
});

test("thinking level styles override the theme colors", () => {
	const { config } = normalizeConfig({
		thinking: { style_high: "bold red", style_off: "dimmed blue" },
	});
	const rendered = renderStatusline(config, fixture());
	assert.ok(rendered.ansi.includes("31;1m"), rendered.ansi);
	const off = renderStatusline(config, fixture({ thinkingLevel: "off" }));
	assert.match(off.ansi, /\[34;2m|\[2;34m/u, off.ansi);
});

test("unknown thinking levels fall back to the module style", () => {
	const rendered = renderStatusline(normalizeConfig({}).config, fixture({ thinkingLevel: "deep" }));
	assert.ok(rendered.ansi.includes("35;1m"), rendered.ansi);
});

test("model uses a deterministic hash color by default", () => {
	const rendered = renderStatusline(normalizeConfig({}).config, fixture());
	assert.match(rendered.ansi, /38;2;\d{1,3};\d{1,3};\d{1,3}(?:;\d+)*m/u, rendered.ansi);
	const other = renderStatusline(
		normalizeConfig({}).config,
		fixture({ model: { provider: "openai", id: "gpt-5.6-sol" } }),
	);
	assert.notEqual(other.ansi, rendered.ansi);
});

test("model_styles exact ids win, then longest prefixes", () => {
	const { config } = normalizeConfig({
		model: {
			model_styles: {
				"claude-": "bold green",
				"claude-sonnet-4-20250514": "bold red",
			},
		},
	});
	const exact = renderStatusline(config, fixture());
	assert.ok(exact.ansi.includes("31;1m"), exact.ansi);
	const prefixed = renderStatusline(
		config,
		fixture({ model: { provider: "anthropic", id: "claude-3-5-sonnet-20241022" } }),
	);
	assert.ok(prefixed.ansi.includes("32;1m"), prefixed.ansi);
});

test("invalid model_styles values are rejected with a warning", () => {
	const { config, diagnostics } = normalizeConfig({
		model: { model_styles: { "gpt-": "not a style", "gemini-": "bold cyan" } },
	});
	assert.ok(diagnostics.some((item) => item.path === "model.model_styles"));
	const rendered = renderStatusline(
		config,
		fixture({ model: { provider: "openai", id: "gpt-5.6-sol" } }),
	);
	// gpt- mapping was rejected; the hash color still applies.
	assert.match(rendered.ansi, /38;2;\d{1,3};\d{1,3};\d{1,3}(?:;\d+)*m/u, rendered.ansi);
	const gemini = renderStatusline(
		config,
		fixture({ model: { provider: "google", id: "gemini-2.5-pro" } }),
	);
	assert.ok(gemini.ansi.includes("36;1m"), gemini.ansi);
});

test("provider_aliases rename the provider value", () => {
	const { config } = normalizeConfig({
		format: "$provider",
		provider: { provider_aliases: { "openai-codex": "codex" } },
	});
	const rendered = renderStatusline(
		config,
		fixture({ model: { provider: "openai-codex", id: "gpt-5.6-sol" } }),
	);
	assert.ok(rendered.ansi.includes("codex"));
	assert.ok(!rendered.ansi.includes("openai-codex"));
});

test("explicit model color stays fully user-controlled", () => {
	const { config } = normalizeConfig({ model: { style: "bold red" } });
	const rendered = renderStatusline(config, fixture());
	assert.match(
		rendered.ansi,
		new RegExp(`${ESC}\\[31;1m🤖 sonnet-4 ${ESC}\\[0m`, "u"),
		rendered.ansi,
	);
});

test("hash_colors false keeps the module style", () => {
	const { config } = normalizeConfig({ model: { hash_colors: false } });
	const rendered = renderStatusline(config, fixture());
	// The built-in bold blue stays; no hash color is emitted.
	assert.ok(rendered.ansi.includes("34;1m"), rendered.ansi);
	// model_styles still override the disabled hash.
	const { config: overridden } = normalizeConfig({
		model: { hash_colors: false, model_styles: { "claude-": "bold red" } },
	});
	const styled = renderStatusline(
		overridden,
		fixture({ model: { provider: "a", id: "claude-x" } }),
	);
	assert.ok(styled.ansi.includes("31;1m"), styled.ansi);
});

test("modifier-only model style receives the hash color", () => {
	const { config } = normalizeConfig({ model: { style: "italic" } });
	const rendered = renderStatusline(config, fixture());
	assert.ok(rendered.ansi.includes(";3m"), rendered.ansi);
	assert.match(rendered.ansi, /38;2;\d{1,3};\d{1,3};\d{1,3}(?:;\d+)*m/u, rendered.ansi);
});

test("legacy thinking style falls back for unknown levels only", () => {
	const { config } = normalizeConfig({ thinking: { style: "bold purple" } });
	const themed = renderStatusline(config, fixture({ thinkingLevel: "high" }));
	// The theme role color wins for known levels.
	assert.ok(themed.ansi.includes(`38;2;178;148;187`), themed.ansi);
	const unknown = renderStatusline(config, fixture({ thinkingLevel: "deep" }));
	assert.ok(unknown.ansi.includes("35;1m"), unknown.ansi);
});
