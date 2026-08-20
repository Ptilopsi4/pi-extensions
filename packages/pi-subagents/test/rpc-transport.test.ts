import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import type { ManagedAgent } from "../src/registry.js";
import { finalizeTimedOutRpcTurn } from "../src/rpc-timeout-finalization.js";
import { buildRpcArgs, RpcProtocolClient, RpcTransport } from "../src/rpc-transport.js";
import { PI_SUBAGENTS_RPC_PROTOCOL, type TransportTelemetry } from "../src/transport-types.js";

test("RPC timeout finalization never prompts after an explicit parent abort", async () => {
	const controller = new AbortController();
	controller.abort();
	let prompts = 0;
	let releases = 0;
	const result = await finalizeTimedOutRpcTurn({
		client: {
			async prompt() {
				prompts++;
			},
			async abort() {},
			onEvent: () => () => undefined,
			onClose: () => () => undefined,
		},
		task: "review",
		partialOutput: "partial",
		signal: controller.signal,
		workTimeoutMs: 100,
		abortGraceMs: 10,
		resetCapture() {},
		getCapture: () => ({ output: "", partial: "" }),
		async release() {
			releases++;
		},
	});
	assert.equal(prompts, 0);
	assert.equal(releases, 1);
	assert.match(result.error ?? "", /aborted/i);
});

test("RPC timeout finalization bounds a prompt client that ignores its deadline", async () => {
	let releases = 0;
	const started = Date.now();
	const result = await finalizeTimedOutRpcTurn({
		client: {
			async prompt() {
				await new Promise<void>(() => undefined);
			},
			async abort() {},
			onEvent: () => () => undefined,
			onClose: () => () => undefined,
		},
		task: "review",
		partialOutput: "partial",
		signal: new AbortController().signal,
		workTimeoutMs: 100,
		finalizationTimeoutMs: 10,
		abortGraceMs: 10,
		resetCapture() {},
		getCapture: () => ({ output: "", partial: "" }),
		async release() {
			releases++;
		},
	});
	assert.equal(releases, 1);
	assert.match(result.error ?? "", /prompt timed out/i);
	assert.ok(Date.now() - started < 500, "prompt finalization must remain hard-bounded");
});

function fixtureScript(root: string): string {
	const filePath = path.join(root, "fake-rpc.mjs");
	writeFileSync(
		filePath,
		[
			'import { StringDecoder } from "node:string_decoder";',
			"const decoder=new StringDecoder('utf8');let buffer='';let turns=0;let pendingPrompt;",
			"const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');",
			"const finishPrompt=()=>{const command=pendingPrompt;pendingPrompt=undefined;const firstUsage={input:turns,output:1,cacheRead:0,cacheWrite:0,totalTokens:turns+1,cost:{total:0.125}};const finalUsage={input:turns,output:2,cacheRead:0,cacheWrite:0,totalTokens:turns+2,cost:{total:0.25}};send({id:command.id,type:'response',command:'prompt',success:true});send({type:'agent_start'});send({type:'message_start',message:{role:'assistant',content:[]}});send({type:'message_update',usage:firstUsage,assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'turn '}});send({type:'message_update',usage:firstUsage,assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:''}});send({type:'message_update',usage:finalUsage,assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:String(turns)}});send({type:'agent_end',messages:[],willRetry:false});send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'turn '+turns}],provider:'fake',model:'rpc-model',usage:finalUsage,stopReason:'stop'}});send({type:'agent_settled'});};const handle=(line)=>{const command=JSON.parse(line);",
			"if(command.type==='get_state'){send({id:command.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'rpc-model'},thinkingLevel:'medium',isStreaming:false,isCompacting:false,steeringMode:'one-at-a-time',followUpMode:'one-at-a-time',sessionId:'fake-session',autoCompactionEnabled:true,messageCount:turns*2,pendingMessageCount:0}});return;}",
			"if(command.type==='abort'){send({id:command.id,type:'response',command:'abort',success:true});send({type:'agent_settled'});return;}",
			"if(command.type==='extension_ui_response'){if(command.id==='ui-'+turns&&command.cancelled===true)finishPrompt();return;}",
			"if(command.type==='prompt'){turns++;pendingPrompt=command;send({type:'extension_ui_request',id:'ui-'+turns,method:'confirm',title:'must cancel'});return;}",
			"};",
			"process.stdin.on('data',(chunk)=>{buffer+=decoder.write(chunk);while(true){const index=buffer.indexOf('\\n');if(index<0)break;let line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(line.endsWith('\\r'))line=line.slice(0,-1);if(line)handle(line);}});",
		].join(""),
	);
	return filePath;
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(filePath)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
}

function managedAgent(): ManagedAgent {
	const now = Date.now();
	return {
		id: "sa_rpc",
		agent: "worker",
		rootId: "sa_rpc",
		depth: 0,
		children: [],
		state: "running",
		createdAt: now,
		updatedAt: now,
		cwd: process.cwd(),
		history: [],
		mailbox: [],
		target: {
			cwd: process.cwd(),
			boundary: "current-workspace",
			trust: { kind: "session-trusted", projectTrusted: true },
		},
	};
}

test("RPC launch arguments preserve model, thinking, tools, trust, and role policy", () => {
	const args = buildRpcArgs(
		{ ...managedAgent(), thinkingLevel: "high" },
		{
			name: "worker",
			description: "work",
			model: "provider/model:low",
			tools: ["read", "find"],
			systemPrompt: "work",
			source: "built-in",
			filePath: "built-in:worker",
		},
		{ model: undefined, thinkingLevel: "medium" },
		"/tmp/role.md",
		["/tmp/global-append.md", "/tmp/project-append.md"],
	);
	assert.deepEqual(args, [
		"--mode",
		"rpc",
		"--no-session",
		"--no-extensions",
		"--model",
		"provider/model:low",
		"--thinking",
		"high",
		"--approve",
		"--tools",
		"read,find",
		"--append-system-prompt",
		"/tmp/global-append.md",
		"--append-system-prompt",
		"/tmp/project-append.md",
		"--append-system-prompt",
		"/tmp/role.md",
	]);
	const inheritedThinking = buildRpcArgs(
		managedAgent(),
		{
			name: "worker",
			description: "work",
			model: "provider/model",
			tools: [],
			systemPrompt: "",
			source: "built-in",
			filePath: "built-in:worker",
		},
		{ model: undefined, thinkingLevel: "medium" },
	);
	assert.deepEqual(inheritedThinking.slice(4, 10), [
		"--model",
		"provider/model",
		"--thinking",
		"medium",
		"--approve",
		"--no-tools",
	]);
	const peerBridge = buildRpcArgs(
		managedAgent(),
		{
			name: "worker",
			description: "work",
			tools: ["read"],
			systemPrompt: "",
			source: "built-in",
			filePath: "built-in:worker",
		},
		{ model: undefined, thinkingLevel: "off" },
		undefined,
		[],
		true,
	);
	assert.ok(peerBridge.includes("-e"));
	assert.match(peerBridge[peerBridge.indexOf("-e") + 1] ?? "", /child-peer-bridge\.ts$/u);
	assert.equal(
		peerBridge[peerBridge.indexOf("--tools") + 1],
		"read,subagent_peer_send,subagent_peer_list",
	);
});

test("RpcProtocolClient uses strict JSONL and the get_state readiness handshake", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-client-"));
	try {
		const script = fixtureScript(root);
		const client = new RpcProtocolClient({
			cwd: root,
			args: [],
			invocation: { command: process.execPath, args: [script] },
		});
		const snapshot = await client.start();
		assert.equal(snapshot.state.sessionId, "fake-session");
		assert.equal(snapshot.state.thinkingLevel, "medium");
		const events: string[] = [];
		const unsubscribe = client.onEvent((event) => {
			if (event && typeof event === "object" && "type" in event) {
				events.push(String((event as { type?: unknown }).type));
			}
		});
		const settled = new Promise<void>((resolve) => {
			const stop = client.onEvent((event) => {
				if ((event as { type?: string }).type === "agent_settled") {
					stop();
					resolve();
				}
			});
		});
		await client.prompt("hello\u2028world\u2029again");
		await settled;
		assert.ok(events.includes("message_update"));
		assert.ok(events.includes("agent_settled"));
		unsubscribe();
		await client.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("RpcProtocolClient gives inherited descendant streams bounded cleanup grace", async () => {
	if (process.platform === "win32") return;
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-descendant-"));
	let descendantPid: number | undefined;
	try {
		const marker = path.join(root, "descendant.pid");
		const script = path.join(root, "descendant-rpc.mjs");
		writeFileSync(
			script,
			[
				'import { spawn } from "node:child_process";',
				'import { writeFileSync } from "node:fs";',
				"let buffer='';const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');",
				"process.stdin.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line)continue;const command=JSON.parse(line);if(command.type!=='get_state')continue;",
				`const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','inherit','inherit']});child.unref();writeFileSync(${JSON.stringify(marker)},String(child.pid));`,
				"send({id:command.id,type:'response',command:'get_state',success:true,data:{thinkingLevel:'low',sessionId:'descendant'}});setTimeout(()=>process.exit(0),20);}});",
			].join(""),
		);
		const client = new RpcProtocolClient({
			cwd: root,
			args: [],
			terminationGraceMs: 10,
			invocation: { command: process.execPath, args: [script] },
		});
		await client.start();
		await waitForFile(marker);
		descendantPid = Number(readFileSync(marker, "utf8"));
		assert.equal(Number.isSafeInteger(descendantPid), true);
		const stopping = client.stop();
		assert.equal(
			await settlesWithin(stopping, 100),
			false,
			"stop must allow captured streams a cleanup grace period",
		);
		assert.equal(
			await settlesWithin(stopping, 1_500),
			true,
			"stop must hard-bound cleanup when a detached descendant retains captured streams",
		);
		process.kill(-descendantPid, "SIGKILL");
	} finally {
		if (descendantPid) {
			try {
				process.kill(-descendantPid, "SIGKILL");
			} catch {
				// The descendant was already reaped.
			}
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("RpcTransport retains one child across turns and reports pi-subagents:v1 telemetry", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-transport-"));
	try {
		const script = fixtureScript(root);
		let creations = 0;
		let rolePromptPath: string | undefined;
		const resourceRequests: Array<{ cwd: string; trusted: boolean }> = [];
		const revoked: string[] = [];
		const transport = new RpcTransport({
			getParentRuntime: () => ({ model: undefined, thinkingLevel: "medium" }),
			peerRuntime: {
				async send() {
					throw new Error("unused");
				},
				list: () => [],
				async acknowledge() {},
				async issueCredentials() {
					return { host: "127.0.0.1", port: 12345, token: "rpc-token", generation: 1 };
				},
				revoke(agentId) {
					revoked.push(agentId);
				},
			},
			resolvePromptResources: async (cwd, trusted) => {
				resourceRequests.push({ cwd, trusted });
				return {
					appendSystemPromptPaths: ["/tmp/global-append.md", "/tmp/project-append.md"],
				};
			},
			createClient: (options) => {
				creations++;
				const roleIndex = options.args.lastIndexOf("--append-system-prompt");
				if (roleIndex >= 0) rolePromptPath = options.args[roleIndex + 1];
				return new RpcProtocolClient({
					...options,
					invocation: { command: process.execPath, args: [script] },
				});
			},
		});
		const agent = { ...managedAgent(), cwd: root };
		const progress: TransportTelemetry[] = [];
		const first = await transport.runTurn(agent, "first", new AbortController().signal, (update) =>
			progress.push(update),
		);
		assert.equal(first.output, "turn 1");
		assert.equal(first.exitCode, 0);
		assert.equal(first.telemetry?.protocol, PI_SUBAGENTS_RPC_PROTOCOL);
		assert.equal(first.telemetry?.provider, "fake");
		assert.equal(first.telemetry?.model, "rpc-model");
		assert.equal(first.telemetry?.phase, "settled");
		assert.deepEqual(first.telemetry?.usage, {
			input: 1,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 3,
			cost: 0.25,
			turns: 1,
		});
		assert.deepEqual(
			progress
				.filter((update) => update.phase === "running" && update.usage && update.usage.turns === 0)
				.map((update) => [update.usage?.totalTokens, update.usage?.cost, update.usage?.turns]),
			[
				[2, 0.125, 0],
				[3, 0.25, 0],
			],
		);
		assert.deepEqual(resourceRequests, [{ cwd: root, trusted: true }]);
		assert.ok(rolePromptPath && existsSync(rolePromptPath));
		const second = await transport.runTurn(
			{
				...agent,
				history: [{ task: "first", output: "turn 1", startedAt: 1, completedAt: 2, exitCode: 0 }],
			},
			"second",
			new AbortController().signal,
		);
		assert.equal(second.output, "turn 2");
		assert.equal(creations, 1);
		await transport.release?.(agent);
		assert.equal(rolePromptPath ? existsSync(rolePromptPath) : true, false);
		assert.deepEqual(revoked, [agent.id]);
		await transport.release?.(agent);
		await transport.shutdown();
		assert.deepEqual(revoked, [agent.id]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("RpcTransport revokes peer credentials and removes role prompts after partial startup failure", async () => {
	let rolePromptPath: string | undefined;
	const revoked: string[] = [];
	const transport = new RpcTransport({
		getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
		peerRuntime: {
			async send() {
				throw new Error("unused");
			},
			list: () => [],
			async acknowledge() {},
			async issueCredentials() {
				return { host: "127.0.0.1", port: 12345, token: "partial-token", generation: 1 };
			},
			revoke(agentId) {
				revoked.push(agentId);
			},
		},
		resolvePromptResources: async () => ({ appendSystemPromptPaths: [] }),
		createClient(options) {
			const roleIndex = options.args.lastIndexOf("--append-system-prompt");
			rolePromptPath = roleIndex >= 0 ? options.args[roleIndex + 1] : undefined;
			throw new Error("client construction failed");
		},
	});
	const agent = managedAgent();
	const result = await transport.runTurn(agent, "fail", new AbortController().signal);
	assert.equal(result.exitCode, 1);
	assert.match(result.error ?? "", /client construction failed/);
	assert.ok(rolePromptPath);
	assert.equal(rolePromptPath ? existsSync(rolePromptPath) : true, false);
	assert.deepEqual(revoked, [agent.id]);
	await transport.shutdown();
});

test("RpcProtocolClient aborts readiness and rejects malformed protocol records", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-invalid-"));
	try {
		const hanging = path.join(root, "hanging.mjs");
		writeFileSync(hanging, "process.stdin.resume();setInterval(()=>{},1000).unref();");
		const controller = new AbortController();
		const client = new RpcProtocolClient({
			cwd: root,
			args: [],
			startupTimeoutMs: 5_000,
			terminationGraceMs: 10,
			invocation: { command: process.execPath, args: [hanging] },
		});
		const pending = client.start(controller.signal);
		setTimeout(() => controller.abort(), 20);
		await assert.rejects(pending, (error) => error instanceof Error && error.name === "AbortError");

		const malformed = path.join(root, "malformed.mjs");
		writeFileSync(
			malformed,
			"process.stderr.write('x'.repeat(32*1024));process.stdin.once('data',()=>process.stdout.write('{not-json\\n'));process.stdin.resume();",
		);
		const malformedClient = new RpcProtocolClient({
			cwd: root,
			args: [],
			startupTimeoutMs: 5_000,
			terminationGraceMs: 10,
			invocation: { command: process.execPath, args: [malformed] },
		});
		await assert.rejects(() => malformedClient.start(), /malformed JSONL/);
		assert.ok(Buffer.byteLength(malformedClient.getStderr(), "utf8") <= 16 * 1024);

		const mismatched = path.join(root, "mismatched.mjs");
		writeFileSync(
			mismatched,
			"let b='';process.stdin.on('data',chunk=>{b+=chunk;const i=b.indexOf('\\n');if(i<0)return;const c=JSON.parse(b.slice(0,i));process.stdout.write(JSON.stringify({id:c.id,type:'response',command:'prompt',success:true})+'\\n')});",
		);
		const mismatchedClient = new RpcProtocolClient({
			cwd: root,
			args: [],
			startupTimeoutMs: 5_000,
			terminationGraceMs: 10,
			invocation: { command: process.execPath, args: [mismatched] },
		});
		await assert.rejects(() => mismatchedClient.start(), /response command mismatch/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("RpcTransport waits for agent_settled after agent_end and times out without replay", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-settled-"));
	try {
		const delayed = path.join(root, "delayed.mjs");
		writeFileSync(
			delayed,
			[
				"let buffer='';const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');",
				"process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const c=JSON.parse(line);",
				"if(c.type==='get_state')send({id:c.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'model'},thinkingLevel:'low',sessionId:'s'}});",
				"if(c.type==='prompt'){send({id:c.id,type:'response',command:'prompt',success:true});send({type:'message_start',message:{role:'assistant',content:[]}});send({type:'message_update',usage:{input:3,output:1,cacheRead:0,cacheWrite:0,totalTokens:4,cost:{total:0.25}},assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'before retry'}});send({type:'agent_end',messages:[],willRetry:true});setTimeout(()=>{send({type:'compaction_start'});send({type:'compaction_end'});send({type:'message_start',message:{role:'assistant',content:[]}});send({type:'message_update',usage:{input:2,output:1,cacheRead:0,cacheWrite:0,totalTokens:3,cost:{total:0.125}},assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'after retry'}});send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'after retry'}],provider:'fake',model:'model',usage:{input:2,output:2,cacheRead:0,cacheWrite:0,totalTokens:4,cost:{total:0.5}},stopReason:'stop'}});send({type:'agent_settled'});},30);}",
				"if(c.type==='abort'){send({id:c.id,type:'response',command:'abort',success:true});send({type:'agent_settled'});}",
				"}});",
			].join(""),
		);
		const transport = new RpcTransport({
			getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
			abortGraceMs: 10,
			createClient: (options) =>
				new RpcProtocolClient({
					...options,
					terminationGraceMs: 10,
					invocation: { command: process.execPath, args: [delayed] },
				}),
		});
		const started = Date.now();
		const result = await transport.runTurn(
			{ ...managedAgent(), cwd: root },
			"retry",
			new AbortController().signal,
		);
		assert.equal(result.output, "after retry");
		assert.deepEqual(result.telemetry?.usage, {
			input: 5,
			output: 3,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 8,
			cost: 0.75,
			turns: 1,
		});
		assert.ok(Date.now() - started >= 20, "agent_end must not settle the turn");
		await transport.shutdown();

		const hanging = path.join(root, "turn-hang.mjs");
		writeFileSync(
			hanging,
			[
				"let buffer='';const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');let prompts=0;",
				"process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const c=JSON.parse(line);",
				"if(c.type==='get_state')send({id:c.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'model'},thinkingLevel:'low',sessionId:'s'}});",
				"if(c.type==='prompt'){prompts++;send({id:c.id,type:'response',command:'prompt',success:true});send({type:'message_start',message:{role:'assistant',content:[]}});send({type:'message_update',usage:{input:9,output:1,cacheRead:0,cacheWrite:0,totalTokens:10,cost:{total:0.5}},assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'PARTIAL_HANG'}});send({type:'agent_end',messages:[],willRetry:false});}",
				"if(c.type==='abort')send({id:c.id,type:'response',command:'abort',success:true});",
				"}});",
			].join(""),
		);
		const timeoutTransport = new RpcTransport({
			getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
			defaultTimeoutMs: 20,
			abortGraceMs: 10,
			createClient: (options) =>
				new RpcProtocolClient({
					...options,
					terminationGraceMs: 10,
					invocation: { command: process.execPath, args: [hanging] },
				}),
		});
		const timedOut = await timeoutTransport.runTurn(
			{ ...managedAgent(), cwd: root },
			"hang",
			new AbortController().signal,
		);
		assert.equal(timedOut.exitCode, 124);
		assert.equal(timedOut.output, "PARTIAL_HANG");
		assert.match(timedOut.error ?? "", /timed out/);
		assert.equal(timedOut.telemetry?.failurePhase, "running");
		assert.deepEqual(timedOut.telemetry?.usage, {
			input: 9,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 10,
			cost: 0.5,
			turns: 0,
		});
		await timeoutTransport.shutdown();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("RPC explicit abort preserves streaming usage after the child settles", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-abort-usage-"));
	try {
		const script = path.join(root, "abort-usage.mjs");
		writeFileSync(
			script,
			[
				"let buffer='';const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');",
				"process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const c=JSON.parse(line);",
				"if(c.type==='get_state')send({id:c.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'model'},thinkingLevel:'low',sessionId:'s'}});",
				"if(c.type==='prompt'){send({id:c.id,type:'response',command:'prompt',success:true});send({type:'message_start',message:{role:'assistant',content:[]}});send({type:'message_update',usage:{input:4,output:2,cacheRead:0,cacheWrite:0,totalTokens:6,cost:{total:0.25}},assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'PARTIAL_ABORT'}});}",
				"if(c.type==='abort'){send({id:c.id,type:'response',command:'abort',success:true});send({type:'agent_settled'});}",
				"}});",
			].join(""),
		);
		const transport = new RpcTransport({
			getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
			defaultTimeoutMs: 1_000,
			abortGraceMs: 20,
			createClient: (options) =>
				new RpcProtocolClient({
					...options,
					terminationGraceMs: 10,
					invocation: { command: process.execPath, args: [script] },
				}),
		});
		const controller = new AbortController();
		const result = await transport.runTurn(
			{ ...managedAgent(), cwd: root },
			"abort",
			controller.signal,
			(update) => {
				if (update.usage?.totalTokens === 6 && update.usage.turns === 0) controller.abort();
			},
		);
		assert.equal(result.exitCode, 130);
		assert.equal(result.aborted, true);
		assert.equal(result.output, "PARTIAL_ABORT");
		assert.deepEqual(result.telemetry?.usage, {
			input: 4,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 6,
			cost: 0.25,
			turns: 0,
		});
		await transport.shutdown();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("RPC timeout aborts the work turn and requests a bounded summary after settlement", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-timeout-summary-"));
	try {
		const script = path.join(root, "timeout-summary.mjs");
		const marker = path.join(root, "prompts.log");
		writeFileSync(
			script,
			[
				'import { appendFileSync } from "node:fs";',
				"let buffer='';const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');let prompts=0;",
				"process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const c=JSON.parse(line);",
				"if(c.type==='get_state')send({id:c.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'model'},thinkingLevel:'low',sessionId:'s'}});",
				`if(c.type==='prompt'){appendFileSync(${JSON.stringify(marker)},'prompt\\n');prompts++;send({id:c.id,type:'response',command:'prompt',success:true});if(prompts===1){send({type:'message_start',message:{role:'assistant',content:[]}});send({type:'message_update',usage:{input:5,output:1,cacheRead:0,cacheWrite:0,totalTokens:6,cost:{total:0.25}},assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'PARTIAL_RPC'}});send({type:'tool_execution_start',toolCallId:'read-1',toolName:'read',args:{path:'src/rpc.ts'}});send({type:'tool_execution_end',toolCallId:'read-1',toolName:'read',result:{content:[{type:'text',text:'RPC_TOOL_EVIDENCE'}]},isError:false});send({type:'message_end',message:{role:'toolResult',toolCallId:'read-1',toolName:'read',content:[{type:'text',text:'RPC_TOOL_EVIDENCE'}],isError:false}});}else{send({type:'message_start',message:{role:'assistant',content:[]}});send({type:'message_update',usage:{input:2,output:1,cacheRead:0,cacheWrite:0,totalTokens:3,cost:{total:0.125}},assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'SUMMARY_RPC'}});send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'SUMMARY_RPC'}],provider:'fake',model:'model',usage:{input:2,output:2,cacheRead:0,cacheWrite:0,totalTokens:4,cost:{total:0.5}},stopReason:'stop'}});send({type:'agent_settled'});}}`,
				"if(c.type==='abort'){send({id:c.id,type:'response',command:'abort',success:true});send({type:'agent_settled'});}",
				"}});",
			].join(""),
		);
		const transport = new RpcTransport({
			getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
			defaultTimeoutMs: 1_000,
			abortGraceMs: 20,
			timeoutFinalizationMs: 100,
			createClient: (options) =>
				new RpcProtocolClient({
					...options,
					terminationGraceMs: 10,
					invocation: { command: process.execPath, args: [script] },
				}),
		});
		const result = await transport.runTurn(
			{ ...managedAgent(), cwd: root, currentTimeoutMs: 30 },
			"review",
			new AbortController().signal,
		);
		assert.equal(result.exitCode, 124);
		assert.match(result.error ?? "", /timed out/);
		assert.equal(result.output, "SUMMARY_RPC");
		assert.equal(result.termination?.reason, "work_timeout");
		assert.equal(result.termination?.finalization.status, "completed");
		assert.match(
			result.termination?.checkpoint.completedTools[0]?.output ?? "",
			/RPC_TOOL_EVIDENCE/,
		);
		assert.equal(result.termination?.checkpoint.completedTools.length, 1);
		assert.equal(result.telemetry?.phase, "failed");
		assert.deepEqual(result.telemetry?.usage, {
			input: 7,
			output: 3,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 10,
			cost: 0.75,
			turns: 1,
		});
		assert.equal(readFileSync(marker, "utf8"), "prompt\nprompt\n");
		await transport.shutdown();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("RpcTransport enforces idle and tool-call budgets with bounded summaries", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-budgets-"));
	try {
		const script = path.join(root, "budgets.mjs");
		writeFileSync(
			script,
			[
				"let buffer='';const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');let prompts=0;",
				"process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const c=JSON.parse(line);",
				"if(c.type==='get_state')send({id:c.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'model'},thinkingLevel:'low',sessionId:'s'}});",
				"if(c.type==='prompt'){prompts++;const response={id:c.id,type:'response',command:'prompt',success:true};if(prompts===1&&!c.message.includes('IDLE')){const budget={type:'message_end',message:{role:'assistant',content:[{type:'toolCall',id:'1',name:'read',arguments:{}},{type:'toolCall',id:'2',name:'read',arguments:{}}],provider:'fake',model:'model',usage:{},stopReason:'toolUse'}};process.stdout.write(JSON.stringify(response)+'\\n'+JSON.stringify(budget)+'\\n');}else{send(response);}if(prompts>1){send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'BUDGET_SUMMARY'}],provider:'fake',model:'model',usage:{},stopReason:'stop'}});send({type:'agent_settled'});}}",
				"if(c.type==='abort'){send({id:c.id,type:'response',command:'abort',success:true});send({type:'agent_settled'});}",
				"}});",
			].join(""),
		);
		const makeTransport = () =>
			new RpcTransport({
				getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
				defaultTimeoutMs: 1_000,
				abortGraceMs: 20,
				timeoutFinalizationMs: 100,
				createClient: (options) =>
					new RpcProtocolClient({
						...options,
						terminationGraceMs: 10,
						invocation: { command: process.execPath, args: [script] },
					}),
			});

		const toolTransport = makeTransport();
		const toolLimited = await toolTransport.runTurn(
			{ ...managedAgent(), cwd: root, currentMaxToolCalls: 1 },
			"TOOLS",
			new AbortController().signal,
		);
		assert.equal(toolLimited.termination?.reason, "tool_call_limit");
		assert.equal(toolLimited.termination?.finalization.status, "completed");
		assert.equal(toolLimited.output, "BUDGET_SUMMARY");
		await toolTransport.shutdown();

		const idleTransport = makeTransport();
		const idle = await idleTransport.runTurn(
			{ ...managedAgent(), id: "sa_idle", cwd: root, currentIdleTimeoutMs: 25 },
			"IDLE",
			new AbortController().signal,
		);
		assert.equal(idle.termination?.reason, "idle_timeout");
		assert.equal(idle.termination?.finalization.status, "completed");
		assert.equal(idle.output, "BUDGET_SUMMARY");
		await idleTransport.shutdown();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("RPC prompt acceptance timeout discards the child without replay", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rpc-accept-timeout-"));
	try {
		const script = path.join(root, "accept-timeout.mjs");
		const marker = path.join(root, "prompts.log");
		writeFileSync(
			script,
			[
				'import { appendFileSync } from "node:fs";',
				"let buffer='';const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');",
				"process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const c=JSON.parse(line);",
				"if(c.type==='get_state')send({id:c.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'model'},thinkingLevel:'low',sessionId:'s'}});",
				`if(c.type==='prompt')appendFileSync(${JSON.stringify(marker)},'prompt\\n');`,
				"if(c.type==='abort')send({id:c.id,type:'response',command:'abort',success:true});",
				"}});",
			].join(""),
		);
		const transport = new RpcTransport({
			getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
			defaultTimeoutMs: 20,
			abortGraceMs: 10,
			createClient: (options) =>
				new RpcProtocolClient({
					...options,
					terminationGraceMs: 10,
					invocation: { command: process.execPath, args: [script] },
				}),
		});
		const result = await transport.runTurn(
			{ ...managedAgent(), cwd: root },
			"ambiguous",
			new AbortController().signal,
		);
		assert.equal(result.exitCode, 124);
		assert.match(result.error ?? "", /timed out/);
		assert.equal(result.termination?.reason, "work_timeout");
		assert.equal(readFileSync(marker, "utf8"), "prompt\n");
		await transport.shutdown();

		const idleTransport = new RpcTransport({
			getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
			defaultTimeoutMs: 100,
			abortGraceMs: 10,
			createClient: (options) =>
				new RpcProtocolClient({
					...options,
					terminationGraceMs: 10,
					invocation: { command: process.execPath, args: [script] },
				}),
		});
		const idleBeforeAcceptance = await idleTransport.runTurn(
			{ ...managedAgent(), id: "sa_idle_accept", cwd: root, currentIdleTimeoutMs: 5 },
			"idle before acceptance",
			new AbortController().signal,
		);
		assert.equal(idleBeforeAcceptance.exitCode, 124);
		assert.equal(idleBeforeAcceptance.termination?.reason, "idle_timeout");
		await idleTransport.shutdown();

		const crashScript = path.join(root, "crash-after-accept.mjs");
		const crashMarker = path.join(root, "crash-prompts.log");
		writeFileSync(
			crashScript,
			[
				'import { appendFileSync } from "node:fs";',
				"let buffer='';const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');",
				"process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const c=JSON.parse(line);",
				"if(c.type==='get_state')send({id:c.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'model'},thinkingLevel:'low',sessionId:'s'}});",
				`if(c.type==='prompt'){appendFileSync(${JSON.stringify(crashMarker)},'prompt\\n');send({id:c.id,type:'response',command:'prompt',success:true});send({type:'message_start',message:{role:'assistant',content:[]}});send({type:'message_update',usage:{input:8,output:1,cacheRead:0,cacheWrite:0,totalTokens:9,cost:{total:0.5}},assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'PARTIAL_CRASH'}});setImmediate(()=>process.exit(7));}`,
				"}});",
			].join(""),
		);
		const crashTransport = new RpcTransport({
			getParentRuntime: () => ({ model: undefined, thinkingLevel: "low" }),
			defaultTimeoutMs: 100,
			abortGraceMs: 10,
			createClient: (options) =>
				new RpcProtocolClient({
					...options,
					terminationGraceMs: 10,
					invocation: { command: process.execPath, args: [crashScript] },
				}),
		});
		const crashed = await crashTransport.runTurn(
			{ ...managedAgent(), cwd: root },
			"accepted then crash",
			new AbortController().signal,
		);
		assert.equal(crashed.exitCode, 1);
		assert.equal(crashed.output, "PARTIAL_CRASH");
		assert.match(crashed.error ?? "", /exited/);
		assert.deepEqual(crashed.telemetry?.usage, {
			input: 8,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 9,
			cost: 0.5,
			turns: 0,
		});
		assert.equal(readFileSync(crashMarker, "utf8"), "prompt\n");
		await crashTransport.shutdown();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
