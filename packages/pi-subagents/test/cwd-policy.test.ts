import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { assertDelegationTargetAllowed, resolveSubagentTarget } from "../src/cwd-policy.js";

function fixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-cwd-policy-"));
	const agentDir = path.join(root, "agent");
	const workspace = path.join(root, "workspace");
	const child = path.join(workspace, "child");
	const external = path.join(root, "external");
	mkdirSync(agentDir);
	mkdirSync(child, { recursive: true });
	mkdirSync(external);
	return { root, agentDir, workspace, child, external };
}

test("resolves relative descendants with current-session trust", () => {
	const value = fixture();
	try {
		const resolved = resolveSubagentTarget({
			workspace: value.workspace,
			requestedCwd: "child",
			currentProjectTrusted: true,
			agentDir: value.agentDir,
		});
		assert.equal(resolved.cwd, realpathSync(value.child));
		assert.equal(resolved.boundary, "current-workspace");
		assert.equal(resolved.trust.kind, "session-trusted");
		assert.equal(resolved.trust.projectTrusted, true);
	} finally {
		rmSync(value.root, { recursive: true, force: true });
	}
});

test("uses nearest saved external trust decision", () => {
	const value = fixture();
	try {
		const nested = path.join(value.external, "nested");
		mkdirSync(nested);
		const store = new ProjectTrustStore(value.agentDir);
		store.set(value.root, true);
		store.set(value.external, false);
		const denied = resolveSubagentTarget({
			workspace: value.workspace,
			requestedCwd: nested,
			currentProjectTrusted: true,
			agentDir: value.agentDir,
		});
		assert.equal(denied.boundary, "external");
		assert.equal(denied.trust.kind, "saved-denied");
		assert.equal(denied.trust.sourcePath, realpathSync(value.external));
		assert.equal(denied.trust.projectTrusted, false);

		store.set(value.external, true);
		const trusted = resolveSubagentTarget({
			workspace: value.workspace,
			requestedCwd: nested,
			currentProjectTrusted: false,
			agentDir: value.agentDir,
		});
		assert.equal(trusted.trust.kind, "saved-trusted");
		assert.equal(trusted.trust.projectTrusted, true);
	} finally {
		rmSync(value.root, { recursive: true, force: true });
	}
});

test("classifies unsaved and malformed trust stores without failing open", () => {
	const value = fixture();
	try {
		const unsaved = resolveSubagentTarget({
			workspace: value.workspace,
			requestedCwd: value.external,
			currentProjectTrusted: true,
			agentDir: value.agentDir,
		});
		assert.equal(unsaved.trust.kind, "unsaved");
		assert.equal(unsaved.trust.projectTrusted, false);

		writeFileSync(path.join(value.agentDir, "trust.json"), '{"SECRET_TRUST_BYTES":"unterminated');
		const malformed = resolveSubagentTarget({
			workspace: value.workspace,
			requestedCwd: value.external,
			currentProjectTrusted: true,
			agentDir: value.agentDir,
		});
		assert.equal(malformed.trust.kind, "trust-error");
		assert.equal(malformed.trust.projectTrusted, false);
		assert.match(malformed.trust.warning ?? "", /trust store/i);
		assert.doesNotMatch(malformed.trust.warning ?? "", /SECRET_TRUST_BYTES/);
	} finally {
		rmSync(value.root, { recursive: true, force: true });
	}
});

test("canonicalizes symlinks before workspace and trust classification", () => {
	const value = fixture();
	try {
		const symlinkEscape = path.join(value.workspace, "escape");
		symlinkSync(value.external, symlinkEscape, "dir");
		new ProjectTrustStore(value.agentDir).set(value.external, true);
		const resolved = resolveSubagentTarget({
			workspace: value.workspace,
			requestedCwd: symlinkEscape,
			currentProjectTrusted: false,
			agentDir: value.agentDir,
		});
		assert.equal(resolved.cwd, realpathSync(value.external));
		assert.equal(resolved.boundary, "external");
		assert.equal(resolved.trust.kind, "saved-trusted");
	} finally {
		rmSync(value.root, { recursive: true, force: true });
	}
});

test("rejects missing paths and non-directories before launch", () => {
	const value = fixture();
	try {
		assert.throws(
			() =>
				resolveSubagentTarget({
					workspace: value.workspace,
					requestedCwd: path.join(value.root, "missing"),
					currentProjectTrusted: true,
					agentDir: value.agentDir,
				}),
			/does not exist/i,
		);
		const file = path.join(value.root, "file");
		writeFileSync(file, "x");
		assert.throws(
			() =>
				resolveSubagentTarget({
					workspace: value.workspace,
					requestedCwd: file,
					currentProjectTrusted: true,
					agentDir: value.agentDir,
				}),
			/not a directory/i,
		);
	} finally {
		rmSync(value.root, { recursive: true, force: true });
	}
});

test("enforces delegation target policies", () => {
	const value = fixture();
	try {
		const external = resolveSubagentTarget({
			workspace: value.workspace,
			requestedCwd: value.external,
			currentProjectTrusted: true,
			agentDir: value.agentDir,
		});
		assert.throws(() => assertDelegationTargetAllowed(external, "trusted-targets"), /\/trust/);
		assert.doesNotThrow(() => assertDelegationTargetAllowed(external, "anywhere"));

		new ProjectTrustStore(value.agentDir).set(value.external, true);
		const trusted = resolveSubagentTarget({
			workspace: value.workspace,
			requestedCwd: value.external,
			currentProjectTrusted: false,
			agentDir: value.agentDir,
		});
		assert.doesNotThrow(() => assertDelegationTargetAllowed(trusted, "trusted-targets"));
		assert.throws(
			() => assertDelegationTargetAllowed(trusted, "current-workspace"),
			/current workspace/i,
		);
	} finally {
		rmSync(value.root, { recursive: true, force: true });
	}
});
