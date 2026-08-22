import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createTuiHarness } from "@narumitw/pi-tui-kit/testing";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { showActiveImplementationMenu } from "../src/plan/active-implementation-menu.js";

function linkedMenuOptions(manageGoal: () => void | Promise<void>) {
	return {
		statusText: "A linked implementation Plan is active.",
		getExportDestination: () => ({
			configuredPath: "PLAN.md",
			resolvedPath: "/tmp/PLAN.md",
		}),
		signal: new AbortController().signal,
		isCurrent: () => true,
		show: () => undefined,
		exportPlan: async () => false,
		settings: async () => false,
		manageGoal,
	};
}

test("linked Plan menu routes lifecycle management through Goal", async () => {
	const tui = createTuiHarness({ width: 72, rows: 20 });
	const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
	let managed = 0;
	try {
		const running = showActiveImplementationMenu(
			context.ctx,
			linkedMenuOptions(() => {
				managed += 1;
			}),
		);
		await tui.waitForOpen();
		const frame = tui.render().join("\n");
		assert.match(frame, /exact Plan remains linked until Goal completes/i);
		assert.match(frame, /Manage linked Goal/);
		assert.doesNotMatch(frame, /Start a new plan|Clear active implementation plan/);
		assert.ok(tui.render(28).every((line) => visibleWidth(line) <= 28));

		tui.press("tui.select.down");
		tui.press("tui.select.down");
		tui.press("tui.select.confirm");
		await running;
		assert.equal(managed, 1);
	} finally {
		tui.dispose();
	}
});

test("cancelling the linked Plan menu does not manage or clear Goal", async () => {
	const tui = createTuiHarness({ width: 48, rows: 16 });
	const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
	let managed = 0;
	try {
		const running = showActiveImplementationMenu(
			context.ctx,
			linkedMenuOptions(() => {
				managed += 1;
			}),
		);
		await tui.waitForOpen();
		tui.press("ctrl+c");
		await running;
		assert.equal(managed, 0);
	} finally {
		tui.dispose();
	}
});
