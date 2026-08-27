import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import type { JobRuntime } from "../src/job-runtime.js";
import { createJobWidget, renderJobWidget, SUBAGENT_WIDGET_KEY } from "../src/job-widget.js";
import { boundText, safeTerminalLine, safeTerminalText, truncateUtf8 } from "../src/safe-text.js";

test("terminal sanitization strips control and bidirectional formatting characters", () => {
	const hostile =
		"safe\0\u001b[31m\r\u0085\u202aL\u202bR\u202c\u202dX\u202eY\u2066a\u2067b\u2068c\u2069d";
	const sanitized = safeTerminalText(hostile);
	assert.equal(sanitized, "safe[31mLRXYabcd");
	assert.equal(safeTerminalLine("one\n two\tthree"), "one two three");
});

test("UTF-8 and line bounds preserve valid multibyte text", () => {
	const bounded = truncateUtf8("界".repeat(1_000), 1_024);
	assert.ok(Buffer.byteLength(bounded.text, "utf8") <= 1_024);
	assert.equal(bounded.text.includes("�"), false);
	const lines = boundText(
		Array.from({ length: 2_100 }, (_, index) => `line ${index}`).join("\n"),
		128 * 1024,
		2_000,
	);
	assert.equal(lines.truncated, true);
	assert.ok(lines.text.split("\n").length <= 2_000);
});

test("widget controller disposes timers and ignores stale callbacks across replacement", () => {
	let listener: (() => void) | undefined;
	let jobs: ReturnType<JobRuntime["activeJobsForDisplay"]> = [];
	const runtime = {
		activeJobsForDisplay: () => jobs,
		subscribe: (candidate: () => void) => {
			listener = candidate;
			return () => {
				listener = undefined;
			};
		},
	} as unknown as JobRuntime;
	const fakeTimer = { unref() {} } as NodeJS.Timeout;
	const interval = vi.spyOn(globalThis, "setInterval").mockReturnValue(fakeTimer);
	const clear = vi.spyOn(globalThis, "clearInterval");
	try {
		const controller = createJobWidget(runtime);
		const first = createMockContext({ mode: "tui", hasUI: true });
		controller.start(first.ctx);
		assert.equal(interval.mock.calls[0]?.[1], 1_000);
		jobs = [{ jobId: "job", state: "running", createdAt: 0, elapsedMs: 0, tools: ["read"] }];
		listener?.();
		assert.equal(typeof first.widgets.get(SUBAGENT_WIDGET_KEY), "function");
		const stale = listener;
		const firstWidget = first.widgets.get(SUBAGENT_WIDGET_KEY);
		const second = createMockContext({
			mode: "tui",
			hasUI: true,
			sessionManager: { getSessionId: () => "second" },
		});
		controller.start(second.ctx);
		stale?.();
		assert.equal(first.widgets.get(SUBAGENT_WIDGET_KEY), firstWidget);
		controller.shutdown(first.ctx);
		assert.equal(typeof second.widgets.get(SUBAGENT_WIDGET_KEY), "function");
		jobs = [];
		listener?.();
		assert.equal(second.widgets.get(SUBAGENT_WIDGET_KEY), undefined);
		controller.shutdown(second.ctx);
		controller.shutdown(second.ctx);
		assert.ok(clear.mock.calls.length >= 2);
	} finally {
		vi.restoreAllMocks();
	}
});

test("widget rendering uses theme roles, sanitizes labels, and stays width bounded", () => {
	const roles: string[] = [];
	const theme = {
		fg(role: string, text: string) {
			roles.push(role);
			return text;
		},
	} as Theme;
	const lines = renderJobWidget(
		[
			{
				jobId: "job\u001b[31m\u202e",
				state: "running",
				createdAt: 0,
				startedAt: 0,
				elapsedMs: 65_000,
				timeout: 120,
				tools: ["read", "edit"],
			},
		],
		theme,
		24,
	);
	assert.ok(roles.includes("borderMuted"));
	assert.ok(roles.includes("muted"));
	assert.ok(roles.includes("accent"));
	assert.ok(roles.includes("text"));
	assert.equal(lines.join("\n").includes("\u001b[31m"), false);
	assert.equal(lines.join("\n").includes("\u202e"), false);
	for (const line of lines) assert.ok(visibleWidth(line) <= 24);
	assert.deepEqual(renderJobWidget([], theme, 0), ["", ""]);
});
