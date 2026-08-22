import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { SourceMap } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

const packageRoot = resolve("packages/pi-subagents");
const builderUrl = pathToFileURL(join(packageRoot, "scripts/build-runtime.mjs")).href;

type BuildMetadata = {
	outputs?: Record<
		string,
		{
			entryPoint?: string;
			imports?: Array<{ external?: boolean; kind?: string; path: string }>;
			inputs?: Record<string, unknown>;
		}
	>;
};

type RuntimeBuilder = {
	buildRuntime(options?: {
		outputDirectory?: string;
		validateOutput?: (outputDirectory: string) => Promise<void>;
	}): Promise<BuildMetadata>;
	validateEagerGraph(metadata: BuildMetadata): {
		eagerInputs: Set<string>;
		eagerOutputs: Set<string>;
	};
	validateGeneratedFiles(outputDirectory: string): Promise<void>;
	publishRuntime(
		stagingDirectory: string,
		outputDirectory: string,
		operations?: { renamePath?: typeof rename },
	): Promise<void>;
};

async function loadBuilder(): Promise<RuntimeBuilder> {
	return (await import(`${builderUrl}?test=${crypto.randomUUID()}`)) as RuntimeBuilder;
}

function validMetadata(): BuildMetadata {
	return {
		outputs: {
			"dist/index.ts": {
				entryPoint: "src/index.ts",
				imports: [
					{ path: "dist/chunks/eager.ts", kind: "import-statement" },
					{ path: "dist/chunks/config-ui.ts", kind: "dynamic-import" },
					{
						path: "@earendil-works/pi-coding-agent",
						kind: "import-statement",
						external: true,
					},
				],
				inputs: { "src/index.ts": {}, "src/subagents-extension.ts": {} },
			},
			"dist/chunks/eager.ts": {
				imports: [],
				inputs: { "src/stateful-registration.ts": {}, "src/settings-reader.ts": {} },
			},
			"dist/chunks/config-ui.ts": {
				entryPoint: "src/config-ui.ts",
				imports: [{ path: "@narumitw/pi-tui-kit", kind: "import-statement", external: true }],
				inputs: { "src/config-ui.ts": {} },
			},
		},
	};
}

test("eager graph validation keeps known first-use implementations behind dynamic chunks", async () => {
	const builder = await loadBuilder();
	assert.doesNotThrow(() => builder.validateEagerGraph(validMetadata()));
});

test("eager graph validation rejects every known first-use implementation", async () => {
	const builder = await loadBuilder();
	for (const forbidden of [
		"src/auto-transport.ts",
		"src/capability-grant.ts",
		"src/completion-delivery.ts",
		"src/config-status.ts",
		"src/config-ui.ts",
		"src/consult.ts",
		"src/create-stateful-transport.ts",
		"src/cwd-policy.ts",
		"src/execution.ts",
		"src/execution/runtime-policy.ts",
		"src/in-process-transport.ts",
		"src/inspect.ts",
		"src/peer-communication.ts",
		"src/persistence.ts",
		"src/registry.ts",
		"src/retained-semantic-state.ts",
		"src/rpc-transport.ts",
		"src/semantic-snapshot.ts",
		"src/subprocess-transport.ts",
		"src/workspace.ts",
	]) {
		const metadata = validMetadata();
		const eagerOutput = requireOutput(metadata, "dist/chunks/eager.ts");
		const eagerInputs = eagerOutput.inputs ?? {};
		eagerOutput.inputs = eagerInputs;
		eagerInputs[forbidden] = {};
		assert.throws(
			() => builder.validateEagerGraph(metadata),
			new RegExp(`First-use implementation is eager: ${forbidden.replaceAll("/", "\\/")}`, "u"),
		);
	}
});

test("eager graph validation rejects eager Pi TUI Kit and bundled packages", async () => {
	const builder = await loadBuilder();
	const eagerDependency = validMetadata();
	const eagerOutput = requireOutput(eagerDependency, "dist/chunks/eager.ts");
	const eagerImports = eagerOutput.imports ?? [];
	eagerOutput.imports = eagerImports;
	eagerImports.push({
		path: "@narumitw/pi-tui-kit",
		kind: "import-statement",
		external: true,
	});
	assert.throws(
		() => builder.validateEagerGraph(eagerDependency),
		/Eager external dependency: @narumitw\/pi-tui-kit/u,
	);

	const eagerSubpath = validMetadata();
	const eagerSubpathOutput = requireOutput(eagerSubpath, "dist/chunks/eager.ts");
	const eagerSubpathImports = eagerSubpathOutput.imports ?? [];
	eagerSubpathOutput.imports = eagerSubpathImports;
	eagerSubpathImports.push({
		path: "@narumitw/pi-tui-kit/terminal-text",
		kind: "import-statement",
		external: true,
	});
	assert.throws(
		() => builder.validateEagerGraph(eagerSubpath),
		/Eager external dependency: @narumitw\/pi-tui-kit\/terminal-text/u,
	);

	const bundledDependency = validMetadata();
	const configUiOutput = requireOutput(bundledDependency, "dist/chunks/config-ui.ts");
	const configUiInputs = configUiOutput.inputs ?? {};
	configUiOutput.inputs = configUiInputs;
	configUiInputs["node_modules/example/index.js"] = {};
	assert.throws(
		() => builder.validateEagerGraph(bundledDependency),
		/Bundled package input: .*node_modules\/example/u,
	);
});

test("runtime build rejects destructive output paths", async () => {
	const builder = await loadBuilder();
	const outside = await mkdtemp(join(tmpdir(), "pi-subagents-build-outside-"));
	const linkedParent = join(packageRoot, `.pi-subagents-build-test-link-${crypto.randomUUID()}`);
	try {
		await assert.rejects(
			builder.buildRuntime({ outputDirectory: packageRoot }),
			/Runtime output directory must be inside the package root/u,
		);
		await assert.rejects(
			builder.buildRuntime({ outputDirectory: join(outside, "dist") }),
			/Runtime output directory must be inside the package root/u,
		);
		await symlink(outside, linkedParent, "dir");
		await assert.rejects(
			builder.buildRuntime({ outputDirectory: join(linkedParent, "dist") }),
			/Runtime output parent must not escape the package root through a symlink/u,
		);
	} finally {
		await rm(linkedParent, { force: true, recursive: true });
		await rm(outside, { force: true, recursive: true });
	}
});

test("runtime builds are deterministic, mapped, external, and remove stale chunks", async () => {
	const builder = await loadBuilder();
	const root = await mkdtemp(join(packageRoot, ".pi-subagents-build-test-"));
	try {
		const first = join(root, "first");
		const second = join(root, "second");
		const firstMetadata = await builder.buildRuntime({ outputDirectory: first });
		await mkdir(join(second, "chunks"), { recursive: true });
		await writeFile(join(second, "chunks", "stale.ts"), "stale", "utf8");
		const secondMetadata = await builder.buildRuntime({ outputDirectory: second });

		assert.deepEqual(await snapshotDirectory(first), await snapshotDirectory(second));
		assert.equal((await listFiles(second)).includes("chunks/stale.ts"), false);
		assert.doesNotThrow(() => builder.validateEagerGraph(firstMetadata));
		assert.doesNotThrow(() => builder.validateEagerGraph(secondMetadata));

		const files = await listFiles(first);
		assert.ok(files.includes("index.ts"));
		assert.ok(files.includes("index.ts.map"));
		assert.ok(files.includes("chunks/child-peer-bridge.ts"));
		assert.ok(files.includes("chunks/child-peer-bridge.ts.map"));
		assert.ok(files.some((path) => path.startsWith("chunks/") && path.endsWith(".ts")));
		const bridgeOutput = Object.entries(firstMetadata.outputs ?? {}).find(
			([, output]) => output.entryPoint === "src/child-peer-bridge.ts",
		);
		assert.ok(bridgeOutput, "missing child peer bridge entrypoint");
		assert.match(bridgeOutput[0], /\/chunks\/child-peer-bridge\.ts$/u);
		let bridgeReferences = 0;
		for (const runtimePath of files.filter((path) => path.endsWith(".ts"))) {
			const source = await readFile(join(first, runtimePath), "utf8");
			assert.match(source, /^\/\/ @generated by scripts\/build-runtime\.mjs/u);
			assert.doesNotMatch(source, /["']\.\.?\/[^"']+\.js["']/u);
			assert.doesNotMatch(source, /["']\.\.?\/[^"']*src\//u);
			assert.ok(files.includes(`${runtimePath}.map`), `missing source map for ${runtimePath}`);
			if (/new URL\((["'])\.\/child-peer-bridge\.ts\1,\s*import\.meta\.url\)/u.test(source)) {
				bridgeReferences += 1;
				const bridgePath = join(dirname(runtimePath), "child-peer-bridge.ts").replaceAll("\\", "/");
				assert.ok(files.includes(bridgePath), `missing generated bridge for ${runtimePath}`);
			}
		}
		assert.equal(bridgeReferences, 1);

		for (const output of Object.values(firstMetadata.outputs ?? {})) {
			for (const input of Object.keys(output.inputs ?? {})) {
				assert.equal(input.includes("node_modules/"), false, `bundled package input: ${input}`);
			}
		}

		const entrySource = await readFile(join(first, "index.ts"), "utf8");
		assert.match(entrySource, /["']\.\/chunks\/[^"']+\.ts["']/u);
		const generatedLine = entrySource
			.split("\n")
			.findIndex((line) => line.includes('pi.registerCommand("subagents"'));
		assert.notEqual(generatedLine, -1);
		const sourceMap = new SourceMap(
			JSON.parse(await readFile(join(first, "index.ts.map"), "utf8")),
		);
		const mapped = sourceMap.findEntry(generatedLine, 0);
		assert.ok("originalSource" in mapped, "expected generated entry to map to source");
		assert.match(mapped.originalSource ?? "", /src\/config-registration\.ts$/u);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("generated output validation rejects a missing child peer bridge", async () => {
	const builder = await loadBuilder();
	const root = await mkdtemp(join(packageRoot, ".pi-subagents-build-test-"));
	try {
		const output = join(root, "dist");
		await builder.buildRuntime({ outputDirectory: output });
		await rm(join(output, "chunks", "child-peer-bridge.ts"));
		await assert.rejects(
			builder.validateGeneratedFiles(output),
			/Generated runtime is missing the child peer bridge/u,
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("generated runtime and child peer bridge load through Pi's Jiti resource loader", async () => {
	const builder = await loadBuilder();
	const root = await mkdtemp(join(packageRoot, ".pi-subagents-build-test-"));
	const agentDir = join(root, "agent");
	const output = join(root, "dist");
	const previousEnvironment = {
		agentDir: process.env.PI_CODING_AGENT_DIR,
		host: process.env.PI_SUBAGENT_PEER_HOST,
		port: process.env.PI_SUBAGENT_PEER_PORT,
		token: process.env.PI_SUBAGENT_PEER_TOKEN,
	};
	try {
		await builder.buildRuntime({ outputDirectory: output });
		await mkdir(agentDir, { recursive: true });
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env.PI_SUBAGENT_PEER_HOST = "127.0.0.1";
		process.env.PI_SUBAGENT_PEER_PORT = "12345";
		process.env.PI_SUBAGENT_PEER_TOKEN = "generated-bridge-test-token";
		const loader = new DefaultResourceLoader({
			cwd: root,
			agentDir,
			settingsManager: SettingsManager.inMemory({}),
			additionalExtensionPaths: [
				join(output, "index.ts"),
				join(output, "chunks", "child-peer-bridge.ts"),
			],
		});
		await loader.reload();
		const loaded = loader.getExtensions();
		assert.deepEqual(loaded.errors, []);
		assert.equal(loaded.extensions.length, 2);
		assert.ok(loaded.extensions[0]?.commands.has("subagents"));
		assert.deepEqual([...(loaded.extensions[1]?.tools.keys() ?? [])].sort(), [
			"subagent_peer_list",
			"subagent_peer_send",
		]);
	} finally {
		restoreEnvironment("PI_CODING_AGENT_DIR", previousEnvironment.agentDir);
		restoreEnvironment("PI_SUBAGENT_PEER_HOST", previousEnvironment.host);
		restoreEnvironment("PI_SUBAGENT_PEER_PORT", previousEnvironment.port);
		restoreEnvironment("PI_SUBAGENT_PEER_TOKEN", previousEnvironment.token);
		await rm(root, { force: true, recursive: true });
	}
});

test("a failed final publication restores the previous runtime", async () => {
	const builder = await loadBuilder();
	const root = await mkdtemp(join(packageRoot, ".pi-subagents-build-test-"));
	try {
		const staging = join(root, "staging");
		const output = join(root, "dist");
		await mkdir(staging, { recursive: true });
		await mkdir(output, { recursive: true });
		await writeFile(join(staging, "next.ts"), "next", "utf8");
		await writeFile(join(output, "previous.ts"), "previous", "utf8");
		let renameCalls = 0;
		await assert.rejects(
			builder.publishRuntime(staging, output, {
				renamePath: async (source, destination) => {
					renameCalls += 1;
					if (renameCalls === 2) throw new Error("injected publication failure");
					await rename(source, destination);
				},
			}),
			/injected publication failure/u,
		);
		assert.deepEqual(await listFiles(output), ["previous.ts"]);
		assert.deepEqual(
			(await readdir(root)).filter((name) => name.includes(".backup-")),
			[],
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("a failed generated-output validation preserves the previous runtime", async () => {
	const builder = await loadBuilder();
	const root = await mkdtemp(join(packageRoot, ".pi-subagents-build-test-"));
	try {
		const output = join(root, "dist");
		await mkdir(output, { recursive: true });
		await writeFile(join(output, "previous.ts"), "previous", "utf8");
		await assert.rejects(
			builder.buildRuntime({
				outputDirectory: output,
				validateOutput: async () => {
					throw new Error("injected validation failure");
				},
			}),
			/injected validation failure/u,
		);
		assert.deepEqual(await listFiles(output), ["previous.ts"]);
		assert.equal(await readFile(join(output, "previous.ts"), "utf8"), "previous");
		assert.deepEqual(
			(await readdir(root)).filter((name) => name.startsWith(".pi-subagents-dist-")),
			[],
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

function restoreEnvironment(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

function requireOutput(metadata: BuildMetadata, path: string) {
	const output = metadata.outputs?.[path];
	assert.ok(output, `missing fixture output: ${path}`);
	return output;
}

async function snapshotDirectory(directory: string, prefix = ""): Promise<Record<string, string>> {
	const snapshot: Record<string, string> = {};
	for (const path of await listFiles(directory, prefix)) {
		snapshot[path] = await readFile(join(directory, path), "base64");
	}
	return snapshot;
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
		const relativePath = join(prefix, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(directory, relativePath)));
		else if (entry.isFile()) files.push(relativePath.replaceAll("\\", "/"));
	}
	return files.sort();
}
