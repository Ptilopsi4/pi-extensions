import assert from "node:assert/strict";
import { test } from "vitest";
import { hashModelStyle } from "../src/modules/model.js";
import { fnv1a, hslToHex, modelColorHex, modelHue, seriesOf } from "../src/modules/model-color.js";

test("seriesOf strips date and latest suffixes", () => {
	assert.equal(seriesOf("claude-3-7-sonnet-20250219"), "claude-3-7-sonnet");
	assert.equal(seriesOf("gpt-5-codex-20250501"), "gpt-5-codex");
	assert.equal(seriesOf("claude-sonnet-4-latest"), "claude-sonnet-4");
	assert.equal(seriesOf("gemini-2.5-pro"), "gemini-2.5-pro");
});

test("fnv1a is deterministic and bounded to 32 bits", () => {
	const first = fnv1a("claude-3-7-sonnet-20250219");
	assert.equal(first, fnv1a("claude-3-7-sonnet-20250219"));
	assert.ok(first >= 0 && first <= 0xffffffff);
	assert.notEqual(first, fnv1a("claude-3-7-sonnet-20250220"));
});

test("models in the same series share the same hue", () => {
	assert.equal(modelHue("claude-3-7-sonnet-20250219"), modelHue("claude-3-7-sonnet-20250501"));
	assert.equal(modelHue("claude-3-5-sonnet-20241022"), modelHue("claude-3-5-sonnet-latest"));
	assert.notEqual(modelHue("claude-3-7-sonnet-20250219"), modelHue("claude-3-5-sonnet-20241022"));
	assert.notEqual(modelHue("claude-3-7-sonnet-20250219"), modelHue("gpt-5.6-sol"));
});

test("distinct models in a series differ in their final hex color", () => {
	const first = modelColorHex("claude-3-5-sonnet-20241022");
	const second = modelColorHex("claude-3-5-sonnet-20250414");
	assert.match(first, /^#[0-9a-f]{6}$/u);
	assert.match(second, /^#[0-9a-f]{6}$/u);
	assert.notEqual(first, second);
	assert.equal(modelColorHex("claude-3-5-sonnet-20241022"), first);
});

test("hslToHex converts through the valid color space", () => {
	assert.equal(hslToHex(0, 0, 0), "#000000");
	assert.equal(hslToHex(0, 1, 0.5), "#ff0000");
	assert.equal(hslToHex(240, 1, 0.5), "#0000ff");
	assert.equal(hslToHex(120, 1, 0.5), "#00ff00");
	assert.equal(hslToHex(0, 0, 1), "#ffffff");
	assert.equal(hslToHex(360, 0.5, 0.5), hslToHex(0, 0.5, 0.5));
});

test("hashModelStyle keeps modifiers and replaces the color", () => {
	assert.match(hashModelStyle("claude-sonnet-4", "bold blue"), /^bold #[0-9a-f]{6}$/u);
	assert.match(
		hashModelStyle("gpt-5.6", "italic underline cyan"),
		/^italic underline #[0-9a-f]{6}$/u,
	);
	assert.equal(hashModelStyle("x", "none"), hashModelStyle("x", ""));
});
