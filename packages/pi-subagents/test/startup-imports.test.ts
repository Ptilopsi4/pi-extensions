import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";

const packageRoot = path.resolve("packages/pi-subagents");
const importAgentDir = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-import-agent-"));
const importPreviousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = importAgentDir;
const boundedFactory = (
	(await import(
		`${pathToFileURL(path.join(packageRoot, "src/index.ts")).href}?startup=${crypto.randomUUID()}`
	)) as { default: (pi: never) => void }
).default;
if (importPreviousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = importPreviousAgentDir;
await rm(importAgentDir, { recursive: true, force: true });

test("source startup reaches only the bounded runtime graph", async () => {
	const builder = (await import(
		`${pathToFileURL(path.join(packageRoot, "scripts/build-runtime.mjs")).href}?audit=${crypto.randomUUID()}`
	)) as {
		buildRuntime(options: { outputDirectory: string }): Promise<{
			outputs?: Record<string, { inputs?: Record<string, unknown> }>;
		}>;
		validateEagerGraph(metadata: unknown): { eagerInputs: Set<string> };
	};
	const root = await mkdtemp(path.join(packageRoot, ".pi-subagents-build-test-"));
	try {
		const metadata = await builder.buildRuntime({ outputDirectory: path.join(root, "dist") });
		const inputs = [...builder.validateEagerGraph(metadata).eagerInputs].join("\n");
		assert.match(inputs, /src\/bounded-subagents\.ts/u);
		assert.doesNotMatch(
			inputs,
			/registry|persistence|mailbox|peer-|semantic|stateful|settings|workspace|usage-recording|auto-transport|rpc-transport|subprocess-transport/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("bounded extension never reads or mutates legacy settings and retained state", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-legacy-nonmutation-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	const legacy = path.join(root, "pi-subagents.json");
	const state = path.join(root, "pi-subagents-state");
	await writeFile(legacy, "{ malformed sentinel settings \u202e", "utf8");
	await mkdir(state);
	await writeFile(path.join(state, "sentinel.bin"), Buffer.from([0, 1, 2, 3, 255]));
	const before = await snapshot(root);
	process.env.PI_CODING_AGENT_DIR = root;
	try {
		const mock = createMockPi();
		boundedFactory(mock.pi);
		const context = createMockContext();
		await emit(mock, "session_start", { reason: "startup" }, context.ctx);
		await emit(mock, "session_shutdown", { reason: "quit" }, context.ctx);
		assert.deepEqual(await snapshot(root), before);

		await writeFile(
			legacy,
			JSON.stringify({ stateful: { enabled: true }, unknown: "sentinel" }),
			"utf8",
		);
		const validBefore = await snapshot(root);
		const validMock = createMockPi();
		boundedFactory(validMock.pi);
		const validContext = createMockContext();
		await emit(validMock, "session_start", { reason: "startup" }, validContext.ctx);
		await emit(validMock, "session_shutdown", { reason: "quit" }, validContext.ctx);
		assert.deepEqual(await snapshot(root), validBefore);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}

	const absentRoot = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-legacy-absent-"));
	const absentAgentDir = path.join(absentRoot, "not-created");
	const old = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = absentAgentDir;
	try {
		const mock = createMockPi();
		boundedFactory(mock.pi);
		await assert.rejects(readFile(absentAgentDir), /ENOENT/u);
	} finally {
		if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = old;
		await rm(absentRoot, { recursive: true, force: true });
	}
});

async function emit(
	mock: ReturnType<typeof createMockPi>,
	event: string,
	payload: unknown,
	ctx: ExtensionContext,
) {
	for (const handler of mock.events.get(event) ?? []) await handler(payload, ctx);
}

async function snapshot(directory: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
		const relative = path.join(prefix, entry.name);
		if (entry.isDirectory()) Object.assign(result, await snapshot(directory, relative));
		else result[relative] = (await readFile(path.join(directory, relative))).toString("base64");
	}
	return result;
}
