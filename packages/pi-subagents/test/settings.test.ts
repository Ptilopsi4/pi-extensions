import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
	consumeSubagentSettingsNotice,
	inspectCwdPolicySettings,
	inspectStatefulEnabledSettings,
	inspectStatefulLimitSettings,
	inspectStatefulTransportSettings,
	inspectSubagentSettings,
	inspectUsageRecordingSettings,
	normalizeSubagentSettings,
	readSubagentSettings,
	updateCwdPolicySetting,
	updateStatefulEnabledSetting,
	updateStatefulLimitSetting,
	updateStatefulTransportSetting,
	updateUsageRecordingSetting,
} from "../src/settings.js";
import { resolveStatefulLimits } from "../src/stateful-limits.js";

function withAgentDir(run: (directory: string) => void): void {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-settings-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		run(directory);
	} finally {
		consumeSubagentSettingsNotice();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(directory, { recursive: true, force: true });
	}
}

test("retained runtime settings normalize strictly without materializing defaults", () => {
	withAgentDir((directory) => {
		assert.deepEqual(
			normalizeSubagentSettings({ stateful: { enabled: false, transport: "rpc" } }),
			{ stateful: { enabled: false, transport: "rpc" } },
		);
		assert.equal(normalizeSubagentSettings({ stateful: { enabled: "no" } }), undefined);
		assert.equal(normalizeSubagentSettings({ stateful: { transport: "invalid" } }), undefined);
		assert.deepEqual(inspectStatefulEnabledSettings(), {
			path: path.join(directory, "pi-subagents.json"),
			value: true,
			source: "default",
		});
		assert.equal(inspectStatefulTransportSettings().value, "subprocess");
		assert.equal(readSubagentSettings(), undefined);
		assert.throws(() => readFileSync(path.join(directory, "pi-subagents.json"), "utf8"), /ENOENT/);
	});
});

test("transport and usage updates preserve unknown and ignored legacy fields", () => {
	withAgentDir((directory) => {
		const settingsPath = path.join(directory, "pi-subagents.json");
		const original = {
			future: { kept: true },
			blocking: { enabled: true, maxParallelTasks: 64 },
			consult: { resources: "all" },
			cwdPolicy: { consultation: "anywhere" },
			stateful: { completionDelivery: "auto-resume" },
		};
		writeFileSync(settingsPath, JSON.stringify(original));

		updateStatefulEnabledSetting(false);
		updateStatefulTransportSetting("rpc");
		updateUsageRecordingSetting(true);
		assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
			...original,
			stateful: { ...original.stateful, enabled: false, transport: "rpc" },
			usageRecording: { enabled: true },
		});
		assert.equal(inspectStatefulTransportSettings().source, "user settings");
		assert.equal(inspectUsageRecordingSettings().enabled, true);
	});
});

test("usage recording is strict, opt-in, and protects malformed files", () => {
	withAgentDir(() => {
		assert.deepEqual(normalizeSubagentSettings({ usageRecording: { enabled: true } }), {
			usageRecording: { enabled: true },
		});
		assert.equal(normalizeSubagentSettings({ usageRecording: { enabled: "yes" } }), undefined);
		const missing = inspectUsageRecordingSettings();
		assert.equal(missing.enabled, false);
		assert.equal(missing.source, "default");
		writeFileSync(missing.path, "{ malformed");
		assert.throws(() => updateUsageRecordingSetting(false), /malformed/i);
		assert.equal(readFileSync(missing.path, "utf8"), "{ malformed");
	});
});

test("detached limits normalize, inspect, and update with per-field sources", () => {
	withAgentDir(() => {
		const defaults = resolveStatefulLimits();
		assert.deepEqual(
			normalizeSubagentSettings({
				stateful: {
					maxAgents: 3,
					maxActiveTurns: 2,
					maxChildrenPerAgent: 4,
					maxDepth: 0,
					maxStoredAgents: 7,
				},
			}),
			{
				stateful: {
					maxAgents: 3,
					maxActiveTurns: 2,
					maxChildrenPerAgent: 4,
					maxDepth: 0,
					maxStoredAgents: 7,
				},
			},
		);
		for (const invalid of [
			{ maxAgents: 0 },
			{ maxActiveTurns: 1.5 },
			{ maxChildrenPerAgent: -1 },
			{ maxDepth: -1 },
			{ maxStoredAgents: Number.MAX_SAFE_INTEGER + 1 },
		]) {
			assert.equal(normalizeSubagentSettings({ stateful: invalid }), undefined);
		}

		const missing = inspectStatefulLimitSettings();
		assert.deepEqual(
			Object.fromEntries(
				Object.entries(missing.values ?? {}).map(([field, snapshot]) => [field, snapshot.value]),
			),
			defaults,
		);
		writeFileSync(
			missing.path,
			JSON.stringify({ future: true, stateful: { futureStateful: "keep", maxAgents: 6 } }),
		);
		updateStatefulLimitSetting("maxDepth", 2, { ...defaults, maxAgents: 6 });
		assert.deepEqual(JSON.parse(readFileSync(missing.path, "utf8")), {
			future: true,
			stateful: { futureStateful: "keep", maxAgents: 6, maxDepth: 2 },
		});
		assert.throws(
			() => updateStatefulLimitSetting("maxActiveTurns", 3, defaults),
			/changed.*reopen/i,
		);
	});
});

test("detached limit updates seed the canonical file from legacy settings", () => {
	withAgentDir((directory) => {
		const legacyPath = path.join(directory, "pi-subagents-config.json");
		const canonicalPath = path.join(directory, "pi-subagents.json");
		const legacy = {
			blocking: { enabled: false },
			consult: { resources: "none" },
			stateful: { maxAgents: 5, futureStateful: "keep" },
		};
		writeFileSync(legacyPath, JSON.stringify(legacy));
		updateStatefulLimitSetting("maxActiveTurns", 2);
		assert.deepEqual(JSON.parse(readFileSync(canonicalPath, "utf8")), {
			...legacy,
			stateful: { ...legacy.stateful, maxActiveTurns: 2 },
		});
		assert.deepEqual(JSON.parse(readFileSync(legacyPath, "utf8")), legacy);
	});
});

test("delegation cwd policy ignores legacy consultation policy and preserves its bytes", () => {
	withAgentDir((directory) => {
		const settingsPath = path.join(directory, "pi-subagents.json");
		assert.deepEqual(
			normalizeSubagentSettings({
				cwdPolicy: { consultation: "current-workspace", delegation: "anywhere" },
			}),
			{ cwdPolicy: { delegation: "anywhere" } },
		);
		assert.equal(normalizeSubagentSettings({ cwdPolicy: { delegation: "invalid" } }), undefined);
		writeFileSync(
			settingsPath,
			JSON.stringify({ future: true, cwdPolicy: { future: 7, consultation: "anywhere" } }),
		);
		updateCwdPolicySetting("delegation", "current-workspace");
		assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
			future: true,
			cwdPolicy: {
				future: 7,
				consultation: "anywhere",
				delegation: "current-workspace",
			},
		});
		assert.equal(inspectCwdPolicySettings().delegation.source, "user settings");
	});
});

test("pure settings inspection preserves pending legacy notices", () => {
	withAgentDir((directory) => {
		writeFileSync(
			path.join(directory, "pi-subagents-config.json"),
			JSON.stringify({ blocking: { enabled: false }, stateful: { enabled: true } }),
		);
		assert.equal(readSubagentSettings()?.stateful?.enabled, true);
		const snapshot = inspectSubagentSettings();
		assert.equal(snapshot.settings?.stateful?.enabled, true);
		assert.equal(snapshot.source, "user settings");
		assert.match(consumeSubagentSettingsNotice() ?? "", /legacy/i);
	});
});
