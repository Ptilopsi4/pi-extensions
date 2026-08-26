import assert from "node:assert/strict";
import { test } from "vitest";
import { CdpClient, type CdpWebSocketConstructor } from "../src/cdp-client.js";

class FakeWebSocket extends EventTarget {
	closeCalls = 0;
	readonly sent: string[] = [];

	constructor(readonly url: string | URL) {
		super();
	}

	close(): void {
		this.closeCalls += 1;
	}

	fail(): void {
		this.dispatchEvent(new Event("error"));
	}

	message(payload: unknown): void {
		this.dispatchEvent(
			new MessageEvent("message", {
				data: typeof payload === "string" ? payload : JSON.stringify(payload),
			}),
		);
	}

	open(): void {
		this.dispatchEvent(new Event("open"));
	}

	respond(result: unknown = {}, error?: { code: number; message: string }): void {
		const request = JSON.parse(this.sent.at(-1) ?? "null") as { id?: unknown };
		assert.equal(typeof request.id, "number");
		this.message({ id: request.id, ...(error ? { error } : { result }) });
	}

	send(payload: string): void {
		this.sent.push(payload);
	}
}

function socketFactory() {
	const sockets: FakeWebSocket[] = [];
	class RecordingWebSocket extends FakeWebSocket {
		constructor(url: string | URL) {
			super(url);
			sockets.push(this);
		}
	}
	return {
		sockets,
		webSocketConstructor: RecordingWebSocket as unknown as CdpWebSocketConstructor,
	};
}

async function connectClient(timeoutMs = 100) {
	const transport = socketFactory();
	const connected = CdpClient.connect("ws://127.0.0.1/devtools/page/test", {
		timeoutMs,
		webSocketConstructor: transport.webSocketConstructor,
	});
	const socket = transport.sockets[0];
	assert.ok(socket);
	socket.open();
	return { client: await connected, socket };
}

test("reports connection errors and connection timeouts while closing the socket", async () => {
	const failedTransport = socketFactory();
	const failed = CdpClient.connect("ws://127.0.0.1/devtools/page/fail", {
		timeoutMs: 100,
		webSocketConstructor: failedTransport.webSocketConstructor,
	});
	const failedSocket = failedTransport.sockets[0];
	assert.ok(failedSocket);
	failedSocket.fail();
	await assert.rejects(failed, /Failed to connect/u);
	assert.equal(failedSocket.closeCalls, 1);

	const timeoutTransport = socketFactory();
	const timedOut = CdpClient.connect("ws://127.0.0.1/devtools/page/timeout", {
		timeoutMs: 5,
		webSocketConstructor: timeoutTransport.webSocketConstructor,
	});
	await assert.rejects(timedOut, /Timed out connecting/u);
	assert.equal(timeoutTransport.sockets[0]?.closeCalls, 1);
});

test("correlates command errors and keeps command cancellation operation-scoped", async () => {
	const { client, socket } = await connectClient();
	const failed = client.send("Page.enable", {}, { timeoutMs: 100 });
	socket.respond(undefined, { code: -32_601, message: "Method unavailable" });
	await assert.rejects(failed, /CDP error -32601: Method unavailable/u);

	const controller = new AbortController();
	const aborted = client.send(
		"Runtime.evaluate",
		{},
		{
			signal: controller.signal,
			timeoutMs: 100,
		},
	);
	controller.abort(new Error("cancel command"));
	await assert.rejects(aborted, /cancel command/u);

	const succeeded = client.send("Page.getFrameTree", {}, { timeoutMs: 100 });
	socket.respond({ frameTree: { frame: { id: "root", url: "about:blank" } } });
	assert.deepEqual(await succeeded, {
		frameTree: { frame: { id: "root", url: "about:blank" } },
	});
	client.close();
});

test("buffers an event that arrives before its command response", async () => {
	const { client, socket } = await connectClient();
	const enabled = client.send("WebMCP.enable", {}, { timeoutMs: 100 });
	socket.message({
		method: "WebMCP.toolsAdded",
		params: { tools: [{ frameId: "root", name: "search", description: "Search" }] },
	});
	socket.respond({});
	await enabled;

	const event = await client.waitForEvent(
		"WebMCP.toolsAdded",
		(value): value is { tools: unknown[] } =>
			typeof value === "object" &&
			value !== null &&
			Array.isArray((value as { tools?: unknown }).tools),
		{ timeoutMs: 100 },
	);
	assert.equal(event.tools.length, 1);

	const responseFirstEvent = client.waitForEvent(
		"WebMCP.toolsAdded",
		(value): value is { tools: unknown[] } =>
			typeof value === "object" &&
			value !== null &&
			Array.isArray((value as { tools?: unknown }).tools),
		{ timeoutMs: 100 },
	);
	const responseFirstCommand = client.send("WebMCP.enable", {}, { timeoutMs: 100 });
	socket.respond({});
	await responseFirstCommand;
	socket.message({ method: "WebMCP.toolsAdded", params: { tools: [] } });
	assert.deepEqual((await responseFirstEvent).tools, []);
	client.close();
});

test("times out and aborts bounded event listeners without affecting later events", async () => {
	const { client, socket } = await connectClient();
	await assert.rejects(
		client.waitForEvent("WebMCP.toolsAdded", (_value): _value is unknown => true, {
			timeoutMs: 5,
		}),
		/Timed out waiting for CDP event/u,
	);

	const controller = new AbortController();
	const aborted = client.waitForEvent("WebMCP.toolResponded", (_value): _value is unknown => true, {
		signal: controller.signal,
		timeoutMs: 100,
	});
	controller.abort(new Error("cancel event wait"));
	await assert.rejects(aborted, /cancel event wait/u);

	const next = client.waitForEvent(
		"WebMCP.toolResponded",
		(value): value is { invocationId: string } =>
			typeof value === "object" &&
			value !== null &&
			(value as { invocationId?: unknown }).invocationId === "next",
		{ timeoutMs: 100 },
	);
	socket.message({ method: "WebMCP.toolResponded", params: { invocationId: "next" } });
	assert.equal((await next).invocationId, "next");
	client.close();
});

test("malformed messages and target detachment reject pending work", async () => {
	const malformed = await connectClient();
	const pendingMalformed = malformed.client.send("Page.enable", {}, { timeoutMs: 100 });
	malformed.socket.message("{not json");
	await assert.rejects(pendingMalformed, /malformed JSON/u);
	assert.throws(() => malformed.client.send("Page.enable"), /WebSocket is closed/u);

	const detached = await connectClient();
	const pendingDetached = detached.client.send("Page.enable", {}, { timeoutMs: 100 });
	detached.socket.message({
		method: "Inspector.detached",
		params: { reason: "target_closed" },
	});
	await assert.rejects(pendingDetached, /target detached.*target_closed/u);
});

test("close is idempotent and rejects every pending command and event", async () => {
	const { client, socket } = await connectClient();
	const command = client.send("Page.enable", {}, { timeoutMs: 100 });
	const event = client.waitForEvent("WebMCP.toolsAdded", (_value): _value is unknown => true, {
		timeoutMs: 100,
	});
	client.close(new Error("test close"));
	client.close(new Error("second close"));

	await assert.rejects(command, /test close/u);
	await assert.rejects(event, /test close/u);
	assert.equal(socket.closeCalls, 1);
});
