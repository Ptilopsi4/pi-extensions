import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { test } from "vitest";
import { createMockPi } from "../../../test/support.js";
import subagents from "../src/subagents.js";

initTheme("dark", false);

interface RegisteredTool {
	name: string;
	renderCall?: (
		args: unknown,
		theme: unknown,
		context: unknown,
	) => { render(width: number): string[] };
	renderResult?: (
		result: unknown,
		options: { expanded: boolean; isPartial: boolean },
		theme: unknown,
		context: unknown,
	) => { render(width: number): string[] };
}

const identityTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};
const ESCAPE = String.fromCharCode(27);
const SGR_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");

function withoutSgr(value: string): string {
	return value.replace(SGR_PATTERN, "");
}

function rendererContext(args: unknown, isError = false) {
	return {
		args,
		toolCallId: "call-1",
		invalidate() {},
		lastComponent: undefined,
		state: {},
		cwd: process.cwd(),
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError,
	};
}

function registeredTools(): Map<string, RegisteredTool> {
	const previous = process.env.PI_CODING_AGENT_DIR;
	const directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-tool-rendering-"));
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const mock = createMockPi();
		subagents(mock.pi);
		return new Map(
			mock.tools.map((tool) => [String(tool.name), tool as unknown as RegisteredTool]),
		);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(directory, { recursive: true, force: true });
	}
}

function renderCall(tool: RegisteredTool, args: unknown, width = 80): string[] {
	assert.ok(tool.renderCall, `${tool.name} must register renderCall`);
	return tool.renderCall(args, identityTheme, rendererContext(args)).render(width);
}

function renderResult(
	tool: RegisteredTool,
	args: unknown,
	result: unknown,
	options = { expanded: false, isPartial: false },
	width = 80,
	isError = false,
): string[] {
	assert.ok(tool.renderResult, `${tool.name} must register renderResult`);
	return tool
		.renderResult(result, options, identityTheme, rendererContext(args, isError))
		.render(width);
}

const statefulAgent = {
	id: "sa_worker",
	agent: "worker",
	state: "running",
	createdAt: 1,
	updatedAt: 2,
	historyCount: 1,
	unreadMessages: 2,
	turnGeneration: 1,
	pendingCompletionCount: 0,
	thinkingLevel: "high",
	currentTask: "Inspect the renderer",
};

const consultDetails = {
	agent: "reviewer",
	agentSource: "built-in",
	agentScope: "user",
	cwd: ".",
	model: "requested-model",
	thinkingLevel: "high",
	timeoutMs: 10_000,
	policy: {
		requestedTools: null,
		effectiveTools: ["read", "grep", "find", "ls"],
		requestedResources: "project-context",
		effectiveResources: {
			policy: "project-context",
			projectResources: true,
			contextFiles: true,
			skills: false,
			promptTemplates: false,
		},
		extensions: "disabled",
		sessionPersistence: "disabled",
		retainedAgent: false,
	},
	progress: {
		phase: "running",
		recentActivity: [
			{ type: "toolCall", name: "read", args: { path: "src/auth.ts" } },
			{ type: "toolCall", name: "grep", args: { pattern: "token", path: "src" } },
		],
		recentActivityTotal: 2,
		actualProvider: "actual-provider",
		actualModel: "actual-model",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.25,
			contextTokens: 15,
			turns: 1,
		},
	},
};

test("all eight subagent tools register native call and result renderers", () => {
	const tools = registeredTools();
	assert.deepEqual([...tools.keys()].sort(), [
		"subagent",
		"subagent_await",
		"subagent_consult",
		"subagent_inspect",
		"subagent_mailbox",
		"subagent_manage",
		"subagent_send",
		"subagent_spawn",
	]);
	for (const tool of tools.values()) {
		assert.equal(typeof tool.renderCall, "function", `${tool.name} renderCall`);
		assert.equal(typeof tool.renderResult, "function", `${tool.name} renderResult`);
	}
});

test("panel renderer is width-safe, sanitized, and preserves objections and dissent", () => {
	const tool = registeredTools().get("subagent");
	assert.ok(tool);
	const args = {
		panel: {
			preset: "code-review",
			task: "Review <private>SECRET</private> unsafe\u001b]8;;link\u0007 change",
			reviewers: [
				{ id: "a", agent: "reviewer", focus: "correctness" },
				{ id: "b", agent: "reviewer", focus: "tests" },
			],
			synthesizer: { agent: "reviewer" },
		},
	};
	const callLines = renderCall(tool, args, 32);
	const call = withoutSgr(callLines.join("\n"));
	assert.match(call, /panel code-review.*2\s+reviewers/is);
	assert.doesNotMatch(call, /SECRET/u);
	assert.equal(call.includes(ESCAPE), false);
	assert.ok(callLines.every((line) => visibleWidth(line) <= 32));

	const review = {
		version: "pi-subagents:panel-review:v1",
		reviewerId: "a",
		disposition: "fail",
		blocking: true,
		findings: [
			{
				id: "F1",
				severity: "high",
				title: "Unsafe terminal\u001b[31m output",
				claim: "unsafe",
				evidence: ["src/a.ts:1"],
			},
		],
		missingChecks: [],
		limitations: [],
	};
	const details = {
		mode: "panel",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			{
				agent: "reviewer",
				agentSource: "built-in",
				task: "Review",
				exitCode: 0,
				messages: [],
				stderr: "",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
				step: 1,
			},
		],
		panel: {
			id: "panel-1",
			preset: "code-review",
			state: "completed",
			reviewerIds: ["a", "b"],
			validReviewCount: 2,
			failedReviewCount: 0,
			blockingObjectionCount: 1,
			dissentCount: 1,
			budgets: {
				totalMs: 10_000,
				reviewMs: 6_500,
				finalizationMs: 1_000,
				synthesisMs: 2_000,
				cleanupMs: 500,
				reviewerTimeoutMs: 6_500,
			},
			evidence: [
				{ panelId: "panel-1", reviewerId: "a", revision: 1, review },
				{
					panelId: "panel-1",
					reviewerId: "b",
					revision: 1,
					review: { ...review, reviewerId: "b", blocking: false, findings: [] },
				},
			],
			failures: [],
			synthesis: {
				version: "pi-subagents:panel-synthesis:v1",
				disposition: "fail",
				summary: "The blocker remains.",
				validReviewerIds: ["a", "b"],
				failedReviewerIds: [],
				agreements: [],
				disagreements: [{ summary: "Reviewers disagree", reviewerIds: ["a", "b"] }],
				objections: [{ reviewerId: "a", findingId: "F1", resolution: "unresolved", evidence: [] }],
				limitations: ["No runtime smoke"],
			},
			cleanupComplete: true,
		},
	};
	const expandedLines = renderResult(
		tool,
		args,
		{ content: [{ type: "text", text: "The blocker remains." }], details },
		{ expanded: true, isPartial: false },
		32,
	);
	const expanded = withoutSgr(expandedLines.join("\n"));
	assert.match(expanded, /blockers 1.*dissent 1/is);
	assert.match(expanded, /Reviewers disagree/);
	assert.match(expanded, /a\/F1: unresolved/);
	assert.equal(expanded.includes(ESCAPE), false);
	assert.ok(expandedLines.every((line) => visibleWidth(line) <= 32));
});

test("consult renderer shows bounded live activity and progressive disclosure", () => {
	const tool = registeredTools().get("subagent_consult");
	assert.ok(tool);
	const args = {
		agent: "reviewer",
		task: "Inspect authentication <private>CALL_SECRET</private>\u001b]8;;bad\u0007 changes",
		agentScope: "user",
		thinkingLevel: "high",
	};
	const call = withoutSgr(renderCall(tool, args).join("\n"));
	assert.match(call, /subagent_consult.*reviewer.*user.*read-only/is);
	assert.match(call, /Inspect authentication/);
	assert.doesNotMatch(call, /CALL_SECRET/u);
	assert.equal(call.includes(ESCAPE), false);

	const partial = withoutSgr(
		renderResult(
			tool,
			args,
			{ content: [{ type: "text", text: "(running...)" }], details: consultDetails },
			{ expanded: false, isPartial: true },
		).join("\n"),
	);
	assert.match(partial, /Running/);
	assert.match(partial, /actual-provider\/actual-model/);
	assert.match(partial, /requested-thinking:high/);
	assert.match(partial, /read src\/auth\.ts/);
	assert.match(partial, /grep \/token\/ in src/);

	const finalDetails = {
		...consultDetails,
		progress: undefined,
		child: {
			actualProvider: "actual-provider",
			actualModel: "actual-model",
			usage: consultDetails.progress.usage,
		},
	};
	const answer = "line one\nline two\nline three\nline four";
	const collapsed = withoutSgr(
		renderResult(tool, args, {
			content: [{ type: "text", text: answer }],
			details: finalDetails,
		}).join("\n"),
	);
	assert.match(collapsed, /Completed/);
	assert.match(collapsed, /line three/);
	assert.doesNotMatch(collapsed, /line four/);
	assert.match(collapsed, /expand/);
	assert.doesNotMatch(collapsed, /\(Ctrl\+O to expand\)/);

	const expanded = withoutSgr(
		renderResult(
			tool,
			args,
			{ content: [{ type: "text", text: answer }], details: finalDetails },
			{ expanded: true, isPartial: false },
		).join("\n"),
	);
	assert.match(expanded, /Task/);
	assert.match(expanded, /Policy/);
	assert.match(expanded, /line four/);
});

test("consult renderer distinguishes starting, cancellation, timeout, and abort states", () => {
	const tool = registeredTools().get("subagent_consult");
	assert.ok(tool);
	const args = { agent: "reviewer", task: "Inspect" };
	const renderState = (details: Record<string, unknown>, isPartial = false, isError = false) =>
		withoutSgr(
			renderResult(
				tool,
				args,
				{ content: [{ type: "text", text: "state output" }], details },
				{ expanded: false, isPartial },
				80,
				isError,
			).join("\n"),
		);

	assert.match(
		renderState(
			{
				...consultDetails,
				progress: { ...consultDetails.progress, phase: "starting", recentActivity: [] },
			},
			true,
		),
		/Starting/,
	);
	assert.match(
		renderState({ ...consultDetails, progress: undefined, cancelled: true }),
		/Cancelled/,
	);
	assert.match(
		renderState(
			{
				...consultDetails,
				progress: undefined,
				isError: true,
				child: { timedOut: true, error: "timed out" },
			},
			false,
			true,
		),
		/Failed/,
	);
	assert.match(
		renderState(
			{
				...consultDetails,
				progress: undefined,
				isError: true,
				child: { aborted: true, timedOut: false, error: "aborted" },
			},
			false,
			true,
		),
		/Cancelled/,
	);
});

test("inspect renderer summarizes every action instead of dumping collapsed JSON", () => {
	const tool = registeredTools().get("subagent_inspect");
	assert.ok(tool);
	const cases = [
		{
			args: { action: "list_agents", agentScope: "user" },
			details: {
				action: "list_agents",
				agents: [{ name: "explorer", source: "built-in", toolCount: 4, consultTools: ["read"] }],
				returned: 1,
				omitted: 0,
			},
			expected: /1 agent.*explorer/is,
		},
		{
			args: { action: "get_agent", agent: "explorer" },
			details: {
				action: "get_agent",
				agent: { name: "explorer", source: "built-in", description: "Explorer files" },
			},
			expected: /explorer.*built-in.*Explorer files/is,
		},
		{
			args: { action: "list_runs" },
			details: { action: "list_runs", runs: [statefulAgent], returned: 1, omitted: 0 },
			expected: /1 run.*sa_worker.*running/is,
		},
		{
			args: { action: "get_run", agentId: "sa_worker" },
			details: { action: "get_run", run: statefulAgent },
			expected: /sa_worker.*worker.*running/is,
		},
		{
			args: { action: "list_models" },
			details: {
				action: "list_models",
				models: [
					{ provider: "provider", id: "model", name: "Model", current: true, reasoning: true },
				],
				returned: 1,
				omitted: 0,
				source: "session scope",
			},
			expected: /1 model.*provider\/model.*current/is,
		},
		{
			args: { action: "status" },
			details: {
				action: "status",
				status: {
					workflow: "all",
					consultResources: "project-context",
					stateful: {
						initialized: true,
						activeAgents: 1,
						retainedAgents: 2,
						limits: {
							maxAgents: 16,
							maxActiveTurns: 4,
							maxChildrenPerAgent: 8,
							maxDepth: 3,
							maxStoredAgents: 50,
						},
					},
					statefulLimits: {
						maxAgents: 16,
						maxActiveTurns: 4,
						maxChildrenPerAgent: 8,
						maxDepth: 3,
						maxStoredAgents: 50,
					},
					configuredStatefulLimits: {
						maxAgents: 20,
						maxActiveTurns: 4,
						maxChildrenPerAgent: 8,
						maxDepth: 3,
						maxStoredAgents: 50,
					},
					configuredStatefulLimitSources: {
						maxAgents: "user settings",
						maxActiveTurns: "default",
						maxChildrenPerAgent: "default",
						maxDepth: "default",
						maxStoredAgents: "default",
					},
				},
			},
			expected: /workflow: all.*1 active.*2 retained.*limits:.*agents:16.*stored:50/is,
		},
		{
			args: { action: "diagnose" },
			details: {
				action: "diagnose",
				ok: false,
				checks: [
					{ name: "settings", status: "pass", message: "Settings are valid." },
					{ name: "runtime", status: "warning", message: "Not initialized." },
					{ name: "models", status: "fail", message: "No models." },
				],
			},
			expected: /Diagnostics failed.*PASS.*WARNING.*FAIL/is,
		},
	] as const;

	for (const fixture of cases) {
		const text = withoutSgr(
			renderResult(tool, fixture.args, {
				content: [{ type: "text", text: JSON.stringify(fixture.details) }],
				details: fixture.details,
			}).join("\n"),
		);
		assert.match(text, fixture.expected);
		assert.doesNotMatch(text, /^\s*\{/u);
	}

	const statusFixture = cases.find((fixture) => fixture.args.action === "status");
	assert.ok(statusFixture);
	const expandedStatus = withoutSgr(
		renderResult(
			tool,
			statusFixture.args,
			{
				content: [{ type: "text", text: JSON.stringify(statusFixture.details) }],
				details: statusFixture.details,
			},
			{ expanded: true, isPartial: false },
		).join("\n"),
	);
	assert.match(expandedStatus, /configured:.*agents:20 \(user settings\).*active:4 \(default\)/is);
});

test("detached lifecycle renderers summarize calls and action-specific results", () => {
	const tools = registeredTools();
	const fixtures = [
		{
			name: "subagent_spawn",
			args: {
				agent: "worker",
				task: "Review files",
				agentScope: "user",
				workspaceMode: "worktree",
				thinkingLevel: "high",
			},
			result: { content: [{ type: "text", text: "Spawned." }], details: { agent: statefulAgent } },
			expected: /worker.*detached.*worktree.*sa_worker.*running/is,
		},
		{
			name: "subagent_send",
			args: { agentId: "sa_worker", task: "Review again" },
			result: { content: [{ type: "text", text: "Started." }], details: { agent: statefulAgent } },
			expected: /sa_worker.*follow-up.*running/is,
		},
		{
			name: "subagent_manage",
			args: { action: "interrupt", agentId: "sa_worker", subtree: true },
			result: {
				content: [{ type: "text", text: "Interrupted 1 active agent(s)." }],
				details: { agent: { ...statefulAgent, state: "interrupted" }, agents: [statefulAgent] },
			},
			expected: /interrupt.*subtree.*Interrupted.*1 agent/is,
		},
		{
			name: "subagent_manage",
			args: { action: "close", agentId: "sa_worker" },
			result: {
				content: [{ type: "text", text: "Closed." }],
				details: { agent: { ...statefulAgent, state: "closed" } },
			},
			expected: /close.*Closed.*sa_worker/is,
		},
		{
			name: "subagent_mailbox",
			args: { action: "send", agentId: "sa_worker", message: "Queue this" },
			result: {
				content: [{ type: "text", text: "Queued." }],
				details: {
					message: {
						id: "msg_1",
						senderId: "root",
						recipientId: "sa_worker",
						content: "Queue this",
					},
				},
			},
			expected: /send.*sa_worker.*Queued.*msg_1/is,
		},
		{
			name: "subagent_mailbox",
			args: { action: "read", agentId: "sa_worker", acknowledge: true },
			result: {
				content: [{ type: "text", text: "message" }],
				details: {
					messages: [
						{ id: "msg_1", senderId: "worker", recipientId: "sa_worker", content: "Done" },
					],
				},
			},
			expected: /read.*sa_worker.*1 message.*acknowledged.*Done/is,
		},
	] as const;

	for (const fixture of fixtures) {
		const tool = tools.get(fixture.name);
		assert.ok(tool);
		const text = withoutSgr(
			[...renderCall(tool, fixture.args), ...renderResult(tool, fixture.args, fixture.result)].join(
				"\n",
			),
		);
		assert.match(text, fixture.expected, fixture.name);
	}

	const manage = tools.get("subagent_manage");
	assert.ok(manage);
	const noActiveDescendants = withoutSgr(
		renderResult(
			manage,
			{ action: "interrupt", agentId: "sa_worker", subtree: true },
			{
				content: [{ type: "text", text: "Interrupted 0 active agent(s)." }],
				details: { agent: { ...statefulAgent, state: "completed" }, agents: [] },
			},
		).join("\n"),
	);
	assert.match(noActiveDescendants, /Interrupted.*0 agents/is);
	assert.doesNotMatch(noActiveDescendants, /1 agent/);
});

test("collapsed mailbox rows flatten message blocks while expanded rows preserve them", () => {
	const mailbox = registeredTools().get("subagent_mailbox");
	assert.ok(mailbox);
	const args = { action: "read", agentId: "sa_worker", acknowledge: true };
	const result = {
		content: [{ type: "text", text: "message" }],
		details: {
			messages: [
				{
					id: "msg_1",
					senderId: "worker",
					recipientId: "sa_worker",
					content: `first line\nsecond line\n${"x".repeat(600)}`,
				},
			],
		},
	};

	const collapsed = renderResult(
		mailbox,
		args,
		result,
		{ expanded: false, isPartial: false },
		4096,
	).map(withoutSgr);
	assert.equal(collapsed.length, 3);
	assert.match(collapsed[1] ?? "", /^• msg_1 from worker: first line second line .*… \[truncated/u);

	const expanded = withoutSgr(
		renderResult(mailbox, args, result, { expanded: true, isPartial: false }, 4096).join("\n"),
	);
	assert.match(expanded, /first line[ \t]*\nsecond line[ \t]*\n/u);
});

test("structured tool views remain width-safe when collapsed and expanded", () => {
	const tools = registeredTools();
	const fixtures = [
		{
			name: "subagent_consult",
			args: { agent: "reviewer", task: "Inspect authentication behavior in the current workspace" },
			result: {
				content: [{ type: "text", text: "A long consultation answer that must wrap safely." }],
				details: {
					...consultDetails,
					progress: undefined,
					child: { usage: consultDetails.progress.usage },
				},
			},
		},
		{
			name: "subagent_inspect",
			args: { action: "list_runs" },
			result: {
				content: [{ type: "text", text: "runs" }],
				details: { action: "list_runs", runs: [statefulAgent], returned: 1, omitted: 0 },
			},
		},
		{
			name: "subagent_spawn",
			args: { agent: "worker", task: "Review a long detached task", workspaceMode: "worktree" },
			result: { content: [{ type: "text", text: "spawned" }], details: { agent: statefulAgent } },
		},
		{
			name: "subagent_send",
			args: { agentId: "sa_worker", task: "Continue a long retained task" },
			result: { content: [{ type: "text", text: "sent" }], details: { agent: statefulAgent } },
		},
		{
			name: "subagent_manage",
			args: { action: "close", agentId: "sa_worker" },
			result: {
				content: [{ type: "text", text: "closed" }],
				details: { agent: { ...statefulAgent, state: "closed" } },
			},
		},
		{
			name: "subagent_mailbox",
			args: { action: "read", agentId: "sa_worker", acknowledge: true },
			result: {
				content: [{ type: "text", text: "message" }],
				details: {
					messages: [
						{
							id: "message_one",
							senderId: "worker",
							recipientId: "sa_worker",
							content: "A long mailbox message that must wrap safely.",
						},
					],
				},
			},
		},
	] as const;

	for (const fixture of fixtures) {
		const tool = tools.get(fixture.name);
		assert.ok(tool);
		for (const width of [12, 24]) {
			const renderedViews: string[][] = [
				renderCall(tool, fixture.args, width),
				renderResult(
					tool,
					fixture.args,
					fixture.result,
					{ expanded: false, isPartial: false },
					width,
				),
				renderResult(
					tool,
					fixture.args,
					fixture.result,
					{ expanded: true, isPartial: false },
					width,
				),
			];
			assert.ok(
				renderedViews.flat().every((line) => visibleWidth(line) <= width),
				`${fixture.name} exceeded width ${width}: ${JSON.stringify(renderedViews)}`,
			);
		}
	}

	const mailbox = tools.get("subagent_mailbox");
	assert.ok(mailbox);
	assert.match(
		withoutSgr(
			renderResult(
				mailbox,
				{ action: "read", agentId: "sa_worker" },
				{ content: [{ type: "text", text: "No unread messages." }], details: { messages: [] } },
			).join("\n"),
		),
		/no unread messages/i,
	);
});

test("tool renderers tolerate partial args, sanitize fallback text, and respect narrow widths", () => {
	const tools = registeredTools();
	for (const [name, tool] of tools) {
		assert.doesNotThrow(() => renderCall(tool, {}, 12), `${name} partial call args`);
	}

	const unsafe = "visible <private>RESULT_SECRET</private>\u001b]8;;https://bad.invalid\u0007 tail";
	for (const name of [
		"subagent_consult",
		"subagent_inspect",
		"subagent_spawn",
		"subagent_send",
		"subagent_await",
		"subagent_manage",
		"subagent_mailbox",
	]) {
		const tool = tools.get(name);
		assert.ok(tool);
		const lines = renderResult(
			tool,
			{},
			{ content: [{ type: "text", text: unsafe }], details: undefined },
			{ expanded: false, isPartial: false },
			12,
			true,
		);
		const plain = withoutSgr(lines.join("\n"));
		assert.doesNotMatch(plain, /RESULT_SECRET/u, name);
		assert.equal(plain.includes(ESCAPE), false, name);
		assert.match(plain, /visible.*tail/s, name);
		assert.ok(
			lines.every((line) => visibleWidth(line) <= 12),
			`${name} exceeded narrow width: ${JSON.stringify(lines)}`,
		);
	}
});
