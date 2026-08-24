// Cohesion justification: this account-manager integration matrix shares credential/provider
// fixtures and cross-covers menus, OAuth, replacement, switching, persistence, and lifecycle safety.
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { beforeAll, test } from "vitest";
import {
	createCustomSelectorHarness,
	createMockContext,
	createMockPi,
} from "../../../test/support.js";
import type {
	AccountAliasModule,
	AccountAliasRuntime,
	AccountAliasStatus,
} from "../src/account-aliases.js";
import accountsExtension, {
	ACCOUNTS_STATUS_KEY,
	AccountStore,
	FAIL_CLOSED_API_KEY,
	parseAccountName,
	type StoredOAuthCredential,
} from "../src/accounts.js";
import {
	type AccountProviderAdapter,
	createBuiltinProviderAdapters,
	createOAuthInteraction,
	loginWithOAuthUI,
} from "../src/oauth.js";
import { RuntimeAuthCoordinator } from "../src/runtime-auth.js";
import { InMemoryAccountStorageBackend } from "../src/storage.js";

beforeAll(() => initTheme("dark", false));

const credential = (
	suffix: string,
	extra: Record<string, unknown> = {},
): StoredOAuthCredential => ({
	type: "oauth",
	access: `access-${suffix}`,
	refresh: `refresh-${suffix}`,
	expires: Date.now() + 60 * 60 * 1000,
	...extra,
});

function fakeProvider(
	id: AccountProviderAdapter["id"],
	options: {
		baseUrl?: string;
		headers?: Record<string, string>;
		requiresApiKeyBridge?: boolean;
	} = {},
): AccountProviderAdapter {
	return {
		id,
		displayName:
			id === "openai-codex" ? "OpenAI Codex" : id === "anthropic" ? "Anthropic" : "GitHub Copilot",
		requiresApiKeyBridge: options.requiresApiKeyBridge ?? id === "openai-codex",
		oauth: {
			async login() {
				return credential(
					`login-${id}`,
					id === "github-copilot" ? { availableModelIds: ["allowed"] } : {},
				);
			},
			async refresh(current) {
				return { ...current, access: `${current.access}-refreshed`, expires: Date.now() + 60_000 };
			},
			async toAuth(current) {
				return { apiKey: current.access, baseUrl: options.baseUrl, headers: options.headers };
			},
		},
	};
}

function fakeAliasModule(
	store: AccountStore,
	record: {
		factoryInitializations: number;
		reconciliations: number;
		shutdowns: number;
	},
	binding?: {
		aliasId: string;
		providerId: AccountProviderAdapter["id"];
		accountName: string;
	},
): AccountAliasModule {
	let enabled = false;
	const status = (): AccountAliasStatus => ({
		enabled,
		managed: enabled ? 1 : 0,
		available: enabled ? 1 : 0,
		collisions: [],
	});
	const runtime: AccountAliasRuntime = {
		async initializeFactory(data) {
			record.factoryInitializations += 1;
			enabled = data.settings?.accountProviderAliases === true;
		},
		async reconcile() {
			record.reconciliations += 1;
			enabled = (await store.readAsync()).settings?.accountProviderAliases === true;
			return status();
		},
		async shutdown() {
			record.shutdowns += 1;
			enabled = false;
		},
		getStatus: status,
		getBinding: (providerId) => (enabled && providerId === binding?.aliasId ? binding : undefined),
	};
	return { createAccountAliasRuntime: async () => runtime };
}

function runtimeHarness(mock: ReturnType<typeof createMockPi>) {
	const keys = new Map<string, string>();
	const models = [
		{ provider: "openai-codex", id: "codex", baseUrl: "https://codex.example" },
		{ provider: "anthropic", id: "claude", baseUrl: "https://anthropic.example" },
		{ provider: "github-copilot", id: "allowed", baseUrl: "https://default.copilot" },
		{ provider: "github-copilot", id: "blocked", baseUrl: "https://default.copilot" },
	];
	const runtime = {
		async setRuntimeApiKey(provider: string, key: string) {
			keys.set(provider, key);
		},
		async removeRuntimeApiKey(provider: string) {
			keys.delete(provider);
		},
	};
	const registry = {
		runtime,
		getRegisteredProviderConfig: (provider: string) => mock.providers.get(provider),
		getApiKeyForProvider: async (provider: string) => keys.get(provider),
		getAll: () =>
			models.map((model) => ({
				...model,
				name: model.id,
				api: "openai-responses",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
				maxTokens: 100,
			})),
		find(provider: string, id: string) {
			const model = models.find((item) => item.provider === provider && item.id === id);
			if (!model) return undefined;
			const config = mock.providers.get(provider) as
				| { baseUrl?: string; models?: Array<{ id: string }> }
				| undefined;
			if (config?.models && !config.models.some((item) => item.id === id)) return undefined;
			return { ...model, baseUrl: config?.baseUrl ?? model.baseUrl };
		},
		async getApiKeyAndHeaders(model: { provider: string }) {
			const config = mock.providers.get(model.provider) as
				| { headers?: Record<string, string> }
				| undefined;
			return { ok: true as const, apiKey: keys.get(model.provider), headers: config?.headers };
		},
	};
	return { keys, registry, runtime };
}

function createInteractiveAccountContext(
	overrides: Record<string, unknown> = {},
	options: {
		selections?: string[];
		inputs?: Array<string | undefined>;
		confirms?: boolean[];
	} = {},
) {
	const selections = [...(options.selections ?? [])];
	const inputs = [...(options.inputs ?? [])];
	const confirms = [...(options.confirms ?? [])];
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const inputCalls: Array<{ title: string; placeholder?: string }> = [];
	const confirmCalls: Array<{ title: string; message: string }> = [];
	const context = createMockContext({
		mode: "rpc",
		hasUI: true,
		...overrides,
		select: async (title: string, values: string[]) => {
			selectCalls.push({ title, options: values });
			const selected = selections.shift();
			if (selected !== undefined)
				assert.ok(values.includes(selected), `Missing option: ${selected}`);
			return selected;
		},
		input: async (title: string, placeholder?: string) => {
			inputCalls.push({ title, placeholder });
			return inputs.shift();
		},
		confirm: async (title: string, message: string) => {
			confirmCalls.push({ title, message });
			return confirms.shift() ?? true;
		},
	});
	return { ...context, selectCalls, inputCalls, confirmCalls };
}

test("built-in provider adapters preserve each provider's complete OAuth auth shape", async () => {
	const adapters = createBuiltinProviderAdapters();
	const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));
	const base = credential("contract");

	assert.equal(typeof byId.get("openai-codex")?.invalidateConnections, "function");
	assert.deepEqual(await byId.get("openai-codex")?.oauth.toAuth(base), {
		apiKey: "access-contract",
	});
	assert.deepEqual(await byId.get("anthropic")?.oauth.toAuth(base), {
		apiKey: "access-contract",
	});
	const copilotCredential = credential("contract", {
		access: "tid=1;proxy-ep=proxy.business.githubcopilot.com;exp=1",
		enterpriseUrl: "github.example.com",
		availableModelIds: ["allowed"],
	});
	assert.deepEqual(await byId.get("github-copilot")?.oauth.toAuth(copilotCredential), {
		apiKey: copilotCredential.access,
		baseUrl: "https://api.business.githubcopilot.com",
	});
});

test("OAuth interaction preserves provider prompts, cancellation, and notifications", async () => {
	const dialogSignals: Array<AbortSignal | undefined> = [];
	const { ctx, notifications } = createMockContext({
		hasUI: true,
		input: async (_title: string, _placeholder: string, options?: { signal?: AbortSignal }) => {
			dialogSignals.push(options?.signal);
			return undefined;
		},
		select: async (_title: string, _options: string[], options?: { signal?: AbortSignal }) => {
			dialogSignals.push(options?.signal);
			return "Device login";
		},
	});
	const owner = new AbortController();
	const interaction = createOAuthInteraction(ctx, "Example", owner.signal);
	assert.equal(interaction.signal, owner.signal);
	assert.equal(
		await interaction.prompt({
			type: "select",
			message: "Method",
			options: [
				{ id: "browser", label: "Browser" },
				{ id: "device", label: "Device login" },
			],
		}),
		"device",
	);
	await assert.rejects(
		interaction.prompt({ type: "manual_code", message: "Code" }),
		/Login cancelled/,
	);
	assert.deepEqual(dialogSignals, [owner.signal, owner.signal]);
	interaction.notify({
		type: "device_code",
		userCode: "ABCD",
		verificationUri: "https://example.test/device",
	});
	assert.match(notifications.at(-1)?.message ?? "", /ABCD/);
});

test("TUI OAuth login uses Pi's native dialog across provider-owned steps", async () => {
	let harness: ReturnType<typeof createCustomSelectorHarness> | undefined;
	let continueToPrompt!: () => void;
	const authShown = new Promise<void>((resolve) => {
		continueToPrompt = resolve;
	});
	let selectedMethod: string | undefined;
	let manualCode: string | undefined;
	const provider = fakeProvider("github-copilot");
	provider.oauth.login = async (interaction) => {
		interaction.notify({
			type: "info",
			message: "Sign in with GitHub",
			links: [{ label: "Help", url: "https://example.test/help" }],
		});
		await authShown;
		selectedMethod = await interaction.prompt({
			type: "select",
			message: "Choose login method",
			options: [
				{ id: "browser", label: "Browser" },
				{ id: "device", label: "Device login" },
			],
		});
		interaction.notify({
			type: "device_code",
			userCode: "ABCD-EFGH",
			verificationUri: "https://example.test/device",
		});
		interaction.notify({ type: "progress", message: "Checking authorization..." });
		manualCode = await interaction.prompt({ type: "manual_code", message: "Paste callback:" });
		return credential("native-dialog", { availableModelIds: ["allowed"] });
	};
	const { ctx } = createMockContext({
		mode: "tui",
		hasUI: true,
		custom: async (factory: unknown) => {
			harness = createCustomSelectorHarness(factory, 100);
			return harness.resultPromise;
		},
	});

	const login = loginWithOAuthUI(ctx, provider, new AbortController().signal);
	await waitForTest(() => harness !== undefined);
	assert.ok(harness);
	assert.equal(harness.isFocusable, true);
	assert.match(harness.render().join("\n"), /Login to GitHub Copilot/);
	assert.match(harness.render().join("\n"), /Sign in with GitHub/);
	assert.match(harness.render().join("\n"), /Help: https:\/\/example\.test\/help/);

	continueToPrompt();
	await waitForTest(() => harness?.render().join("\n").includes("Device login") ?? false);
	assert.match(harness.render().join("\n"), /Choose login method/);
	harness.handleInput("tui.select.down");
	harness.handleInput("tui.select.confirm");
	await waitForTest(() => harness?.render().join("\n").includes("ABCD-EFGH") ?? false);
	const loginScreen = harness.render().join("\n");
	assert.match(loginScreen, /https:\/\/example\.test\/device/);
	assert.match(loginScreen, /Enter code: ABCD-EFGH/);
	assert.match(loginScreen, /Waiting for authentication/);
	assert.match(loginScreen, /Checking authorization/);
	assert.match(loginScreen, /Paste callback/);

	harness.setFocused(true);
	harness.handleInput("callback-value");
	harness.handleInput("tui.input.submit");
	assert.equal((await login).access, "access-native-dialog");
	assert.equal(selectedMethod, "device");
	assert.equal(manualCode, "callback-value");
});

test("TUI OAuth login aborts provider work on Escape and component disposal", async () => {
	for (const cancellation of ["escape", "dispose"] as const) {
		let harness: ReturnType<typeof createCustomSelectorHarness> | undefined;
		let providerSignal: AbortSignal | undefined;
		const provider = fakeProvider("anthropic");
		provider.oauth.login = async (interaction) => {
			providerSignal = interaction.signal;
			await new Promise<void>((resolve) => {
				if (interaction.signal.aborted) resolve();
				else interaction.signal.addEventListener("abort", () => resolve(), { once: true });
			});
			throw new Error("Login cancelled");
		};
		const { ctx } = createMockContext({
			mode: "tui",
			hasUI: true,
			custom: async (factory: unknown) => {
				harness = createCustomSelectorHarness(factory, 100);
				return harness.resultPromise;
			},
		});

		const login = loginWithOAuthUI(ctx, provider, new AbortController().signal);
		await waitForTest(() => harness !== undefined && providerSignal !== undefined);
		assert.ok(harness);
		if (cancellation === "escape") harness.handleInput("tui.select.cancel");
		else harness.dispose();
		await assert.rejects(login, /Login cancelled/);
		assert.equal(providerSignal?.aborted, true);
	}
});

test("TUI OAuth login closes when its menu owner is cancelled", async () => {
	let harness: ReturnType<typeof createCustomSelectorHarness> | undefined;
	let providerSignal: AbortSignal | undefined;
	const provider = fakeProvider("openai-codex");
	provider.oauth.login = async (interaction) => {
		providerSignal = interaction.signal;
		await new Promise<void>((resolve) => {
			if (interaction.signal.aborted) resolve();
			else interaction.signal.addEventListener("abort", () => resolve(), { once: true });
		});
		throw new Error("Login cancelled");
	};
	const owner = new AbortController();
	const { ctx } = createMockContext({
		mode: "tui",
		hasUI: true,
		custom: async (factory: unknown) => {
			harness = createCustomSelectorHarness(factory, 100);
			return harness.resultPromise;
		},
	});

	const login = loginWithOAuthUI(ctx, provider, owner.signal);
	await waitForTest(() => harness !== undefined && providerSignal !== undefined);
	owner.abort();
	await assert.rejects(login, /Login cancelled/);
	assert.equal(providerSignal?.aborted, true);
});

async function waitForTest(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for test state");
}

test("accounts registers only the interactive /accounts command and lifecycle hooks", () => {
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store: new AccountStore(new InMemoryAccountStorageBackend()),
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});

	assert.deepEqual([...mock.commands.keys()].sort(), ["accounts"]);
	assert.deepEqual([...mock.events.keys()].sort(), [
		"before_agent_start",
		"model_select",
		"session_shutdown",
		"session_start",
		"turn_start",
	]);
});

test("disabled aliases do not load their lazy runtime", () => {
	let loads = 0;
	const mock = createMockPi();
	const result = accountsExtension(mock.pi, {
		store: new AccountStore(new InMemoryAccountStorageBackend()),
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
		aliasModuleLoader: async () => {
			loads += 1;
			throw new Error("must stay lazy");
		},
	});

	assert.equal(result, undefined);
	assert.equal(loads, 0);
});

test("enabled aliases initialize in the awaited extension factory", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		settings: { accountProviderAliases: true },
		providers: { anthropic: { accounts: { work: credential("work") } } },
	});
	const record = { factoryInitializations: 0, reconciliations: 0, shutdowns: 0 };
	const mock = createMockPi();
	const result = accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
		aliasModuleLoader: async () => fakeAliasModule(store, record),
	});

	assert.ok(result instanceof Promise);
	await result;
	assert.equal(record.factoryInitializations, 1);
	const { registry } = runtimeHarness(mock);
	const { ctx, notifications } = createMockContext({ modelRegistry: registry, hasUI: true });
	await mock.events.get("session_start")?.[0]?.({}, ctx);
	assert.equal(record.reconciliations, 1);
	assert.match(notifications.map((entry) => entry.message).join("\n"), /aliases are experimental/);
});

test("session shutdown stops aborted alias startup before provider auth can republish", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		settings: { accountProviderAliases: true },
		providers: {
			anthropic: { active: "work", accounts: { work: credential("work") } },
		},
	});
	let conversions = 0;
	const anthropic = fakeProvider("anthropic");
	anthropic.oauth.toAuth = async (current) => {
		conversions += 1;
		return { apiKey: current.access };
	};
	let markReconcileStarted!: () => void;
	const reconcileStarted = new Promise<void>((resolve) => {
		markReconcileStarted = resolve;
	});
	const aliasModule: AccountAliasModule = {
		createAccountAliasRuntime: async () => ({
			async initializeFactory() {},
			async reconcile(_ctx, signal) {
				markReconcileStarted();
				if (!signal) throw new Error("Missing session cancellation signal");
				await new Promise<void>((_resolve, reject) => {
					const rejectAborted = () => reject(signal.reason);
					if (signal.aborted) rejectAborted();
					else signal.addEventListener("abort", rejectAborted, { once: true });
				});
				throw new Error("unreachable");
			},
			async shutdown() {},
			getStatus: () => ({
				enabled: true,
				managed: 1,
				available: 1,
				collisions: [],
			}),
			getBinding: () => undefined,
		}),
	};
	const mock = createMockPi();
	await accountsExtension(mock.pi, {
		store,
		providers: [fakeProvider("openai-codex"), anthropic, fakeProvider("github-copilot")],
		aliasModuleLoader: async () => aliasModule,
	});
	const { registry, keys } = runtimeHarness(mock);
	const { ctx, statuses } = createMockContext({
		model: { provider: "anthropic", id: "claude" },
		modelRegistry: registry,
	});

	const startup = mock.events.get("session_start")?.[0]?.({}, ctx);
	await reconcileStarted;
	await mock.events.get("session_shutdown")?.[0]?.({}, ctx);
	await startup;

	assert.equal(conversions, 0);
	assert.equal(keys.has("anthropic"), false);
	assert.equal(statuses.get(ACCOUNTS_STATUS_KEY), undefined);
});

test("enabled factory registers native aliases with built-in model catalogs", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		settings: { accountProviderAliases: true },
		providers: {
			"openai-codex": { accounts: { work: credential("work") } },
			anthropic: { accounts: { personal: credential("personal") } },
			"github-copilot": {
				accounts: {
					enterprise: credential("enterprise", { availableModelIds: ["gpt-4.1"] }),
				},
			},
		},
	});
	const mock = createMockPi();
	await accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});

	for (const aliasId of ["openai-codex-work", "anthropic-personal", "github-copilot-enterprise"]) {
		const provider = mock.providers.get(aliasId) as
			| { id?: string; getModels?: () => Array<{ provider: string }> }
			| undefined;
		assert.equal(provider?.id, aliasId);
		assert.ok((provider?.getModels?.().length ?? 0) > 0);
		assert.equal(provider?.getModels?.()[0]?.provider, aliasId);
	}
});

test("accounts Settings confirms and persists experimental aliases immediately", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	const record = { factoryInitializations: 0, reconciliations: 0, shutdowns: 0 };
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
		aliasModuleLoader: async () => fakeAliasModule(store, record),
	});
	const { registry } = runtimeHarness(mock);
	const interactive = createInteractiveAccountContext(
		{ modelRegistry: registry },
		{
			selections: ["Settings", "Account provider aliases (experimental) (Disabled)"],
			confirms: [true],
		},
	);

	await mock.commands.get("accounts")?.handler("", interactive.ctx);

	assert.equal((await store.readAsync()).settings?.accountProviderAliases, true);
	assert.equal(record.reconciliations, 1);
	assert.equal(interactive.confirmCalls.length, 1);
	assert.match(interactive.notifications.at(-1)?.message ?? "", /experimental/i);
});

test("cancelling experimental alias confirmation leaves storage and runtime unchanged", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	let aliasLoads = 0;
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
		aliasModuleLoader: async () => {
			aliasLoads += 1;
			return fakeAliasModule(store, {
				factoryInitializations: 0,
				reconciliations: 0,
				shutdowns: 0,
			});
		},
	});
	const { registry } = runtimeHarness(mock);
	const interactive = createInteractiveAccountContext(
		{ modelRegistry: registry },
		{
			selections: ["Settings", "Account provider aliases (experimental) (Disabled)"],
			confirms: [false],
		},
	);

	await mock.commands.get("accounts")?.handler("", interactive.ctx);

	assert.equal((await store.readAsync()).settings?.accountProviderAliases, undefined);
	assert.equal(aliasLoads, 0);
});

test("disabling aliases falls back only through the already-active same account", async () => {
	for (const active of ["work", "personal"] as const) {
		const store = new AccountStore(new InMemoryAccountStorageBackend());
		await store.write({
			version: 1,
			settings: { accountProviderAliases: true },
			providers: {
				anthropic: {
					active,
					accounts: {
						work: credential("work"),
						personal: credential("personal"),
					},
				},
			},
		});
		const record = { factoryInitializations: 0, reconciliations: 0, shutdowns: 0 };
		const mock = createMockPi();
		const binding = {
			aliasId: "anthropic-work",
			providerId: "anthropic" as const,
			accountName: "work",
		};
		const initialized = accountsExtension(mock.pi, {
			store,
			providers: [
				fakeProvider("openai-codex"),
				fakeProvider("anthropic"),
				fakeProvider("github-copilot"),
			],
			aliasModuleLoader: async () => fakeAliasModule(store, record, binding),
		});
		await initialized;
		const { registry } = runtimeHarness(mock);
		const interactive = createInteractiveAccountContext(
			{
				model: { provider: "anthropic-work", id: "claude", api: "anthropic-messages" },
				modelRegistry: registry,
			},
			{
				selections: ["Settings", "Account provider aliases (experimental) (Enabled)"],
			},
		);

		await mock.commands.get("accounts")?.handler("", interactive.ctx);

		assert.equal((await store.readAsync()).settings?.accountProviderAliases, false);
		if (active === "work") {
			assert.equal(
				(mock.setModels.at(-1) as { provider?: string } | undefined)?.provider,
				"anthropic",
			);
		} else {
			assert.equal(mock.setModels.length, 0);
			assert.match(
				interactive.notifications.map((entry) => entry.message).join("\n"),
				/No safe same-account fallback/,
			);
		}
	}
});

test("account names reserve default for Pi login", () => {
	assert.equal(parseAccountName(" work-1 ").ok, true);
	assert.equal(parseAccountName("../secret").ok, false);
	assert.equal(parseAccountName("default").ok, true);
});

test("accounts command rejects observably outside TUI and RPC modes", async () => {
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store: new AccountStore(new InMemoryAccountStorageBackend()),
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	for (const mode of ["print", "json"] as const) {
		const { ctx } = createMockContext({ mode, hasUI: false });
		await assert.rejects(
			Promise.resolve(mock.commands.get("accounts")?.handler("", ctx)),
			/requires interactive UI/,
		);
	}
});

test("accounts command rejects trailing arguments before opening UI", async () => {
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store: new AccountStore(new InMemoryAccountStorageBackend()),
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const interactive = createInteractiveAccountContext();

	await assert.rejects(
		Promise.resolve(
			mock.commands.get("accounts")?.handler("switch anthropic work", interactive.ctx),
		),
		/Usage: \/accounts/,
	);
	assert.equal(interactive.selectCalls.length, 0);
});

test("accounts empty state offers login and manager actions", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const { registry } = runtimeHarness(mock);
	const { ctx, selectCalls } = createInteractiveAccountContext(
		{ model: { provider: "anthropic", id: "claude" }, modelRegistry: registry },
		{ selections: [] },
	);

	await mock.commands.get("accounts")?.handler("", ctx);

	assert.match(selectCalls[0]?.title ?? "", /No saved accounts yet/);
	assert.deepEqual(selectCalls[0]?.options, ["Login new account", "Settings", "Status", "Help"]);
});

test("accounts menu summarizes all supported providers and prioritizes current provider switch", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			anthropic: {
				active: "work",
				accounts: { personal: credential("personal"), work: credential("work") },
			},
			"openai-codex": { accounts: { codex: credential("codex") } },
		},
	});
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const { registry } = runtimeHarness(mock);
	const { ctx, selectCalls } = createInteractiveAccountContext({
		model: { provider: "anthropic", id: "claude" },
		modelRegistry: registry,
	});

	await mock.commands.get("accounts")?.handler("", ctx);

	assert.match(selectCalls[0]?.title ?? "", /Current model:\nAnthropic \/ claude/);
	assert.match(selectCalls[0]?.title ?? "", /Anthropic: work/);
	assert.match(selectCalls[0]?.title ?? "", /OpenAI Codex: default/);
	assert.match(selectCalls[0]?.title ?? "", /GitHub Copilot: default/);
	assert.deepEqual(selectCalls[0]?.options, [
		"Switch Anthropic account",
		"Login new account",
		"Remove account",
		"Switch another provider’s account",
		"Settings",
		"Status",
		"Help",
	]);
});

test("accounts menu prioritizes login when the current provider has no saved accounts", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: { "openai-codex": { accounts: { codex: credential("codex") } } },
	});
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const { registry } = runtimeHarness(mock);
	const { ctx, selectCalls } = createInteractiveAccountContext({
		model: { provider: "anthropic", id: "claude" },
		modelRegistry: registry,
	});

	await mock.commands.get("accounts")?.handler("", ctx);

	assert.deepEqual(selectCalls[0]?.options, [
		"Login new account",
		"Switch another provider’s account",
		"Remove account",
		"Settings",
		"Status",
		"Help",
	]);
});

test("accounts menu uses generic provider switch for unsupported current models", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: { anthropic: { accounts: { work: credential("work") } } },
	});
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const { registry } = runtimeHarness(mock);
	const { ctx, selectCalls } = createInteractiveAccountContext({
		model: { provider: "google", id: "gemini" },
		modelRegistry: registry,
	});

	await mock.commands.get("accounts")?.handler("", ctx);

	assert.deepEqual(selectCalls[0]?.options, [
		"Login new account",
		"Switch provider account",
		"Remove account",
		"Settings",
		"Status",
		"Help",
	]);
});

test("switch another provider account selects provider before account", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: { "openai-codex": { accounts: { work: credential("codex") } } },
	});
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const { registry, keys } = runtimeHarness(mock);
	const { ctx, selectCalls } = createInteractiveAccountContext(
		{
			model: { provider: "anthropic", id: "claude" },
			modelRegistry: registry,
		},
		{ selections: ["Switch another provider’s account", "OpenAI Codex", "work"] },
	);

	await mock.commands.get("accounts")?.handler("", ctx);

	assert.equal((await store.readProviderAsync("openai-codex")).active, "work");
	assert.equal(keys.get("openai-codex"), "access-codex");
	assert.deepEqual(selectCalls[1]?.options, ["OpenAI Codex"]);
});

test("provider accounts activate independently and default clears only one provider", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"openai-codex": { active: "personal", accounts: { personal: credential("codex") } },
			anthropic: { active: "work", accounts: { work: credential("claude") } },
		},
	});
	const mock = createMockPi();
	const providers = [
		fakeProvider("openai-codex"),
		fakeProvider("anthropic"),
		fakeProvider("github-copilot"),
	];
	accountsExtension(mock.pi, { store, providers });
	const { registry, keys } = runtimeHarness(mock);
	const { ctx, notifications } = createInteractiveAccountContext(
		{
			model: { provider: "anthropic", id: "claude" },
			modelRegistry: registry,
		},
		{ selections: ["Switch Anthropic account", "default"] },
	);

	await mock.events.get("session_start")?.[0]?.({}, ctx);
	assert.equal(keys.get("openai-codex"), "access-codex");
	assert.equal(keys.get("anthropic"), "access-claude");

	await mock.commands.get("accounts")?.handler("", ctx);
	const data = await store.readAsync();
	assert.equal(data.providers.anthropic?.active, undefined);
	assert.equal(data.providers["openai-codex"]?.active, "personal");
	assert.equal(keys.has("anthropic"), false);
	assert.equal(keys.get("openai-codex"), "access-codex");
	assert.match(notifications.at(-1)?.message ?? "", /default Pi Anthropic login/);
});

test("default Codex auth does not invalidate connections on first observation", async () => {
	const invalidations: Array<string | undefined> = [];
	const codex = fakeProvider("openai-codex");
	codex.invalidateConnections = (sessionId) => {
		invalidations.push(sessionId);
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store: new AccountStore(new InMemoryAccountStorageBackend()),
		providers: [codex, fakeProvider("anthropic"), fakeProvider("github-copilot")],
	});
	const { registry } = runtimeHarness(mock);
	const { ctx } = createMockContext({
		model: { provider: "openai-codex", id: "codex" },
		modelRegistry: registry,
	});

	await mock.events.get("session_start")?.[0]?.({}, ctx);
	assert.deepEqual(invalidations, []);
});

test("Codex connections invalidate only when the applied account identity changes", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"openai-codex": { active: "work", accounts: { work: credential("codex") } },
		},
	});
	const invalidations: Array<string | undefined> = [];
	const codex = fakeProvider("openai-codex");
	codex.invalidateConnections = (sessionId) => {
		invalidations.push(sessionId);
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [codex, fakeProvider("anthropic"), fakeProvider("github-copilot")],
	});
	const { registry } = runtimeHarness(mock);
	const sessionManager = {
		getSessionId: () => "test-session",
		getSessionName: () => undefined,
		getBranch: () => [],
		getEntries: () => [],
	};
	const { ctx } = createMockContext({
		model: { provider: "openai-codex", id: "codex" },
		modelRegistry: registry,
		sessionManager,
	});

	await mock.events.get("session_start")?.[0]?.({}, ctx);
	await mock.events.get("before_agent_start")?.[0]?.({}, ctx);
	assert.deepEqual(invalidations, ["test-session"]);
	const switchContext = createInteractiveAccountContext(
		{
			model: { provider: "openai-codex", id: "codex" },
			modelRegistry: registry,
			sessionManager,
		},
		{ selections: ["Switch OpenAI Codex account", "default"] },
	).ctx;
	await mock.commands.get("accounts")?.handler("", switchContext);
	assert.deepEqual(invalidations, ["test-session", "test-session"]);
});

test("an older overlapping provider sync cannot publish stale inactive state", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"openai-codex": { active: "work", accounts: { work: credential("codex") } },
		},
	});
	let releaseFirst: (() => void) | undefined;
	const firstBlocked = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	let signalFirst: (() => void) | undefined;
	const firstStarted = new Promise<void>((resolve) => {
		signalFirst = resolve;
	});
	let conversions = 0;
	const invalidations: Array<string | undefined> = [];
	const codex = fakeProvider("openai-codex");
	codex.oauth.toAuth = async (current) => {
		conversions += 1;
		if (conversions === 1) {
			signalFirst?.();
			await firstBlocked;
			throw new Error("obsolete conversion failed");
		}
		return { apiKey: current.access };
	};
	codex.invalidateConnections = (sessionId) => {
		invalidations.push(sessionId);
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [codex, fakeProvider("anthropic"), fakeProvider("github-copilot")],
	});
	const { registry, keys } = runtimeHarness(mock);
	const { ctx, statuses } = createMockContext({
		model: { provider: "openai-codex", id: "codex" },
		modelRegistry: registry,
	});

	const older = mock.events.get("session_start")?.[0]?.({}, ctx);
	await firstStarted;
	await mock.events.get("before_agent_start")?.[0]?.({}, ctx);
	releaseFirst?.();
	await older;

	assert.equal(keys.get("openai-codex"), "access-codex");
	assert.equal(statuses.get(ACCOUNTS_STATUS_KEY), "account:work");
	assert.deepEqual(invalidations, ["test-session"]);
});

test("an obsolete invalidation failure cannot fail closed a newer successful sync", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"openai-codex": { active: "work", accounts: { work: credential("codex") } },
		},
	});
	const originalRead = store.readProviderAsync.bind(store);
	let reads = 0;
	let releaseObsoleteRead: (() => void) | undefined;
	const obsoleteReadBlocked = new Promise<void>((resolve) => {
		releaseObsoleteRead = resolve;
	});
	let signalObsoleteRead: (() => void) | undefined;
	const obsoleteReadStarted = new Promise<void>((resolve) => {
		signalObsoleteRead = resolve;
	});
	store.readProviderAsync = async (providerId) => {
		reads += 1;
		if (reads === 4) {
			signalObsoleteRead?.();
			await obsoleteReadBlocked;
		}
		return originalRead(providerId);
	};
	let invalidations = 0;
	const codex = fakeProvider("openai-codex");
	codex.invalidateConnections = () => {
		invalidations += 1;
		if (invalidations === 1) throw new Error("obsolete cleanup failed");
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [codex, fakeProvider("anthropic"), fakeProvider("github-copilot")],
	});
	const { registry, keys } = runtimeHarness(mock);
	const { ctx, statuses } = createMockContext({
		model: { provider: "openai-codex", id: "codex" },
		modelRegistry: registry,
	});

	const older = mock.events.get("session_start")?.[0]?.({}, ctx);
	await obsoleteReadStarted;
	await mock.events.get("before_agent_start")?.[0]?.({}, ctx);
	releaseObsoleteRead?.();
	await older;

	assert.equal(keys.get("openai-codex"), "access-codex");
	assert.equal(statuses.get(ACCOUNTS_STATUS_KEY), "account:work");
});

test("connection invalidation failure replaces active Codex auth with fail-closed state", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"openai-codex": { active: "work", accounts: { work: credential("codex") } },
		},
	});
	const codex = fakeProvider("openai-codex");
	codex.invalidateConnections = () => {
		throw new Error("socket cleanup failed");
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [codex, fakeProvider("anthropic"), fakeProvider("github-copilot")],
	});
	const { registry, keys } = runtimeHarness(mock);
	const { ctx, statuses } = createMockContext({
		model: { provider: "openai-codex", id: "codex" },
		modelRegistry: registry,
	});

	await mock.events.get("session_start")?.[0]?.({}, ctx);
	assert.equal(keys.get("openai-codex"), FAIL_CLOSED_API_KEY);
	assert.match(statuses.get(ACCOUNTS_STATUS_KEY) ?? "", /auth error/);
});

test("generic login stores the full provider-owned credential and activates it", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const { registry, keys } = runtimeHarness(mock);
	const { ctx } = createInteractiveAccountContext(
		{
			model: { provider: "github-copilot", id: "allowed" },
			modelRegistry: registry,
		},
		{ selections: ["Login new account", "GitHub Copilot"], inputs: ["personal"] },
	);

	await mock.commands.get("accounts")?.handler("", ctx);
	const stored = (await store.readAsync()).providers["github-copilot"];
	assert.equal(stored?.active, "personal");
	assert.deepEqual(stored?.accounts.personal?.availableModelIds, ["allowed"]);
	assert.equal(keys.get("github-copilot"), "access-login-github-copilot");
});

test("session shutdown aborts idle OAuth login before stale credentials can publish", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	let loginStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		loginStarted = resolve;
	});
	let loginSignal: AbortSignal | undefined;
	const copilot = fakeProvider("github-copilot");
	copilot.oauth.login = async (interaction) => {
		loginSignal = interaction.signal;
		loginStarted();
		if (!loginSignal) throw new Error("Missing OAuth login signal");
		await new Promise<void>((resolve) => {
			if (loginSignal?.aborted) resolve();
			else loginSignal?.addEventListener("abort", () => resolve(), { once: true });
		});
		return credential("stale");
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [fakeProvider("openai-codex"), fakeProvider("anthropic"), copilot],
	});
	const { registry } = runtimeHarness(mock);
	const { ctx } = createInteractiveAccountContext(
		{
			model: { provider: "github-copilot", id: "allowed" },
			modelRegistry: registry,
		},
		{ selections: ["Login new account", "GitHub Copilot"], inputs: ["personal"] },
	);

	const login = mock.commands.get("accounts")?.handler("", ctx);
	await started;
	await mock.events.get("session_shutdown")?.[0]?.({}, ctx);
	await login;

	assert.ok(loginSignal);
	assert.equal(loginSignal.aborted, true);
	const state = await store.readProviderAsync("github-copilot");
	assert.equal(state.active, undefined);
	assert.deepEqual(Object.keys(state.accounts), []);
});

test("login rejects default as a reserved account name", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const { registry } = runtimeHarness(mock);
	const { ctx, notifications } = createInteractiveAccountContext(
		{ model: { provider: "anthropic", id: "claude" }, modelRegistry: registry },
		{ selections: ["Login new account", "Anthropic"], inputs: ["default"] },
	);

	await mock.commands.get("accounts")?.handler("", ctx);

	assert.equal((await store.readProviderAsync("anthropic")).accounts.default, undefined);
	assert.match(notifications.at(-1)?.message ?? "", /reserved/);
});

test("login asks before replacing an existing account name", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: { anthropic: { active: "work", accounts: { work: credential("old") } } },
	});
	let logins = 0;
	const anthropic = fakeProvider("anthropic");
	anthropic.oauth.login = async () => {
		logins += 1;
		return credential("new");
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [fakeProvider("openai-codex"), anthropic, fakeProvider("github-copilot")],
	});
	const { registry } = runtimeHarness(mock);
	const cancelled = createInteractiveAccountContext(
		{ model: { provider: "anthropic", id: "claude" }, modelRegistry: registry },
		{ selections: ["Login new account", "Anthropic"], inputs: ["work"], confirms: [false] },
	);

	await mock.commands.get("accounts")?.handler("", cancelled.ctx);
	assert.equal(logins, 0);
	assert.equal((await store.readProviderAsync("anthropic")).accounts.work?.access, "access-old");
	assert.match(cancelled.confirmCalls[0]?.message ?? "", /already exists/);

	const replaced = createInteractiveAccountContext(
		{ model: { provider: "anthropic", id: "claude" }, modelRegistry: registry },
		{ selections: ["Login new account", "Anthropic"], inputs: ["work"], confirms: [true] },
	);
	await mock.commands.get("accounts")?.handler("", replaced.ctx);
	assert.equal(logins, 1);
	assert.equal((await store.readProviderAsync("anthropic")).accounts.work?.access, "access-new");
});

test("login selects a provider default model only when the current model is unknown", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	const codex = fakeProvider("openai-codex");
	codex.defaultModelId = "codex";
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [codex, fakeProvider("anthropic"), fakeProvider("github-copilot")],
	});
	const { registry } = runtimeHarness(mock);
	const { ctx } = createInteractiveAccountContext(
		{
			model: { provider: "unknown", id: "unknown", api: "unknown" },
			modelRegistry: registry,
		},
		{ selections: ["Login new account", "OpenAI Codex"], inputs: ["work"] },
	);

	await mock.commands.get("accounts")?.handler("", ctx);

	assert.equal(mock.setModels.length, 1);
});

test("providers without account-specific overlays leave existing registrations untouched", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			anthropic: { active: "work", accounts: { work: credential("claude") } },
		},
	});
	const mock = createMockPi();
	mock.rawPi.registerProvider("anthropic", { headers: { Existing: "yes" } });
	const registrationsBefore = mock.providerRegistrations.length;
	const coordinator = new RuntimeAuthCoordinator(mock.pi, fakeProvider("anthropic"));
	const { registry } = runtimeHarness(mock);
	const { ctx } = createMockContext({ modelRegistry: registry });

	assert.equal((await coordinator.ensureActive(ctx, store)).status, "active");
	assert.equal(mock.providerRegistrations.length, registrationsBefore);
	assert.deepEqual(mock.providers.get("anthropic"), { headers: { Existing: "yes" } });
});

test("GitHub Copilot activation applies its endpoint and available model projection, then restores config", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"github-copilot": {
				active: "enterprise",
				accounts: {
					enterprise: credential("copilot", {
						enterpriseUrl: "github.example.com",
						availableModelIds: ["allowed"],
					}),
				},
			},
		},
	});
	const mock = createMockPi();
	mock.rawPi.registerProvider("github-copilot", { headers: { Existing: "yes" } });
	const provider = fakeProvider("github-copilot", {
		baseUrl: "https://copilot-api.github.example.com",
		headers: { Account: "enterprise" },
	});
	const coordinator = new RuntimeAuthCoordinator(mock.pi, provider);
	const { registry, keys } = runtimeHarness(mock);
	const { ctx } = createMockContext({ modelRegistry: registry });

	const result = await coordinator.ensureActive(ctx, store);
	assert.deepEqual(result, {
		status: "active",
		providerId: "github-copilot",
		accountName: "enterprise",
	});
	assert.equal(keys.get("github-copilot"), "access-copilot");
	const projected = mock.providers.get("github-copilot") as {
		headers: Record<string, string>;
		baseUrl: string;
		models: Array<{ id: string }>;
	};
	assert.deepEqual(projected.headers, { Existing: "yes", Account: "enterprise" });
	assert.equal(projected.baseUrl, "https://copilot-api.github.example.com");
	assert.deepEqual(
		projected.models.map((model) => model.id),
		["allowed"],
	);

	await store.updateProvider("github-copilot", (state) => ({ ...state, active: undefined }));
	await coordinator.ensureActive(ctx, store);
	assert.deepEqual(mock.providers.get("github-copilot"), { headers: { Existing: "yes" } });
	assert.equal(keys.has("github-copilot"), false);
});

test("Copilot account switches rebuild model filtering from the complete pre-overlay catalog", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"github-copilot": {
				active: "first",
				accounts: {
					first: credential("first", { availableModelIds: ["allowed"] }),
					second: credential("second", { availableModelIds: ["blocked"] }),
				},
			},
		},
	});
	const mock = createMockPi();
	const provider = fakeProvider("github-copilot", { baseUrl: "https://api.copilot.example" });
	const coordinator = new RuntimeAuthCoordinator(mock.pi, provider);
	const { registry } = runtimeHarness(mock);
	const { ctx } = createMockContext({ modelRegistry: registry });

	await coordinator.ensureActive(ctx, store);
	assert.deepEqual(
		(mock.providers.get("github-copilot") as { models: Array<{ id: string }> }).models.map(
			(model) => model.id,
		),
		["allowed"],
	);
	await store.updateProvider("github-copilot", (state) => ({ ...state, active: "second" }));
	await coordinator.ensureActive(ctx, store);
	assert.deepEqual(
		(mock.providers.get("github-copilot") as { models: Array<{ id: string }> }).models.map(
			(model) => model.id,
		),
		["blocked"],
	);
});

test("unsafe provider endpoints and malformed model metadata fail closed", async () => {
	for (const mode of ["endpoint", "models"] as const) {
		const store = new AccountStore(new InMemoryAccountStorageBackend());
		await store.write({
			version: 1,
			providers: {
				"github-copilot": {
					active: "work",
					accounts: {
						work: credential("copilot", {
							...(mode === "models" ? { availableModelIds: [1] } : {}),
						}),
					},
				},
			},
		});
		const provider = fakeProvider("github-copilot", {
			baseUrl: mode === "endpoint" ? "http://token-stealer.invalid" : undefined,
		});
		const mock = createMockPi();
		const coordinator = new RuntimeAuthCoordinator(mock.pi, provider);
		const { registry, keys } = runtimeHarness(mock);
		const { ctx } = createMockContext({ modelRegistry: registry });

		assert.equal((await coordinator.ensureActive(ctx, store)).status, "error");
		assert.equal(keys.get("github-copilot"), FAIL_CLOSED_API_KEY);
	}
});

test("invalid refreshed credentials fail closed instead of escaping storage validation", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			anthropic: {
				active: "work",
				accounts: { work: { ...credential("expired"), expires: 1 } },
			},
		},
	});
	const provider = fakeProvider("anthropic");
	provider.oauth.refresh = async () => ({
		type: "oauth",
		access: "",
		refresh: "rotated-secret",
		expires: Date.now() + 60_000,
	});
	const mock = createMockPi();
	const coordinator = new RuntimeAuthCoordinator(mock.pi, provider);
	const { registry, keys } = runtimeHarness(mock);
	const { ctx } = createMockContext({ modelRegistry: registry });

	const result = await coordinator.ensureActive(ctx, store);
	assert.equal(result.status, "error");
	assert.equal(keys.get("anthropic"), FAIL_CLOSED_API_KEY);
	assert.equal(
		(await store.readProviderAsync("anthropic")).accounts.work?.access,
		"access-expired",
	);
});

test("fail-closed runtime keys are attempted even when a provider overlay is rejected", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"openai-codex": {
				active: "work",
				accounts: { work: credential("codex") },
			},
		},
	});
	const mock = createMockPi();
	const pi = {
		...mock.rawPi,
		registerProvider() {
			throw new Error("overlay rejected");
		},
	} as never;
	const coordinator = new RuntimeAuthCoordinator(pi, fakeProvider("openai-codex"));
	const { registry, keys } = runtimeHarness(mock);
	const { ctx } = createMockContext({ modelRegistry: registry });

	const result = await coordinator.ensureActive(ctx, store);
	assert.equal(result.status, "error");
	assert.equal(keys.get("openai-codex"), FAIL_CLOSED_API_KEY);
});

test("refresh and auth derivation failures fail closed, redact secrets, and abort only the affected provider", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			anthropic: { active: "work", accounts: { work: credential("secret") } },
		},
	});
	const failing = fakeProvider("anthropic");
	failing.oauth.toAuth = async (current) => {
		throw new Error(`bad ${current.access} and ${current.refresh}`);
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [fakeProvider("openai-codex"), failing, fakeProvider("github-copilot")],
	});
	const { registry, keys } = runtimeHarness(mock);
	let aborts = 0;
	const { ctx, statuses } = createMockContext({
		model: { provider: "anthropic", id: "claude" },
		modelRegistry: registry,
		abort: () => {
			aborts += 1;
		},
	});

	await mock.events.get("before_agent_start")?.[0]?.({}, ctx);
	assert.equal(keys.get("anthropic"), FAIL_CLOSED_API_KEY);
	assert.match(statuses.get(ACCOUNTS_STATUS_KEY) ?? "", /auth error/);
	assert.doesNotMatch(statuses.get(ACCOUNTS_STATUS_KEY) ?? "", /access-secret|refresh-secret/);
	await mock.events.get("turn_start")?.[0]?.({}, ctx);
	assert.equal(aborts, 1);

	const other = createMockContext({
		model: { provider: "openai-codex", id: "codex" },
		modelRegistry: registry,
		abort: () => {
			aborts += 1;
		},
	}).ctx;
	await mock.events.get("turn_start")?.[0]?.({}, other);
	assert.equal(aborts, 1);
});

test("account reset during OAuth conversion cannot restore a stale runtime override", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			anthropic: { active: "work", accounts: { work: credential("claude") } },
		},
	});
	let releaseConversion: (() => void) | undefined;
	const conversionBlocked = new Promise<void>((resolve) => {
		releaseConversion = resolve;
	});
	let signalConversion: (() => void) | undefined;
	const conversionStarted = new Promise<void>((resolve) => {
		signalConversion = resolve;
	});
	const anthropic = fakeProvider("anthropic");
	anthropic.oauth.toAuth = async (current) => {
		signalConversion?.();
		await conversionBlocked;
		return { apiKey: current.access };
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [fakeProvider("openai-codex"), anthropic, fakeProvider("github-copilot")],
	});
	const { registry, keys } = runtimeHarness(mock);
	const sessionManager = {
		getSessionId: () => "test-session",
		getSessionName: () => undefined,
		getBranch: () => [],
		getEntries: () => [],
	};
	const { ctx } = createMockContext({
		model: { provider: "anthropic", id: "claude" },
		modelRegistry: registry,
		sessionManager,
	});

	const startup = mock.events.get("session_start")?.[0]?.({}, ctx);
	await conversionStarted;
	const resetContext = createInteractiveAccountContext(
		{
			model: { provider: "anthropic", id: "claude" },
			modelRegistry: registry,
			sessionManager,
		},
		{ selections: ["Switch Anthropic account", "default"] },
	).ctx;
	const reset = mock.commands.get("accounts")?.handler("", resetContext);
	releaseConversion?.();
	await Promise.all([startup, reset]);
	assert.equal((await store.readProviderAsync("anthropic")).active, undefined);
	assert.equal(keys.has("anthropic"), false);
});

test("an overlapping account switch reports when its requested account was superseded", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			"openai-codex": {
				accounts: { alpha: credential("alpha"), beta: credential("beta") },
			},
		},
	});
	let releaseAlpha: (() => void) | undefined;
	const alphaBlocked = new Promise<void>((resolve) => {
		releaseAlpha = resolve;
	});
	let signalAlpha: (() => void) | undefined;
	const alphaStarted = new Promise<void>((resolve) => {
		signalAlpha = resolve;
	});
	const codex = fakeProvider("openai-codex");
	codex.oauth.toAuth = async (current) => {
		if (current.access === "access-alpha") {
			signalAlpha?.();
			await alphaBlocked;
		}
		return { apiKey: current.access };
	};
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [codex, fakeProvider("anthropic"), fakeProvider("github-copilot")],
	});
	const { registry } = runtimeHarness(mock);
	const olderContext = createInteractiveAccountContext(
		{
			model: { provider: "openai-codex", id: "codex" },
			modelRegistry: registry,
		},
		{ selections: ["Switch OpenAI Codex account", "alpha"] },
	);
	const newerContext = createInteractiveAccountContext(
		{
			model: { provider: "openai-codex", id: "codex" },
			modelRegistry: registry,
		},
		{ selections: ["Switch OpenAI Codex account", "beta"] },
	);

	const older = mock.commands.get("accounts")?.handler("", olderContext.ctx);
	await alphaStarted;
	await mock.commands.get("accounts")?.handler("", newerContext.ctx);
	releaseAlpha?.();
	await older;

	assert.equal((await store.readProviderAsync("openai-codex")).active, "beta");
	assert.match(olderContext.notifications.at(-1)?.message ?? "", /alpha.*superseded/);
});

test("remove account confirms and active removal restores default provider auth", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		providers: {
			anthropic: {
				active: "work",
				accounts: { personal: credential("personal"), work: credential("work") },
			},
			"openai-codex": { accounts: { codex: credential("codex") } },
		},
	});
	const mock = createMockPi();
	accountsExtension(mock.pi, {
		store,
		providers: [
			fakeProvider("openai-codex"),
			fakeProvider("anthropic"),
			fakeProvider("github-copilot"),
		],
	});
	const { registry, keys } = runtimeHarness(mock);
	const { ctx, confirmCalls } = createInteractiveAccountContext(
		{
			model: { provider: "anthropic", id: "claude" },
			modelRegistry: registry,
		},
		{ selections: ["Remove account", "Anthropic · work"], confirms: [true] },
	);

	await mock.events.get("session_start")?.[0]?.({}, ctx);
	assert.equal(keys.get("anthropic"), "access-work");
	await mock.commands.get("accounts")?.handler("", ctx);

	const state = await store.readProviderAsync("anthropic");
	assert.equal(state.active, undefined);
	assert.equal(state.accounts.work, undefined);
	assert.equal(state.accounts.personal?.access, "access-personal");
	assert.equal(keys.has("anthropic"), false);
	assert.match(confirmCalls[0]?.message ?? "", /Remove Anthropic account "work"/);
});
