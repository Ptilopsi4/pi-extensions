import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { createMockPi } from "../../../test/support.js";
import {
	type CapturedBrokerEnvironment,
	captureBrokerEnvironment,
} from "../src/child-communication-bridge.js";
import {
	type ChildCommunicationClient,
	createChildCommunicationExtension,
} from "../src/child-communication-tools.js";
import { BROKER_ENV } from "../src/message-broker.js";

interface RegisteredTool {
	name: string;
	parameters: { properties?: Record<string, { maxLength?: number; description?: string }> };
	prepareArguments?: (args: unknown) => unknown;
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
}

afterEach(() => {
	delete process.env[BROKER_ENV.host];
	delete process.env[BROKER_ENV.port];
	delete process.env[BROKER_ENV.token];
});

test("registers fixed ask and wait schemas and returns plain-text results", async () => {
	const calls: Array<Record<string, unknown>> = [];
	const client: ChildCommunicationClient = {
		async ask(message, signal) {
			calls.push({ type: "ask", message, signal });
			return "req_1";
		},
		async wait(requestId, timeoutMs, signal) {
			calls.push({ type: "wait", requestId, timeoutMs, signal });
			return "plain\u001b[31m response";
		},
	};
	const mock = createMockPi();
	createChildCommunicationExtension(client)(mock.pi);
	const tools = mock.tools as unknown as RegisteredTool[];
	assert.deepEqual(
		tools.map((tool) => tool.name),
		["subagent-ask", "subagent-wait"],
	);
	assert.equal(tools[0]?.parameters.properties?.message?.maxLength, 50 * 1024);
	assert.equal(
		tools[1]?.parameters.properties?.timeout?.description,
		"Timeout in seconds (optional, no default timeout)",
	);
	assert.deepEqual(tools[1]?.prepareArguments?.({ requestId: "req_1", timeoutMs: 1_500 }), {
		requestId: "req_1",
		timeout: 1.5,
	});
	const asked = await tools[0]?.execute("ask", { message: "Question" });
	assert.deepEqual(asked, {
		content: [{ type: "text", text: "req_1" }],
		details: { requestId: "req_1" },
	});
	const waited = await tools[1]?.execute("wait", { requestId: "req_1", timeout: 1.25 });
	assert.deepEqual(waited, {
		content: [{ type: "text", text: "plain[31m response" }],
		details: { requestId: "req_1" },
	});
	assert.equal(calls[1]?.timeoutMs, 1_250);
});

test("child tool failures throw and preserve AbortError", async () => {
	const client: ChildCommunicationClient = {
		async ask() {
			throw new Error("broker rejected");
		},
		async wait() {
			const error = new Error("cancelled");
			error.name = "AbortError";
			throw error;
		},
	};
	const mock = createMockPi();
	createChildCommunicationExtension(client)(mock.pi);
	const tools = mock.tools as unknown as RegisteredTool[];
	await assert.rejects(() => tools[0]?.execute("ask", { message: "Question" }), /broker rejected/);
	await assert.rejects(
		() => tools[1]?.execute("wait", { requestId: "req_1" }),
		(error: Error) => error.name === "AbortError",
	);
});

test("captures and deletes valid broker environment", () => {
	const expected: CapturedBrokerEnvironment = {
		host: "127.0.0.1",
		port: 31_337,
		token: "a".repeat(64),
	};
	process.env[BROKER_ENV.host] = expected.host;
	process.env[BROKER_ENV.port] = String(expected.port);
	process.env[BROKER_ENV.token] = expected.token;
	assert.deepEqual(captureBrokerEnvironment(), expected);
	assert.equal(process.env[BROKER_ENV.host], undefined);
	assert.equal(process.env[BROKER_ENV.port], undefined);
	assert.equal(process.env[BROKER_ENV.token], undefined);
});

test("rejects partial broker environment after deleting it", () => {
	process.env[BROKER_ENV.host] = "127.0.0.1";
	assert.throws(() => captureBrokerEnvironment(), /invalid.*broker environment/i);
	assert.equal(process.env[BROKER_ENV.host], undefined);
});
