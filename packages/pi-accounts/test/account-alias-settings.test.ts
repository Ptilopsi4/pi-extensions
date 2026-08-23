import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { setAliasesEnabled } from "../src/account-alias-settings.js";
import { AccountStore } from "../src/account-store.js";
import { InMemoryAccountStorageBackend } from "../src/storage.js";

const status = (enabled: boolean, error?: string) => ({
	enabled,
	managed: enabled ? 1 : 0,
	available: enabled ? 1 : 0,
	collisions: [],
	...(error ? { error } : {}),
});

test("alias setting apply failure restores the persisted setting and runtime", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	const mock = createMockPi();
	const { ctx } = createMockContext();
	let reconciliations = 0;

	await assert.rejects(
		setAliasesEnabled({
			enabled: true,
			ctx,
			owner: { signal: new AbortController().signal, isCurrent: () => true },
			pi: mock.pi,
			store,
			ensureAliasRuntime: async () => ({}) as never,
			reconcileAliases: async () => {
				reconciliations += 1;
				return reconciliations === 1 ? status(true, "injected apply failure") : status(false);
			},
			syncProvider: async () => ({ status: "inactive", providerId: "anthropic" }),
			getBinding: () => undefined,
		}),
		/injected apply failure/,
	);

	assert.equal((await store.readAsync()).settings?.accountProviderAliases, false);
	assert.equal(reconciliations, 2);
});

test("stale settings owners cannot persist after lazy initialization", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	const mock = createMockPi();
	const { ctx } = createMockContext();
	let current = true;
	let reconciliations = 0;

	await assert.rejects(
		setAliasesEnabled({
			enabled: true,
			ctx,
			owner: { signal: new AbortController().signal, isCurrent: () => current },
			pi: mock.pi,
			store,
			ensureAliasRuntime: async () => {
				current = false;
				return {} as never;
			},
			reconcileAliases: async () => {
				reconciliations += 1;
				return status(true);
			},
			syncProvider: async () => ({ status: "inactive", providerId: "anthropic" }),
			getBinding: () => undefined,
		}),
		/Settings closed/,
	);

	assert.equal((await store.readAsync()).settings?.accountProviderAliases, undefined);
	assert.equal(reconciliations, 0);
});
