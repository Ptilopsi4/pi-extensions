import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { runChild } from "../src/job-process.js";
import type { ChildRequest } from "../src/job-types.js";
import { type PiInvocationRuntime, resolvePiInvocation } from "../src/pi-invocation.js";

const CORE_PACKAGE = "@earendil-works/pi-coding-agent";

function createRoot(): string {
	return mkdtempSync(path.join(os.tmpdir(), "pi-subagents-invocation-"));
}

function writeManifest(root: string, manifest: unknown): void {
	writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
}

function writeCli(root: string, relativePath = "dist/cli.js"): string {
	const cliPath = path.resolve(root, relativePath);
	mkdirSync(path.dirname(cliPath), { recursive: true });
	writeFileSync(cliPath, "process.stdout.write('fake pi')\n");
	chmodSync(cliPath, 0o755);
	return cliPath;
}

function nodeRuntime(
	packageDir: string,
	overrides: Partial<PiInvocationRuntime> = {},
): PiInvocationRuntime {
	return {
		execPath: process.execPath,
		packageDir,
		runtimeKind: "node",
		...overrides,
	};
}

function withRoot(run: (root: string) => void): void {
	const root = createRoot();
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("Pi invocation ignores an existing non-Pi host and selects the loaded core CLI", () => {
	withRoot((root) => {
		writeManifest(root, { name: CORE_PACKAGE, bin: { pi: "dist/cli.js" } });
		const cliPath = writeCli(root);
		const hostPath = path.join(root, "host.js");
		writeFileSync(hostPath, "throw new Error('host must not run')\n");
		const runtime = { ...nodeRuntime(root), argvEntry: hostPath };

		assert.deepEqual(resolvePiInvocation(["--mode", "json"], runtime), {
			command: process.execPath,
			args: [realpathSync(cliPath), "--mode", "json"],
		});
	});
});

test("subagent launch does not re-execute a pi-web-like host entrypoint", async () => {
	const root = createRoot();
	const marker = path.join(root, "host-ran");
	const hostPath = path.join(root, "pi-web.js");
	const cliPath = path.join(root, "dist", "cli.js");
	mkdirSync(path.dirname(cliPath), { recursive: true });
	writeManifest(root, { name: CORE_PACKAGE, bin: { pi: "dist/cli.js" } });
	writeFileSync(
		hostPath,
		`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'ran');`,
	);
	writeFileSync(
		cliPath,
		[
			"const text=JSON.stringify(process.argv.slice(2));",
			"const message={role:'assistant',content:[{type:'text',text}],stopReason:'stop',timestamp:Date.now()};",
			"process.stdout.write(JSON.stringify({type:'message_end',message})+'\\n');",
		].join(""),
	);
	const previousEntry = process.argv[1];
	const previousPackageDir = process.env.PI_PACKAGE_DIR;
	process.argv[1] = hostPath;
	process.env.PI_PACKAGE_DIR = root;
	try {
		const request: ChildRequest = {
			task: "inspect",
			tools: ["read"],
			model: "test/model",
			thinkingLevel: "low",
			cwd: root,
			projectTrusted: false,
			signal: new AbortController().signal,
		};
		const result = await runChild(request);
		assert.equal(result.state, "completed");
		assert.match(result.result ?? "", /"--mode","json","-p","--no-session"/);
		assert.equal(existsSync(marker), false);
	} finally {
		process.argv[1] = previousEntry;
		if (previousPackageDir === undefined) delete process.env.PI_PACKAGE_DIR;
		else process.env.PI_PACKAGE_DIR = previousPackageDir;
		rmSync(root, { recursive: true, force: true });
	}
});

test("Pi invocation normalizes the package directory and declared bin target", {
	skip: process.platform === "win32",
}, () => {
	withRoot((root) => {
		const packageRoot = path.join(root, "package");
		mkdirSync(packageRoot);
		writeManifest(packageRoot, {
			name: CORE_PACKAGE,
			bin: { pi: "dist/../dist/cli.js" },
		});
		const cliPath = writeCli(packageRoot);
		const packageLink = path.join(root, "package-link");
		symlinkSync(packageRoot, packageLink, "dir");

		assert.deepEqual(resolvePiInvocation(["--no-session"], nodeRuntime(packageLink)), {
			command: process.execPath,
			args: [realpathSync(cliPath), "--no-session"],
		});
	});
});

test("Pi invocation reuses only a validated standalone Pi executable", () => {
	withRoot((root) => {
		writeManifest(root, { name: CORE_PACKAGE, bin: { pi: "dist/cli.js" } });
		const executable = path.join(root, process.platform === "win32" ? "pi.exe" : "pi");
		writeFileSync(executable, "standalone pi fixture\n");
		chmodSync(executable, 0o755);

		assert.deepEqual(
			resolvePiInvocation(["--mode", "json"], {
				execPath: executable,
				packageDir: root,
				runtimeKind: "bun",
			}),
			{ command: realpathSync(executable), args: ["--mode", "json"] },
		);
	});
});

test("Pi invocation treats a Node executable named pi as a script runtime", () => {
	withRoot((root) => {
		writeManifest(root, { name: CORE_PACKAGE, bin: { pi: "dist/cli.js" } });
		const cliPath = writeCli(root);
		const executable = path.join(root, process.platform === "win32" ? "pi.exe" : "pi");
		writeFileSync(executable, "node runtime fixture\n");
		chmodSync(executable, 0o755);
		assert.deepEqual(
			resolvePiInvocation(["--mode", "json"], {
				execPath: executable,
				packageDir: root,
				runtimeKind: "node",
			}),
			{ command: executable, args: [realpathSync(cliPath), "--mode", "json"] },
		);
	});
});

test("Pi invocation rejects a standalone-looking executable from an unsupported runtime", () => {
	withRoot((root) => {
		writeManifest(root, { name: CORE_PACKAGE, bin: { pi: "dist/cli.js" } });
		writeCli(root);
		const executable = path.join(root, process.platform === "win32" ? "pi.exe" : "pi");
		writeFileSync(executable, "unsupported standalone fixture\n");
		chmodSync(executable, 0o755);
		assert.throws(
			() =>
				resolvePiInvocation([], {
					execPath: executable,
					packageDir: root,
					runtimeKind: "unsupported",
				}),
			/Unable to resolve the Pi CLI.*supported Node or Bun runtime/i,
		);
	});
});

test("Pi invocation rejects unsupported script runtimes", () => {
	withRoot((root) => {
		writeManifest(root, { name: CORE_PACKAGE, bin: { pi: "dist/cli.js" } });
		writeCli(root);
		assert.throws(
			() =>
				resolvePiInvocation([], {
					execPath: path.join(root, "embedded-host"),
					packageDir: root,
					runtimeKind: "unsupported",
				}),
			/Unable to resolve the Pi CLI.*supported Node or Bun runtime/i,
		);
	});
});

test("Pi invocation rejects unverified standalone executables", () => {
	withRoot((root) => {
		writeManifest(root, { name: "embedded-host", bin: { pi: "host.js" } });
		const executable = path.join(root, process.platform === "win32" ? "pi.exe" : "pi");
		writeFileSync(executable, "not core pi\n");
		chmodSync(executable, 0o755);
		assert.throws(
			() =>
				resolvePiInvocation([], {
					execPath: executable,
					packageDir: root,
					runtimeKind: "bun",
				}),
			/Unable to resolve the Pi CLI.*unexpected package name/i,
		);
	});
});

test("Pi invocation fails closed for invalid loaded core metadata", () => {
	const cases: Array<{
		name: string;
		prepare: (root: string) => void;
		expected: RegExp;
	}> = [
		{
			name: "missing manifest",
			prepare: () => {},
			expected: /package manifest is unavailable/i,
		},
		{
			name: "malformed manifest",
			prepare: (root) => writeFileSync(path.join(root, "package.json"), "{"),
			expected: /package manifest is invalid/i,
		},
		{
			name: "wrong package",
			prepare: (root) => writeManifest(root, { name: "other", bin: { pi: "dist/cli.js" } }),
			expected: /unexpected package name/i,
		},
		{
			name: "non-object bin",
			prepare: (root) => writeManifest(root, { name: CORE_PACKAGE, bin: "dist/cli.js" }),
			expected: /bin\.pi must be a non-empty string/i,
		},
		{
			name: "non-string pi bin",
			prepare: (root) => writeManifest(root, { name: CORE_PACKAGE, bin: { pi: 42 } }),
			expected: /bin\.pi must be a non-empty string/i,
		},
		{
			name: "missing target",
			prepare: (root) => writeManifest(root, { name: CORE_PACKAGE, bin: { pi: "dist/cli.js" } }),
			expected: /declared bin\.pi target is unavailable/i,
		},
	];

	for (const fixture of cases) {
		withRoot((root) => {
			fixture.prepare(root);
			assert.throws(
				() => resolvePiInvocation([], nodeRuntime(root)),
				(error) => {
					assert.ok(error instanceof Error, fixture.name);
					assert.match(error.message, /Unable to resolve the Pi CLI/i, fixture.name);
					assert.match(error.message, fixture.expected, fixture.name);
					assert.doesNotMatch(error.message, /command:\s*pi/i, fixture.name);
					return true;
				},
				fixture.name,
			);
		});
	}
});

test("Pi invocation rejects a bin target outside the loaded package", () => {
	withRoot((root) => {
		const packageRoot = path.join(root, "package");
		mkdirSync(packageRoot);
		writeManifest(packageRoot, { name: CORE_PACKAGE, bin: { pi: "../outside.js" } });
		writeCli(root, "outside.js");
		assert.throws(
			() => resolvePiInvocation([], nodeRuntime(packageRoot)),
			/Unable to resolve the Pi CLI.*bin\.pi target escapes the package directory/i,
		);
	});
});
