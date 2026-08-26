import assert from "node:assert/strict";
import net from "node:net";
import { afterEach, test } from "vitest";
import { createBrokerClient } from "../src/child-communication-bridge.js";
import {
	type BrokerQuestion,
	MAX_FRAME_BYTES,
	MAX_MESSAGE_BYTES,
	MessageBroker,
} from "../src/message-broker.js";
import type { BrokerCredentials } from "../src/types.js";

const brokers: MessageBroker[] = [];

afterEach(async () => {
	await Promise.all(brokers.splice(0).map((broker) => broker.shutdown()));
});

test("authenticates one job and preserves the first reply", async () => {
	const questions: BrokerQuestion[] = [];
	const { broker, credentials } = await setup((question) => questions.push(question));
	const client = createBrokerClient(credentials);
	const requestId = await client.ask("Which option?", undefined);
	assert.equal(questions[0]?.requestId, requestId);
	assert.equal(questions[0]?.jobId, "job_1");
	assert.deepEqual(broker.reply(requestId, "Option A"), {
		requestId,
		accepted: true,
		duplicate: false,
	});
	assert.deepEqual(broker.reply(requestId, "Option B"), {
		requestId,
		accepted: false,
		duplicate: true,
	});
	assert.equal(await client.wait(requestId, undefined, undefined), "Option A");
	assert.equal(await client.wait(requestId, undefined, undefined), "Option A");
});

test("wait timeout and cancellation stop only that long poll", async () => {
	const { broker, credentials } = await setup(() => undefined);
	const client = createBrokerClient(credentials);
	const requestId = await client.ask("Need a reply", undefined);
	await assert.rejects(() => client.wait(requestId, 1, undefined), /wait timed out/i);
	const controller = new AbortController();
	const cancelled = client.wait(requestId, undefined, controller.signal);
	controller.abort();
	await assert.rejects(cancelled, (error: Error) => error.name === "AbortError");
	await new Promise((resolve) => setTimeout(resolve, 5));
	const retry = client.wait(requestId, undefined, undefined);
	broker.reply(requestId, "Still active");
	assert.equal(await retry, "Still active");
});

test("enforces four outstanding requests and bounded consumed replay", async () => {
	const { broker, credentials } = await setup(() => undefined);
	const client = createBrokerClient(credentials);
	const requestIds: string[] = [];
	for (let index = 0; index < 4; index++) {
		requestIds.push(await client.ask(`Question ${index}`, undefined));
	}
	await assert.rejects(() => client.ask("Fifth", undefined), /at most 4 outstanding/i);
	for (const [index, requestId] of requestIds.entries()) {
		broker.reply(requestId, `Reply ${index}`);
		assert.equal(await client.wait(requestId, undefined, undefined), `Reply ${index}`);
	}
	const newer: string[] = [];
	for (let index = 0; index < 5; index++) {
		const requestId = await client.ask(`New ${index}`, undefined);
		newer.push(requestId);
		broker.reply(requestId, `New reply ${index}`);
		await client.wait(requestId, undefined, undefined);
	}
	await assert.rejects(
		() => client.wait(requestIds[0] ?? "missing", undefined, undefined),
		/unknown or expired/i,
	);
	assert.equal(await client.wait(newer.at(-1) ?? "missing", undefined, undefined), "New reply 4");
});

test("rejects cross-job request IDs, concurrent waits, and revoked tokens", async () => {
	const { broker, credentials } = await setup(() => undefined);
	const secondCredentials = broker.issueCredentials({ jobId: "job_2", generation: 1 });
	const first = createBrokerClient(credentials);
	const second = createBrokerClient(secondCredentials);
	const requestId = await first.ask("Private to job one", undefined);
	await assert.rejects(() => second.wait(requestId, 1, undefined), /unknown or expired/i);
	const controller = new AbortController();
	const active = first.wait(requestId, undefined, controller.signal);
	await new Promise((resolve) => setTimeout(resolve, 5));
	await assert.rejects(() => first.wait(requestId, 1, undefined), /wait is already active/i);
	controller.abort();
	await assert.rejects(active, (error: Error) => error.name === "AbortError");
	broker.revokeJob("job_1");
	await assert.rejects(() => first.ask("stale", undefined), /unauthenticated/i);
});

test("rolls back a question when main-agent delivery fails", async () => {
	const { broker, credentials } = await setup(() => {
		throw new Error("delivery unavailable");
	});
	const client = createBrokerClient(credentials);
	await assert.rejects(() => client.ask("Question", undefined), /delivery unavailable/i);
	assert.equal(broker.hasPendingQuestion(), false);
});

test("revocation and repeated shutdown settle pending waits once", async () => {
	const { broker, credentials } = await setup(() => undefined);
	const client = createBrokerClient(credentials);
	const requestId = await client.ask("Pending", undefined);
	const pending = client.wait(requestId, undefined, undefined);
	await new Promise((resolve) => setTimeout(resolve, 5));
	broker.revokeJob("job_1");
	await assert.rejects(pending, /no longer active/i);
	assert.throws(() => broker.reply(requestId, "stale"), /unknown or expired/i);
	await broker.shutdown();
	await broker.shutdown();
});

test("rejects incomplete frames at the request deadline", async () => {
	const broker = new MessageBroker({
		onQuestion: () => undefined,
		requestFrameTimeoutMs: 5,
	});
	brokers.push(broker);
	await broker.start();
	const credentials = broker.issueCredentials({ jobId: "job_1", generation: 1 });
	assert.match(String((await raw(credentials, "{")).error), /frame timed out/i);
});

test("rejects malformed, unauthenticated, and oversized frames", async () => {
	const { credentials } = await setup(() => undefined);
	assert.match(String((await raw(credentials, "not-json\n")).error), /malformed/i);
	assert.match(
		String(
			(
				await raw(
					credentials,
					`${JSON.stringify({ type: "ask", token: "0".repeat(64), message: "x" })}\n`,
				)
			).error,
		),
		/unauthenticated/i,
	);
	assert.match(
		String((await raw(credentials, `${"x".repeat(MAX_FRAME_BYTES + 1)}\n`)).error),
		/size limit/i,
	);
});

test("bounds question bytes and reply lines", async () => {
	const { broker, credentials } = await setup(() => undefined);
	const client = createBrokerClient(credentials);
	await assert.rejects(
		() => client.ask("x".repeat(MAX_MESSAGE_BYTES + 1), undefined),
		/50 KiB|51200/i,
	);
	const requestId = await client.ask("bounded", undefined);
	assert.throws(() => broker.reply(requestId, "x\n".repeat(2_000)), /at most 2000 lines/i);
});

async function setup(onQuestion: (question: BrokerQuestion) => void) {
	const broker = new MessageBroker({ onQuestion });
	brokers.push(broker);
	await broker.start();
	const credentials = broker.issueCredentials({ jobId: "job_1", generation: 1 });
	return { broker, credentials };
}

function raw(credentials: BrokerCredentials, content: string): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host: credentials.host, port: credentials.port });
		let response = Buffer.alloc(0);
		socket.once("connect", () => socket.write(content));
		socket.on("data", (chunk: Buffer) => {
			response = Buffer.concat([response, chunk]);
		});
		socket.once("error", reject);
		socket.once("close", () => {
			try {
				resolve(JSON.parse(response.toString("utf8")) as Record<string, unknown>);
			} catch (error) {
				reject(error);
			}
		});
	});
}
