import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import subagents from "../src/subagents.js";
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
		assert.match(managerText, /Retained delegation: enabled/);
		assert.match(managerText, /When work finishes: Wait for my next message/);
		assert.match(managerText, /Subagents: 0 working.*0 saved for follow-up/);
		assert.match(managerText, /Current subagents/);
		assert.match(managerText, /Settings/);
		assert.match(managerText, /Diagnostics/);
		assert.match(managerText, /Help/);
		assert.doesNotMatch(managerText, /Consult resources:|Settings: \/|Transport:/);
		assert.equal(managerContext.notifications.length, 0);

		let nestedCall = 0;
		const nestedRenders: string[][] = [];
		const nestedContext = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				const inputs = nestedCall === 0 ? ["\u001b[B", "\r"] : ["\u001b"];
				const driven = driveCustomSelector(factory, inputs, 60);
				nestedRenders[nestedCall++] = driven.renders.flat();
				return driven.result;
			},
		});
		await command.handler("", nestedContext.ctx);
		assert.equal(nestedCall, 3, "settings uses the manager's integrated screen stack");
		assert.match(nestedRenders[0]?.join("\n") ?? "", /Retained delegation:/);
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
				const inputs = agentRouteCall === 0 ? ["\r"] : ["\u001b"];
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
		assert.match(
			managerContext.notifications.at(-1)?.message ?? "",
			/subagent_spawn.*subagent_await/is,
		);
		assert.doesNotMatch(managerContext.notifications.at(-1)?.message ?? "", /blocking|consult/i);
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

test("manager honors callback-provided non-default keybindings and Ctrl+C hard cancel", async () => {
	const mock = createMockPi();
	subagents(mock.pi);
	const command = mock.commands.get("subagents");
	assert.ok(command);
	let rendered = "";
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		custom: async (factory: unknown) => {
			const bindings = {
				matches(data: string, key: string) {
					return (
						(key === "tui.select.up" && data === "k") ||
						(key === "tui.select.down" && data === "j") ||
						(key === "tui.select.confirm" && data === "x") ||
						(key === "tui.select.cancel" && data === "q")
					);
				},
				getKeys(key: string): readonly string[] {
					if (key === "tui.select.up") return ["k"];
					if (key === "tui.select.down") return ["j"];
					if (key === "tui.select.confirm") return ["x"];
					if (key === "tui.select.cancel") return ["q"];
					return [];
				},
			};
			const harness = createCustomSelectorHarness(factory, 72, bindings);
			rendered = stripVTControlCharacters(harness.render().join("\n"));
			harness.handleInput("\u0003");
			return harness.result;
		},
	});
	await command.handler("", context.ctx);
	assert.match(rendered, /k\/j navigate.*x select.*q close/i);
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
					assert.match(frame, /Retained delegation/);
					assert.match(frame, /Transport/);
					assert.match(frame, /Background agent limits/);
					assert.doesNotMatch(frame, /Responsiveness setup/);
					harness.handleInput("tui.select.down");
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
			getCompletionDelivery: () => "next-turn",
			getDelegationCwdPolicy: () => "trusted-targets",
			setCompletionDelivery: () => undefined,
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
				if (call === 0) {
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (call === 1) {
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
				if (discardCall === 0) {
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (discardCall === 1) {
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
				if (escapeCall === 0) {
					harness.handleInput("tui.select.down");
					harness.handleInput("tui.select.confirm");
				} else if (escapeCall === 1) {
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

test("config lifecycle aborts pending clear confirmations on replacement and shutdown", async () => {
	const mock = createMockPi();
	const retained: ManagedAgent = {
		id: "sa_retained",
		agent: "explorer",
		rootId: "sa_retained",
		depth: 0,
		children: [],
		state: "idle",
		createdAt: 1,
		updatedAt: 1,
		cwd: process.cwd(),
		history: [],
		mailbox: [],
	};
	let cleared = 0;
	const runtime: SubagentSettingsRuntime = {
		getCompletionDelivery: () => "next-turn",
		getDelegationCwdPolicy: () => "trusted-targets",
		setCompletionDelivery: () => undefined,
		setDelegationCwdPolicy: () => undefined,
		getRuntimeStatus: () => ({
			enabled: true,
			initialized: true,
			transport: "subprocess",
			completionDelivery: "next-turn",
			limits: resolveStatefulLimits(),
			activeAgents: 0,
			retainedAgents: 1,
		}),
		listAgents: () => [retained],
		clearAgents: async () => {
			cleared++;
			return 1;
		},
	};
	registerSubagentConfigCommand(mock.pi, runtime);
	const command = mock.commands.get("subagents");
	assert.ok(command);
	for (const event of ["session_start", "session_shutdown"] as const) {
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
				harness.handleInput("tui.select.confirm");
				if (call === 1) await harness.waitForPending();
				call++;
				return harness.result;
			},
		});
		const commandRun = command.handler("", context.ctx);
		await started;
		assert.equal(observedSignal?.aborted, false);
		const handler = mock.events.get(event)?.[0];
		assert.ok(handler);
		await handler({}, context.ctx);
		assert.equal(observedSignal?.aborted, true);
		await commandRun;
	}
	assert.equal(cleared, 0);
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
			getCompletionDelivery: () => "next-turn",
			getDelegationCwdPolicy: () => "trusted-targets",
			setCompletionDelivery: () => undefined,
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
				const inputs = call === 0 ? ["\r"] : call === 1 ? ["\r"] : ["\u001b"];
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
