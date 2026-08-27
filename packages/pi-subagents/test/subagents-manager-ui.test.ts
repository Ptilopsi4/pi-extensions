import assert from "node:assert/strict";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterAll, test } from "vitest";
import {
	builtinTool,
	createCustomSelectorHarness,
	createMockContext,
	createMockPi,
	driveCustomSelector,
	extensionTool,
} from "../../../test/support.js";
import { registerSubagentConfigCommand, type SubagentSettingsRuntime } from "../src/config-ui.js";
import type { ManagedAgent } from "../src/registry.js";
import { resolveStatefulLimits } from "../src/stateful-limits.js";
import subagents, {
	inspectDelegationWorkflowSettings,
	updateDelegationWorkflowSetting,
} from "../src/subagents.js";
import { showWorkflowPreview } from "../src/workflow-ui.js";
import { installSubagentsTestEnvironment } from "./subagents-test-helpers.js";

const restoreTestEnvironment = installSubagentsTestEnvironment();
afterAll(restoreTestEnvironment);

test("bare subagents opens a current-session manager and keeps direct routes predictable", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-manager-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const command = mock.commands.get("subagents");
		assert.ok(command);

		const managerRenders: string[][] = [];
		const managerContext = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const driven = driveCustomSelector(factory, ["\u001b"], 52);
				managerRenders.push(...driven.renders);
				return driven.result;
			},
		});
		for (const handler of mock.events.get("session_start") ?? []) {
			await handler({}, managerContext.ctx);
		}
		await command.handler("", managerContext.ctx);
		assert.equal(managerRenders.length, 1);
		assert.ok(managerRenders.flat().every((line) => visibleWidth(line) <= 52));
		const managerText = managerRenders.flat().join("\n");
		assert.match(managerText, /Subagents/);
		assert.match(
			managerText,
			/How subagents run: Background plus compatibility\s+methods \(async \+ sync\)/,
		);
		assert.match(managerText, /When work finishes: Wait for my next message/);
		assert.match(managerText, /Subagents: 0 working.*0 saved for follow-up/);
		assert.match(managerText, /How subagents run/);
		assert.match(managerText, /Current subagents/);
		assert.match(managerText, /Settings/);
		assert.match(managerText, /Diagnostics/);
		assert.match(managerText, /Help/);
		assert.doesNotMatch(managerText, /Consult resources:|Settings: \/|Transport:/);
		assert.equal(managerContext.notifications.length, 1);
		assert.match(managerContext.notifications[0]?.message ?? "", /pi-subagents 3\.0\.0/i);

		let nestedCall = 0;
		const nestedRenders: string[][] = [];
		const nestedContext = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const inputs = nestedCall === 0 ? ["\u001b[B", "\u001b[B", "\r"] : ["\u001b"];
				const driven = driveCustomSelector(factory, inputs, 60);
				nestedRenders[nestedCall++] = driven.renders.flat();
				return driven.result;
			},
		});
		await command.handler("", nestedContext.ctx);
		assert.equal(nestedCall, 3, "settings uses the manager's integrated screen stack");
		assert.match(nestedRenders[0]?.join("\n") ?? "", /How subagents run:/);
		assert.match(nestedRenders[1]?.join("\n") ?? "", /Subagent Settings/);
		assert.match(nestedRenders[1]?.join("\n") ?? "", /Folders and trusted resources/);
		assert.match(nestedRenders[1]?.join("\n") ?? "", /Completion and privacy/);
		assert.match(nestedRenders[1]?.join("\n") ?? "", /Agent defaults/);
		assert.match(nestedRenders[1]?.join("\n") ?? "", /Advanced runtime settings/);

		let agentRouteCall = 0;
		const agentRouteRenders: string[][] = [];
		const agentRouteContext = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const inputs = agentRouteCall === 0 ? ["\u001b[B", "\r"] : ["\u001b"];
				const driven = driveCustomSelector(factory, inputs, 60);
				agentRouteRenders[agentRouteCall++] = driven.renders.flat();
				return driven.result;
			},
		});
		await command.handler("", agentRouteContext.ctx);
		assert.equal(agentRouteCall, 3);
		assert.match(agentRouteRenders[1]?.join("\n") ?? "", /Current Subagents/);
		assert.match(
			agentRouteRenders[1]?.join("\n") ?? "",
			/No subagents are working or saved for follow-up/,
		);

		let directCalls = 0;
		const directRenders: string[][] = [];
		const directContext = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				directCalls++;
				const driven = driveCustomSelector(factory, ["\u001b"], 60);
				directRenders.push(...driven.renders);
				return driven.result;
			},
		});
		await command.handler("settings", directContext.ctx);
		assert.equal(directCalls, 1);
		assert.match(directRenders.flat().join("\n"), /Subagent Settings/);
		assert.doesNotMatch(directRenders.flat().join("\n"), /Current Session/);

		const rpcContext = createMockContext({
			mode: "rpc",
			hasUI: true,
			custom: async () => {
				throw new Error("RPC must not open custom TUI");
			},
		});
		await command.handler("", rpcContext.ctx);
		assert.match(rpcContext.notifications[0]?.message ?? "", /Current Session/);
		assert.match(rpcContext.notifications[0]?.message ?? "", /User Settings/);

		for (const mode of ["json", "print"]) {
			const headlessContext = createMockContext({
				mode,
				hasUI: false,
				custom: async () => {
					throw new Error(`${mode} mode must not open custom TUI`);
				},
			});
			await command.handler("", headlessContext.ctx);
			assert.deepEqual(headlessContext.notifications, []);
		}

		await command.handler("status", managerContext.ctx);
		assert.match(managerContext.notifications.at(-1)?.message ?? "", /Current Session/);
		assert.match(managerContext.notifications.at(-1)?.message ?? "", /User Settings/);
		await command.handler("help", managerContext.ctx);
		assert.match(managerContext.notifications.at(-1)?.message ?? "", /Start here/);
		assert.match(managerContext.notifications.at(-1)?.message ?? "", /workflow.*tools.*blocking/i);
		assert.doesNotMatch(managerContext.notifications.at(-1)?.message ?? "", /Recommended/i);
		assert.match(
			managerContext.notifications.at(-1)?.message ?? "",
			/blocking subagent tool is deprecated/i,
		);
		assert.match(managerContext.notifications.at(-1)?.message ?? "", /detailed diagnostics/);
		assert.doesNotMatch(managerContext.notifications.at(-1)?.message ?? "", /Usage path:/);
		await command.handler("unknown", managerContext.ctx);
		assert.match(
			managerContext.notifications.at(-1)?.message ?? "",
			/Unknown \/subagents subcommand: unknown/,
		);
		await command.handler("settings extra", managerContext.ctx);
		assert.match(
			managerContext.notifications.at(-1)?.message ?? "",
			/Unknown \/subagents subcommand: settings extra/,
		);
		for (const handler of mock.events.get("session_shutdown") ?? []) {
			await handler({}, managerContext.ctx);
		}
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("settings groups keep agent and runtime capabilities reachable", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-settings-structure-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const command = mock.commands.get("subagents");
		assert.ok(command);
		let call = 0;
		const frames: string[] = [];
		const context = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const harness = createCustomSelectorHarness(factory, 72);
				const frame = stripVTControlCharacters(harness.render().join("\n"));
				frames.push(frame);
				if (call === 0) {
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (call === 1) {
					assert.match(frame, /Agent Defaults/);
					assert.match(frame, /Tool permissions/);
					assert.match(frame, /Model, thinking, and time limit/);
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (call === 2) {
					assert.match(frame, /Model, Thinking, and Time Limit/);
					harness.handleInput("tui.select.cancel");
				} else if (call === 3) {
					harness.handleInput("tui.select.cancel");
				} else if (call === 4) {
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (call === 5) {
					assert.match(frame, /Advanced Runtime Settings/);
					assert.match(frame, /Transport/);
					assert.match(frame, /Blocking worker limit/);
					assert.match(frame, /Background agent limits/);
					assert.doesNotMatch(frame, /Responsiveness setup/);
					harness.handleInput("tui.select.confirm");
				} else if (call === 6) {
					assert.match(frame, /Background Agent Transport/);
					assert.match(frame, /Automatic.*Recommended/);
					assert.doesNotMatch(frame, /Preview Automatic/);
					harness.handleInput("tui.select.cancel");
				} else if (call === 7) {
					harness.handleInput("tui.select.cancel");
				} else if (call === 8) {
					harness.handleInput("tui.select.up");
					harness.handleInput("tui.select.up");
					harness.handleInput("tui.select.confirm");
				} else {
					assert.match(frame, /Completion and Privacy/);
					assert.match(frame, /When background work finishes/);
					assert.match(frame, /steer results into active work/i);
					assert.match(frame, /continue automatically from idle/i);
					assert.match(frame, /Local usage recording/);
					harness.handleInput("\u0003");
				}
				call++;
				return harness.result;
			},
		});

		await command.handler("settings", context.ctx);
		assert.equal(call, 10, frames.join("\n---\n"));
		assert.ok(
			frames.flatMap((frame) => frame.split("\n")).every((line) => visibleWidth(line) <= 72),
		);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("agent tool drafts preserve settings across searchable save, discard, and Escape", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-tool-search-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const settingsPath = path.join(directory, "pi-subagents.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				future: { kept: true },
				agents: { explorer: { tools: ["read", "missing-tool"] } },
			}),
		);
		const mock = createMockPi({
			allTools: [builtinTool("read"), builtinTool("bash"), extensionTool("remote-tool")],
		});
		const runtime: SubagentSettingsRuntime = {
			getBlockingEnabled: () => true,
			getMaxParallelTasks: () => 8,
			getCompletionDelivery: () => "next-turn",
			getConsultResourcePolicy: () => "project-context",
			getConsultationCwdPolicy: () => "anywhere",
			getDelegationCwdPolicy: () => "trusted-targets",
			setMaxParallelTasks: () => undefined,
			setCompletionDelivery: () => undefined,
			setConsultResourcePolicy: () => undefined,
			setConsultationCwdPolicy: () => undefined,
			setDelegationCwdPolicy: () => undefined,
			getRuntimeStatus: () => ({
				enabled: true,
				initialized: true,
				transport: "subprocess",
				completionDelivery: "next-turn",
				limits: resolveStatefulLimits(),
				activeAgents: 0,
				retainedAgents: 0,
			}),
			listAgents: () => [],
			clearAgents: async () => 0,
		};
		registerSubagentConfigCommand(mock.pi, runtime);
		const command = mock.commands.get("subagents");
		assert.ok(command);
		let call = 0;
		const openedScreens: string[] = [];
		const context = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const harness = createCustomSelectorHarness(factory, 70);
				openedScreens.push(stripVTControlCharacters(harness.render().join("\n")));
				if (call === 0 || call === 1) {
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (call === 2 || call === 3) {
					harness.handleInput("tui.select.confirm");
				} else if (call === 4) {
					assert.match(stripVTControlCharacters(harness.render().join("\n")), /missing-tool/);
					for (const input of ["r", "e", "m", "o", "t", "e"]) harness.handleInput(input);
					const filtered = stripVTControlCharacters(harness.render().join("\n"));
					assert.match(filtered, /remote-tool/);
					assert.doesNotMatch(filtered, /\bread\b|\bbash\b|missing-tool/);
					assert.match(filtered, /Save changes/);
					assert.match(filtered, /Discard draft/);
					harness.handleInput("tui.select.confirm");
					for (let index = 0; index < 6; index += 1) harness.handleInput("\u007f");
					const cleared = stripVTControlCharacters(harness.render().join("\n"));
					assert.match(cleared, /› \[x\] remote-tool/);
					assert.match(cleared, /missing-tool.*unavailable/);
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
					await harness.waitForPending();
					await new Promise<void>((resolve) => setImmediate(resolve));
				} else {
					harness.handleInput("\u0003");
				}
				call += 1;
				return harness.result;
			},
		});

		await command.handler("", context.ctx);
		assert.equal(call, 6, openedScreens.join("\n---\n"));
		assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
			future: { kept: true },
			agents: { explorer: { tools: ["read", "missing-tool", "remote-tool"] } },
		});
		const savedDocument = readFileSync(settingsPath, "utf8");

		let discardCall = 0;
		const discardContext = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const harness = createCustomSelectorHarness(factory, 70);
				if (discardCall === 0 || discardCall === 1) {
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (discardCall === 2 || discardCall === 3) {
					harness.handleInput("tui.select.confirm");
				} else if (discardCall === 4) {
					for (const input of ["b", "a", "s", "h"]) harness.handleInput(input);
					harness.handleInput("tui.select.confirm");
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.down");
					assert.match(stripVTControlCharacters(harness.render().join("\n")), /› Discard draft/);
					harness.handleInput("tui.select.confirm");
					await harness.waitForPending();
					await new Promise<void>((resolve) => setImmediate(resolve));
				} else {
					harness.handleInput("\u0003");
				}
				discardCall += 1;
				return harness.result;
			},
		});
		await command.handler("", discardContext.ctx);
		assert.equal(discardCall, 6);
		assert.equal(readFileSync(settingsPath, "utf8"), savedDocument);

		let escapeCall = 0;
		const escapeContext = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const harness = createCustomSelectorHarness(factory, 70);
				if (escapeCall === 0 || escapeCall === 1) {
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (escapeCall === 2 || escapeCall === 3) {
					harness.handleInput("tui.select.confirm");
				} else if (escapeCall === 4) {
					for (const input of ["b", "a", "s", "h"]) harness.handleInput(input);
					harness.handleInput("tui.select.confirm");
					harness.handleInput("tui.select.cancel");
					await harness.waitForPending();
					await new Promise<void>((resolve) => setImmediate(resolve));
				} else {
					harness.handleInput("\u0003");
				}
				escapeCall += 1;
				return harness.result;
			},
		});
		await command.handler("", escapeContext.ctx);
		assert.equal(escapeCall, 6);
		assert.equal(readFileSync(settingsPath, "utf8"), savedDocument);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("workflow preview names every tool added or removed between compatibility surfaces", async () => {
	const previews: Array<{ title: string; message: string }> = [];
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		confirm: async (title: string, message: string) => {
			previews.push({ title, message });
			return false;
		},
	});
	const signal = new AbortController().signal;

	assert.equal(
		await showWorkflowPreview(context.ctx, "blocking-only", "async-only", true, signal),
		false,
	);
	assert.equal(
		await showWorkflowPreview(context.ctx, "async-only", "blocking-only", true, signal),
		false,
	);
	assert.equal(previews.length, 2);
	for (const preview of previews) {
		assert.match(preview.title, /save how subagents run and reload/i);
		assert.match(preview.message, /subagent_spawn/);
		assert.match(preview.message, /subagent_send/);
		assert.match(preview.message, /subagent_manage/);
		assert.match(preview.message, /subagent_mailbox/);
		assert.match(preview.message, /deprecated blocking `subagent`/);
		assert.match(preview.message, /read-only `subagent_consult`/);
		assert.doesNotMatch(preview.message, /reusable async lifecycle tools/i);
	}
});

test("delegation workflow preview applies async-only on confirmation and cancellation is read-only", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-workflow-ui-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const settingsPath = path.join(directory, "pi-subagents.json");
		writeFileSync(settingsPath, JSON.stringify({ future: true }));
		const mock = createMockPi();
		subagents(mock.pi);
		const command = mock.commands.get("subagents");
		assert.ok(command);
		let applyCall = 0;
		let reloads = 0;
		const applyRenders: string[][] = [];
		const applyContext = createMockContext({
			mode: "tui",
			hasUI: true,
			reload: async () => {
				reloads++;
			},
			custom: async (factory: unknown) => {
				if (applyCall >= 2) throw new Error("async-only choice should reload");
				const inputs = applyCall === 0 ? ["\r"] : ["\u001b[B", "\r"];
				const driven = driveCustomSelector(factory, inputs, 60);
				applyRenders[applyCall++] = driven.renders.flat();
				return driven.result;
			},
		});
		await command.handler("", applyContext.ctx);
		assert.equal(applyCall, 2);
		assert.equal(reloads, 1);
		assert.match(applyContext.notifications.at(-1)?.message ?? "", /run \/reload/i);
		assert.match(
			applyRenders[0]?.join("\n") ?? "",
			/How subagents run: Background plus compatibility methods\s+\(async \+ sync\)/,
		);
		const workflowText = applyRenders[1]?.join("\n") ?? "";
		assert.match(workflowText, /Keep Pi available \(async\)/i);
		assert.match(workflowText, /Background plus compatibility methods\s+\(async \+ sync\)/i);
		assert.match(workflowText, /Compatibility blocking methods \(sync\)/i);
		assert.doesNotMatch(workflowText, /Recommended/i);
		assert.ok(
			workflowText.lastIndexOf("Background plus compatibility methods") <
				workflowText.lastIndexOf("Keep Pi available"),
		);
		assert.match(
			workflowText,
			/results needed in the current answer[\s\S]*automatic\s+continuation[\s\S]*Settings/i,
		);
		assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
			future: true,
			blocking: { enabled: false },
			stateful: { enabled: true },
		});

		writeFileSync(settingsPath, JSON.stringify({ future: "unchanged" }));
		const beforeCancel = readFileSync(settingsPath, "utf8");
		const cancelMock = createMockPi();
		subagents(cancelMock.pi);
		const cancelCommand = cancelMock.commands.get("subagents");
		assert.ok(cancelCommand);
		let cancelCall = 0;
		const cancelContext = createMockContext({
			mode: "tui",
			hasUI: true,
			confirm: async () => false,
			custom: async (factory: unknown) => {
				const inputs =
					cancelCall === 0
						? ["\r"]
						: cancelCall === 1
							? ["\u001b[B", "\r"]
							: cancelCall === 2
								? ["\u001b"]
								: ["\u001b"];
				cancelCall++;
				return driveCustomSelector(factory, inputs, 40).result;
			},
		});
		await cancelCommand.handler("", cancelContext.ctx);
		assert.equal(cancelCall, 4);
		assert.equal(readFileSync(settingsPath, "utf8"), beforeCancel);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("configured workflow differences reload from the active tool surface", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-workflow-partial-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const settingsPath = path.join(directory, "pi-subagents.json");
		writeFileSync(settingsPath, "{}\n");
		const reloadMock = createMockPi();
		subagents(reloadMock.pi);
		const command = reloadMock.commands.get("subagents");
		assert.ok(command);
		updateDelegationWorkflowSetting("async-only");
		let reloads = 0;
		let call = 0;
		const renders: string[][] = [];
		const context = createMockContext({
			mode: "tui",
			hasUI: true,
			reload: async () => {
				reloads++;
			},
			custom: async (factory: unknown) => {
				if (call >= 2) throw new Error("workflow should reload after the choice screen");
				const inputs = call === 0 ? ["\r"] : ["\u001b[B", "\r"];
				const driven = driveCustomSelector(factory, inputs, 40);
				renders[call++] = driven.renders.flat();
				return driven.result;
			},
		});
		await command.handler("", context.ctx);
		assert.equal(call, 2);
		assert.equal(reloads, 1);
		assert.match(
			renders[0]?.join("\n") ?? "",
			/Configured after reload: Keep Pi\s+available \(async\)/,
		);
		assert.match(
			renders[1]?.join("\n") ?? "",
			/Current: Background plus compatibility\s+methods \(async \+ sync\)/,
		);
		assert.ok(renders.flat().every((line) => visibleWidth(line) <= 40));

		reloads = 0;
		const revertChoices = [
			"How subagents run",
			"Background plus compatibility methods (async + sync)",
			undefined,
			undefined,
		];
		const revertContext = createMockContext({
			mode: "tui",
			hasUI: true,
			reload: async () => {
				reloads++;
			},
			select: async () => revertChoices.shift(),
		});
		await command.handler("", revertContext.ctx);
		assert.equal(reloads, 0);
		assert.equal(inspectDelegationWorkflowSettings().value, "all");
		assert.match(
			revertContext.notifications.at(-1)?.message ?? "",
			/current tool surface already matches/i,
		);

		for (const width of [40, 60, 100]) {
			const widthMock = createMockPi();
			subagents(widthMock.pi);
			const widthCommand = widthMock.commands.get("subagents");
			assert.ok(widthCommand);
			let lines: string[] = [];
			const widthContext = createMockContext({
				mode: "tui",
				hasUI: true,
				custom: async (factory: unknown) => {
					const driven = driveCustomSelector(factory, ["\u001b"], width);
					lines = driven.renders.flat();
					return driven.result;
				},
			});
			await widthCommand.handler("", widthContext.ctx);
			assert.ok(lines.every((line) => visibleWidth(line) <= width));
			assert.match(
				lines.join("\n"),
				/How subagents run: Background plus\s+compatibility methods\s+\(async \+ sync\)/,
			);
		}
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("config lifecycle aborts pending confirmations before stateful session handlers", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-config-lifecycle-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		const command = mock.commands.get("subagents");
		assert.ok(command);
		const exercise = async (event: "session_start" | "session_shutdown") => {
			let call = 0;
			let observedSignal: AbortSignal | undefined;
			let markStarted: (() => void) | undefined;
			const started = new Promise<void>((resolve) => {
				markStarted = resolve;
			});
			const context = createMockContext({
				mode: "tui",
				hasUI: true,
				confirm: async (_title: string, _message: string, options?: { signal?: AbortSignal }) => {
					observedSignal = options?.signal;
					markStarted?.();
					return new Promise<boolean>((resolve) => {
						if (observedSignal?.aborted) resolve(false);
						else observedSignal?.addEventListener("abort", () => resolve(false), { once: true });
					});
				},
				custom: async (factory: unknown) => {
					const harness = createCustomSelectorHarness(factory, 60);
					if (call === 0) {
						harness.handleInput("tui.select.confirm");
					} else {
						harness.handleInput("tui.select.down");
						harness.handleInput("tui.select.confirm");
						await harness.waitForPending();
					}
					call++;
					return harness.result;
				},
			});
			const commandRun = command.handler("", context.ctx);
			await started;
			assert.equal(observedSignal?.aborted, false);
			const handlers = mock.events.get(event) ?? [];
			assert.ok(handlers.length > 1);
			await handlers[0]?.({}, context.ctx);
			assert.equal(observedSignal?.aborted, true);
			await commandRun;
			assert.equal(existsSync(path.join(directory, "pi-subagents.json")), false);
		};

		await exercise("session_start");
		await exercise("session_shutdown");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("workflow changes block reload while subagents are saved for follow-up", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-workflow-retained-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const settingsPath = path.join(directory, "pi-subagents.json");
		writeFileSync(settingsPath, "{}\n");
		const mock = createMockPi();
		let reloads = 0;
		const runtime: SubagentSettingsRuntime = {
			getBlockingEnabled: () => true,
			getMaxParallelTasks: () => 8,
			getCompletionDelivery: () => "next-turn",
			getConsultResourcePolicy: () => "project-context",
			getConsultationCwdPolicy: () => "anywhere",
			getDelegationCwdPolicy: () => "trusted-targets",
			setMaxParallelTasks: () => undefined,
			setCompletionDelivery: () => undefined,
			setConsultResourcePolicy: () => undefined,
			setConsultationCwdPolicy: () => undefined,
			setDelegationCwdPolicy: () => undefined,
			getRuntimeStatus: () => ({
				enabled: true,
				initialized: true,
				transport: "subprocess",
				completionDelivery: "next-turn",
				limits: resolveStatefulLimits(),
				activeAgents: 1,
				retainedAgents: 2,
			}),
			listAgents: () => [],
			clearAgents: async () => 0,
		};
		registerSubagentConfigCommand(mock.pi, runtime);
		const command = mock.commands.get("subagents");
		assert.ok(command);
		let call = 0;
		const context = createMockContext({
			mode: "tui",
			hasUI: true,
			reload: async () => {
				reloads++;
			},
			custom: async (factory: unknown) => {
				const inputs = call === 0 ? ["\r"] : call === 1 ? ["\u001b[B", "\r"] : ["\u001b"];
				call++;
				return driveCustomSelector(factory, inputs, 60).result;
			},
		});
		await command.handler("", context.ctx);
		assert.equal(call, 4);
		assert.equal(reloads, 0);
		assert.equal(readFileSync(settingsPath, "utf8"), "{}\n");
		assert.match(
			context.notifications.at(-1)?.message ?? "",
			/2 subagents.*saved for follow-up.*1 working.*Current subagents/i,
		);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("delegation workflow save failure does not reload or claim application", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-workflow-save-failure-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const settingsPath = path.join(directory, "pi-subagents.json");
		writeFileSync(settingsPath, "{}\n");
		const mock = createMockPi();
		subagents(mock.pi);
		const command = mock.commands.get("subagents");
		assert.ok(command);
		let call = 0;
		let reloads = 0;
		const context = createMockContext({
			mode: "tui",
			hasUI: true,
			reload: async () => {
				reloads++;
			},
			custom: async (factory: unknown) => {
				const inputs = call === 0 ? ["\r"] : call === 1 ? ["\u001b[B", "\r"] : ["\u001b"];
				call++;
				return driveCustomSelector(factory, inputs, 60).result;
			},
			confirm: async () => {
				rmSync(settingsPath);
				mkdirSync(settingsPath);
				return true;
			},
		});
		await command.handler("", context.ctx);
		assert.equal(call, 4);
		assert.equal(reloads, 0);
		assert.match(context.notifications.at(-1)?.message ?? "", /not saved.*unchanged/i);
		assert.equal(lstatSync(settingsPath).isDirectory(), true);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("current subagents excludes already closed agent records", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-closed-manager-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const mock = createMockPi();
		const closedAgent: ManagedAgent = {
			id: "sa_closed",
			agent: "explorer",
			rootId: "sa_closed",
			depth: 0,
			children: [],
			state: "closed",
			createdAt: 1,
			updatedAt: 1,
			cwd: process.cwd(),
			history: [],
			mailbox: [],
		};
		const includeClosedArguments: boolean[] = [];
		const runtime: SubagentSettingsRuntime = {
			getBlockingEnabled: () => true,
			getMaxParallelTasks: () => 8,
			getCompletionDelivery: () => "next-turn",
			getConsultResourcePolicy: () => "project-context",
			getConsultationCwdPolicy: () => "anywhere",
			getDelegationCwdPolicy: () => "trusted-targets",
			setMaxParallelTasks: () => undefined,
			setCompletionDelivery: () => undefined,
			setConsultResourcePolicy: () => undefined,
			setConsultationCwdPolicy: () => undefined,
			setDelegationCwdPolicy: () => undefined,
			getRuntimeStatus: () => ({
				enabled: true,
				initialized: true,
				transport: "subprocess",
				completionDelivery: "next-turn",
				limits: resolveStatefulLimits(),
				activeAgents: 0,
				retainedAgents: 0,
			}),
			listAgents(includeClosed = false) {
				includeClosedArguments.push(includeClosed);
				return includeClosed ? [closedAgent] : [];
			},
			clearAgents: async () => 0,
		};
		registerSubagentConfigCommand(mock.pi, runtime);
		const command = mock.commands.get("subagents");
		assert.ok(command);
		let call = 0;
		const renders: string[][] = [];
		const context = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const inputs = call === 0 ? ["\u001b[B", "\r"] : call === 1 ? ["\r"] : ["\u001b"];
				const driven = driveCustomSelector(factory, inputs, 60);
				renders[call++] = driven.renders.flat();
				return driven.result;
			},
		});
		await command.handler("", context.ctx);
		assert.equal(call, 3);
		assert.deepEqual(includeClosedArguments, [false]);
		assert.match(renders[1]?.join("\n") ?? "", /No subagents are working or saved for follow-up/);
		assert.doesNotMatch(renders[1]?.join("\n") ?? "", /sa_closed/);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});
