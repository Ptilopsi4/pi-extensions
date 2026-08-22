import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

const packageRoot = path.resolve("packages/pi-tui-kit");

test("built package entrypoints resolve their documented exports", async (t) => {
	const productionSpecifier = "@narumitw/pi-tui-kit";
	const interactionHintsSpecifier = "@narumitw/pi-tui-kit/interaction-hints";
	const terminalTextSpecifier = "@narumitw/pi-tui-kit/terminal-text";
	const testingSpecifier = "@narumitw/pi-tui-kit/testing";
	const production = await import(productionSpecifier);
	const interactionHints = await import(interactionHintsSpecifier);
	const terminalText = await import(terminalTextSpecifier);
	const testing = await import(testingSpecifier);
	assert.equal(production.PI_EXTENSION_MENU_API_VERSION, 14);
	assert.equal(typeof production.sanitizeTerminalText, "function");
	assert.equal(typeof production.formatInteractionHints, "function");
	assert.equal(typeof production.runConfirmation, "function");
	assert.equal(typeof production.runCustomInteraction, "function");
	assert.equal(typeof production.runLiveChoice, "function");
	assert.equal(typeof production.runQuestionnaire, "function");
	assert.equal("createTuiHarness" in production, false);
	assert.equal("createRpcHarness" in production, false);
	assert.deepEqual(Object.keys(interactionHints), ["formatInteractionHints"]);
	assert.deepEqual(Object.keys(terminalText), ["sanitizeTerminalText"]);
	assert.deepEqual(Object.keys(testing).sort(), ["createRpcHarness", "createTuiHarness"]);

	const cacheRoot = path.resolve("node_modules/.cache");
	mkdirSync(cacheRoot, { recursive: true });
	const fixture = mkdtempSync(path.join(cacheRoot, "pi-tui-kit-package-export-"));
	t.onTestFinished(() => rmSync(fixture, { recursive: true, force: true }));
	writeFileSync(
		path.join(fixture, "usage.ts"),
		`import { PI_EXTENSION_MENU_API_VERSION, type BrowseDetailDocument, type ChoiceScreen, type LiveChoiceItem, type MenuBrowseItem, type QuestionnaireAnswer, type QuestionnaireQuestion, type ReviewFormat, type RunQuestionnaireResult } from "@narumitw/pi-tui-kit";\n` +
			`import { formatInteractionHints, type FormatInteractionHintsOptions, type InteractionHint, type InteractionKeybindings } from "@narumitw/pi-tui-kit/interaction-hints";\n` +
			`import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";\n` +
			`import { createRpcHarness, createTuiHarness } from "@narumitw/pi-tui-kit/testing";\n` +
			`const version: 14 = PI_EXTENSION_MENU_API_VERSION;\n` +
			`const keybindings: InteractionKeybindings<"confirm"> = { getKeys: () => ["return"] };\n` +
			`const hints: InteractionHint<"confirm">[] = [{ bindings: ["confirm"], label: sanitizeTerminalText("apply") }];\n` +
			`const hintOptions: FormatInteractionHintsOptions = { separator: "·" };\n` +
			`const formattedHints = formatInteractionHints(keybindings, hints, hintOptions);\n` +
			`const markdown: ReviewFormat = { kind: "markdown", renderLatex: false, renderMermaid: true };\n` +
			`const document: BrowseDetailDocument = { content: "# Formula\\n\\n$x^2$", format: markdown };\n` +
			`const item: MenuBrowseItem = { id: "one", label: "One", detailDocument: document };\n` +
			`const choice: LiveChoiceItem = { id: "active", label: "Active", confirmationDisabled: true, confirmationDisabledReason: "Already active" };\n` +
			`const screen: ChoiceScreen<"select"> = { kind: "choice", title: "Records", enableSearch: true, items: [{ id: "one", label: "One", searchText: "alias" }], action: "select" };\n` +
			`const question: QuestionnaireQuestion<"scope"> = { id: "scope", header: "Scope", prompt: "How broad?", options: [{ label: "Small" }] };\n` +
			`const answer: QuestionnaireAnswer<"scope"> = { questionId: "scope", answer: "Small", wasCustom: false, optionIndex: 1 };\n` +
			`const questionnaireResult: RunQuestionnaireResult<"scope"> = { kind: "submitted", answers: [answer] };\n` +
			`void version;\nvoid formattedHints;\nvoid item;\nvoid choice;\nvoid screen;\nvoid question;\nvoid questionnaireResult;\nvoid createTuiHarness();\nvoid createRpcHarness([]);\n`,
	);
	writeFileSync(
		path.join(fixture, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				strict: true,
				noEmit: true,
				skipLibCheck: true,
			},
			include: ["usage.ts"],
		}),
	);
	const tsc = path.resolve("node_modules/.bin/tsc");
	execFileSync(tsc, ["-p", path.join(fixture, "tsconfig.json")], {
		cwd: packageRoot,
		stdio: "pipe",
	});
});
