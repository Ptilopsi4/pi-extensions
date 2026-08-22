import assert from "node:assert/strict";
import { resolveMenuScreen } from "@narumitw/pi-tui-kit";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { createWorkflowMenu, showWorkflowMenu, type WorkflowMenuController } from "../src/menu.js";

function controller(): WorkflowMenuController {
	return {
		getState: () => ({
			plan: "ready",
			goal: { status: "paused", objective: "Ship the approved plan" },
			planHandoff: "review",
			settingsPath: "/tmp/pi-workflow.json",
		}),
		setPlanHandoff: () => undefined,
		showPlan: async () => undefined,
		showGoal: async () => undefined,
		showPlanSettings: async () => undefined,
		showGoalSettings: async () => undefined,
	};
}

test("workflow manager keeps primary actions shallow and shows combined state", () => {
	const runtime = controller();
	const menu = createWorkflowMenu(runtime);
	const main = resolveMenuScreen(menu, "main", runtime.getState());
	assert.equal(main.kind, "actions");
	if (main.kind !== "actions") assert.fail("Expected actions screen");
	assert.deepEqual(
		main.items.map((item) => item.label),
		["Plan…", "Goal…", "Settings", "Status", "Help", "Close"],
	);
	assert.match(main.lines?.join("\n") ?? "", /Plan: Ready/u);
	assert.match(main.lines?.join("\n") ?? "", /Goal: Paused/u);
	assert.match(main.lines?.join("\n") ?? "", /Handoff: Review first/u);
});

test("workflow settings expose handoff plus the complete Plan and Goal settings", () => {
	const runtime = controller();
	const menu = createWorkflowMenu(runtime);
	const settings = resolveMenuScreen(menu, "settings", runtime.getState());
	assert.equal(settings.kind, "settings");
	if (settings.kind !== "settings") assert.fail("Expected settings screen");
	assert.deepEqual(
		settings.items.map((item) => [item.label, item.currentValue]),
		[
			["Plan handoff", "Review first"],
			["Plan settings", "Open…"],
			["Goal settings", "Open…"],
		],
	);

	const status = resolveMenuScreen(menu, "status", runtime.getState());
	assert.equal(status.kind, "detail");
	if (status.kind !== "detail") assert.fail("Expected detail screen");
	assert.match(status.lines.join("\n"), /Ship the approved plan/u);
	assert.match(status.lines.join("\n"), /\/tmp\/pi-workflow\.json/u);

	const help = resolveMenuScreen(menu, "help", runtime.getState());
	assert.equal(help.kind, "detail");
	if (help.kind !== "detail") assert.fail("Expected detail screen");
	assert.match(help.lines.join("\n"), /approved Plan.*Goal/u);
	assert.match(help.lines.join("\n"), /\/plan/u);
	assert.match(help.lines.join("\n"), /\/goal/u);
});

test("workflow manager uses the standard RPC extension-UI fallback", async () => {
	let title = "";
	const { ctx } = createMockContext({
		mode: "rpc",
		hasUI: true,
		select: async (nextTitle: string, options: string[]) => {
			title = nextTitle;
			return options.find((option) => option.startsWith("Close"));
		},
	});
	await showWorkflowMenu(ctx, controller(), {
		signal: new AbortController().signal,
		isCurrent: () => true,
	});
	assert.match(title, /Workflow/u);
});

test("invalid settings remain read-only and visible", () => {
	const runtime = controller();
	const state = {
		...runtime.getState(),
		settingsIssue: "invalid JSON",
	};
	const menu = createWorkflowMenu(runtime);
	const main = resolveMenuScreen(menu, "main", state);
	assert.equal(main.kind, "actions");
	if (main.kind !== "actions") assert.fail("Expected actions screen");
	const settingsItem = main.items.find((item) => item.label === "Settings");
	assert.equal(settingsItem && "to" in settingsItem ? settingsItem.to : undefined, "invalid");
	const invalid = resolveMenuScreen(menu, "invalid", state);
	assert.equal(invalid.kind, "detail");
	if (invalid.kind !== "detail") assert.fail("Expected detail screen");
	assert.match(invalid.lines.join("\n"), /will not be overwritten/u);
});
