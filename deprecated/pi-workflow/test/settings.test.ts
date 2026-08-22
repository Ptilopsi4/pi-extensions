import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { DEFAULT_GOAL_SETTINGS } from "../src/goal/settings.js";
import {
	readWorkflowGoalSettings,
	readWorkflowPlanSettings,
	readWorkflowSettings,
	saveWorkflowGoalSettings,
	updateWorkflowPlanHandoff,
	updateWorkflowPlanSettings,
} from "../src/settings.js";

async function temporarySettings() {
	const directory = await mkdtemp(join(tmpdir(), "pi-workflow-settings-"));
	return {
		directory,
		path: join(directory, "pi-workflow.json"),
		cleanup: () => rm(directory, { recursive: true, force: true }),
	};
}

test("a missing workflow settings file is side-effect free", async () => {
	const fixture = await temporarySettings();
	try {
		assert.deepEqual(readWorkflowSettings(fixture.path), { kind: "missing" });
		assert.equal(existsSync(fixture.path), false);
		assert.equal(existsSync(fixture.directory), true);
	} finally {
		await fixture.cleanup();
	}
});

test("workflow settings validate and default independent Plan and Goal sections", async () => {
	const fixture = await temporarySettings();
	try {
		await writeFile(
			fixture.path,
			JSON.stringify({
				workflow: { planHandoff: "automatic", future: true },
				plan: { thinkingLevel: "high", futurePlan: "keep" },
				goal: { continuationLimits: { automaticTurns: 12, noProgressTurns: 4 } },
				futureTopLevel: { enabled: true },
			}),
		);

		const loaded = readWorkflowSettings(fixture.path) as {
			kind: string;
			settings?: {
				planHandoff: string;
				plan: { thinkingLevel: string };
				goal: typeof DEFAULT_GOAL_SETTINGS;
			};
		};
		assert.equal(loaded.kind, "loaded");
		assert.equal(loaded.settings?.planHandoff, "automatic");
		assert.equal(loaded.settings?.plan.thinkingLevel, "high");
		assert.equal(loaded.settings?.goal.toolVisibility, "after-first-goal");
		assert.equal(loaded.settings?.goal.continuationLimits.automaticTurns, 12);
		assert.equal(loaded.settings?.goal.continuationLimits.noProgressTurns, 4);
	} finally {
		await fixture.cleanup();
	}
});

test("Plan, Goal, and handoff saves preserve every unowned field", async () => {
	const fixture = await temporarySettings();
	try {
		await writeFile(
			fixture.path,
			`${JSON.stringify(
				{
					futureTopLevel: { enabled: true },
					workflow: { planHandoff: "review", futureWorkflow: 1 },
					plan: {
						thinkingLevel: "low",
						implementationPlanRetention: "legacy-retention",
						futurePlan: 2,
					},
					goal: {
						futureGoal: 3,
						experimental: { goals: false, futureQueue: 4 },
						rpc: { enabled: false, futureRpc: 5 },
						continuationLimits: {
							automaticTurns: 25,
							noProgressTurns: 3,
							futureLimit: 6,
						},
					},
				},
				null,
				2,
			)}\n`,
		);

		updateWorkflowPlanHandoff("automatic", fixture.path);
		await updateWorkflowPlanSettings(
			{ thinkingLevel: "xhigh", defaultPlanExportPath: "docs/PLAN.md" },
			{ settingsPath: fixture.path },
		);
		saveWorkflowGoalSettings(
			{
				...structuredClone(DEFAULT_GOAL_SETTINGS),
				experimental: { goals: true },
			},
			fixture.path,
		);

		const document = JSON.parse(await readFile(fixture.path, "utf8")) as Record<string, unknown>;
		assert.deepEqual(document.futureTopLevel, { enabled: true });
		assert.deepEqual(document.workflow, {
			planHandoff: "automatic",
			futureWorkflow: 1,
		});
		assert.deepEqual(document.plan, {
			thinkingLevel: "xhigh",
			implementationPlanRetention: "legacy-retention",
			defaultPlanExportPath: "docs/PLAN.md",
			futurePlan: 2,
		});
		assert.deepEqual(document.goal, {
			futureGoal: 3,
			toolVisibility: "after-first-goal",
			experimental: { goals: true, futureQueue: 4 },
			rpc: { enabled: false, futureRpc: 5 },
			continuationLimits: {
				automaticTurns: 25,
				noProgressTurns: 3,
				futureLimit: 6,
			},
		});
	} finally {
		await fixture.cleanup();
	}
});

test("malformed or invalid workflow settings are never overwritten", async () => {
	for (const contents of [
		"{broken",
		JSON.stringify({ workflow: { planHandoff: "surprise" } }),
		JSON.stringify({ plan: { thinkingLevel: "impossible" } }),
		JSON.stringify({ goal: { continuationLimits: { automaticTurns: 0 } } }),
	]) {
		const fixture = await temporarySettings();
		try {
			await writeFile(fixture.path, contents);
			const loaded = readWorkflowSettings(fixture.path) as { kind: string };
			assert.equal(loaded.kind, "invalid");
			assert.throws(() => updateWorkflowPlanHandoff("automatic", fixture.path));
			assert.equal(await readFile(fixture.path, "utf8"), contents);
		} finally {
			await fixture.cleanup();
		}
	}
});

test("invalid UTF-8, symbolic links, and non-regular paths stay read-only", async () => {
	const fixture = await temporarySettings();
	try {
		await writeFile(fixture.path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]));
		assert.equal((readWorkflowSettings(fixture.path) as { kind: string }).kind, "invalid");
		assert.throws(() => updateWorkflowPlanHandoff("automatic", fixture.path));

		if (process.platform !== "win32") {
			const target = join(fixture.directory, "target.json");
			const link = join(fixture.directory, "link.json");
			const targetContents = '{"workflow":{"planHandoff":"review"}}';
			await writeFile(target, targetContents);
			await symlink(target, link);
			assert.equal((readWorkflowSettings(link) as { kind: string }).kind, "invalid");
			assert.throws(() => updateWorkflowPlanHandoff("automatic", link));
			assert.equal(await readFile(target, "utf8"), targetContents);
		}

		assert.equal((readWorkflowSettings(fixture.directory) as { kind: string }).kind, "invalid");
		assert.throws(() => updateWorkflowPlanHandoff("automatic", fixture.directory));
	} finally {
		await fixture.cleanup();
	}
});

test("atomic publication failure preserves the previous file and removes temporary files", async () => {
	const fixture = await temporarySettings();
	try {
		const previous = `${JSON.stringify({ workflow: { planHandoff: "review" } }, null, 2)}\n`;
		await writeFile(fixture.path, previous);
		assert.throws(() =>
			updateWorkflowPlanHandoff("automatic", fixture.path, {
				beforeRename: () => {
					throw new Error("rename gate failed");
				},
			}),
		);
		assert.equal(await readFile(fixture.path, "utf8"), previous);
		assert.deepEqual(await readdir(fixture.directory), ["pi-workflow.json"]);

		await rm(fixture.path);
		updateWorkflowPlanHandoff("automatic", fixture.path);
		if (process.platform !== "win32") {
			assert.equal((await stat(fixture.path)).mode & 0o777, 0o600);
		}
	} finally {
		await fixture.cleanup();
	}
});

test("retired Plan retention is ignored at runtime and preserved during saves", async () => {
	const fixture = await temporarySettings();
	try {
		await writeFile(
			fixture.path,
			JSON.stringify({
				workflow: { planHandoff: "review" },
				plan: {
					thinkingLevel: "medium",
					implementationPlanRetention: "future-retention-policy",
					futurePlan: { kept: true },
				},
				goal: {},
			}),
		);

		const loaded = readWorkflowSettings(fixture.path);
		assert.equal(loaded.kind, "loaded");
		if (loaded.kind !== "loaded") assert.fail("Expected workflow settings to load");
		assert.equal(loaded.settings.plan.implementationPlanRetention, undefined);

		await updateWorkflowPlanSettings({ thinkingLevel: "high" }, { settingsPath: fixture.path });
		const document = JSON.parse(await readFile(fixture.path, "utf8")) as {
			plan?: Record<string, unknown>;
		};
		assert.equal(document.plan?.implementationPlanRetention, "future-retention-policy");
		assert.deepEqual(document.plan?.futurePlan, { kept: true });
	} finally {
		await fixture.cleanup();
	}
});

test("Plan and Goal adapters expose only their normalized section", async () => {
	const fixture = await temporarySettings();
	try {
		await writeFile(
			fixture.path,
			JSON.stringify({
				plan: { thinkingLevel: "medium" },
				goal: { toolVisibility: "always" },
			}),
		);
		assert.deepEqual(readWorkflowPlanSettings(fixture.path), {
			kind: "loaded",
			settings: { thinkingLevel: "medium" },
		});
		assert.deepEqual(readWorkflowGoalSettings(fixture.path), {
			kind: "loaded",
			settings: { ...DEFAULT_GOAL_SETTINGS, toolVisibility: "always" },
		});
	} finally {
		await fixture.cleanup();
	}
});

test("the Plan toggle shortcut round-trips through the workflow document", async () => {
	const fixture = await temporarySettings();
	try {
		await writeFile(
			fixture.path,
			JSON.stringify({ plan: { thinkingLevel: "medium", futurePlan: { kept: true } } }),
		);

		const saved = await updateWorkflowPlanSettings(
			{ toggleShortcut: "ctrl+alt+p" },
			{ settingsPath: fixture.path },
		);
		assert.equal(saved.toggleShortcut, "ctrl+alt+p");
		assert.deepEqual(readWorkflowPlanSettings(fixture.path), {
			kind: "loaded",
			settings: { thinkingLevel: "medium", toggleShortcut: "ctrl+alt+p" },
		});

		const cleared = await updateWorkflowPlanSettings(
			{ toggleShortcut: null },
			{ settingsPath: fixture.path },
		);
		assert.equal(cleared.toggleShortcut, undefined);
		const document = JSON.parse(await readFile(fixture.path, "utf8")) as {
			plan?: Record<string, unknown>;
		};
		assert.equal(Object.hasOwn(document.plan ?? {}, "toggleShortcut"), false);
		assert.deepEqual(document.plan?.futurePlan, { kept: true });
	} finally {
		await fixture.cleanup();
	}
});

test("an invalid Plan toggle shortcut blocks the workflow settings write", async () => {
	const fixture = await temporarySettings();
	try {
		await writeFile(fixture.path, JSON.stringify({ plan: { toggleShortcut: "bad+key" } }));
		assert.equal(readWorkflowSettings(fixture.path).kind, "invalid");
		await assert.rejects(
			updateWorkflowPlanSettings({ thinkingLevel: "high" }, { settingsPath: fixture.path }),
			/invalid/,
		);
		assert.equal(
			await readFile(fixture.path, "utf8"),
			JSON.stringify({ plan: { toggleShortcut: "bad+key" } }),
		);
	} finally {
		await fixture.cleanup();
	}
});
