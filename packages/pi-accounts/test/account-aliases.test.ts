import assert from "node:assert/strict";
import type {
	Api,
	AssistantMessage,
	Context,
	DeferredHandle,
	Model,
	Provider,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { createAccountAliasProvider, createAccountAliasRuntime } from "../src/account-aliases.js";
import { AccountStore, type StoredOAuthCredential } from "../src/account-store.js";
import type { AccountProviderAdapter } from "../src/oauth.js";
import { InMemoryAccountStorageBackend } from "../src/storage.js";

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

function adapter(id: AccountProviderAdapter["id"]): AccountProviderAdapter {
	return {
		id,
		displayName:
			id === "openai-codex" ? "OpenAI Codex" : id === "anthropic" ? "Anthropic" : "GitHub Copilot",
		requiresApiKeyBridge: id === "openai-codex",
		oauth: {
			async login() {
				return credential("login");
			},
			async refresh(current) {
				return { ...current, access: `${current.access}-refreshed`, expires: Date.now() + 60_000 };
			},
			async toAuth(current) {
				return { apiKey: current.access };
			},
		},
	};
}

function model(provider: string, id = "model"): Model<"openai-responses"> {
	return {
		id,
		name: id,
		api: "openai-responses",
		provider,
		baseUrl: "https://example.test/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
	};
}

function assistant(provider: string, modelId = "model"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: "openai-responses",
		provider,
		model: modelId,
		responseId: "response-1",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function baseProvider(
	id: AccountProviderAdapter["id"],
	overrides: Partial<Provider> = {},
): Provider {
	const baseModel = model(id);
	return {
		id,
		name: adapter(id).displayName,
		baseUrl: baseModel.baseUrl,
		auth: {
			apiKey: {
				name: "test",
				async resolve() {
					return { auth: { apiKey: "unused" } };
				},
			},
		},
		getModels: () => [baseModel],
		stream: (_model, _context, options) => completedStream(id, options),
		streamSimple: (_model, _context, options) => completedStream(id, options),
		...overrides,
	};
}

function completedStream(provider: string, options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	void (async () => {
		const output = assistant(provider);
		await options?.onPayload?.({ prompt: "test" }, model(provider));
		stream.push({ type: "start", partial: output });
		stream.push({ type: "done", reason: "stop", message: output });
		stream.end();
	})();
	return stream;
}

async function enabledStore(
	providerId: AccountProviderAdapter["id"] = "openai-codex",
	accountName = "work",
	storedCredential = credential("work"),
): Promise<AccountStore> {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		settings: { accountProviderAliases: true },
		providers: {
			[providerId]: { accounts: { [accountName]: storedCredential } },
		},
	});
	return store;
}

test("alias providers preserve model metadata and map stream identity without mutating context", async () => {
	const store = await enabledStore();
	let delegatedModel: Model<Api> | undefined;
	let delegatedContext: Context | undefined;
	let callbackProvider: string | undefined;
	const base = baseProvider("openai-codex", {
		streamSimple(baseModel, context, options) {
			delegatedModel = baseModel;
			delegatedContext = context;
			return completedStream("openai-codex", options);
		},
	});
	const alias = createAccountAliasProvider({
		binding: {
			aliasId: "openai-codex-work",
			providerId: "openai-codex",
			accountName: "work",
		},
		base,
		adapter: adapter("openai-codex"),
		store,
	});
	const aliasModel = alias.getModels()[0];
	assert.ok(aliasModel);
	assert.match(alias.auth.apiKey?.name ?? "", /manage it with \/accounts/);
	assert.equal(alias.auth.apiKey?.login, undefined);
	assert.equal(aliasModel.provider, "openai-codex-work");
	assert.equal(aliasModel.cost.input, 1);
	const previous = assistant("openai-codex-work");
	const foreign = assistant("openai-codex-personal");
	const context: Context = { messages: [previous, foreign] };

	const result = await alias
		.streamSimple(aliasModel, context, {
			apiKey: "access-work",
			onPayload: (_payload, requestModel) => {
				callbackProvider = requestModel.provider;
			},
		})
		.result();

	assert.equal(delegatedModel?.provider, "openai-codex");
	assert.equal(
		(delegatedContext?.messages[0] as AssistantMessage | undefined)?.provider,
		"openai-codex",
	);
	assert.equal(
		(delegatedContext?.messages[1] as AssistantMessage | undefined)?.provider,
		"openai-codex-personal",
	);
	assert.equal(previous.provider, "openai-codex-work");
	assert.equal(foreign.provider, "openai-codex-personal");
	assert.equal(callbackProvider, "openai-codex-work");
	assert.equal(result.provider, "openai-codex-work");
	assert.equal(result.responseId, "response-1");
});

test("alias providers map deferred handles in both directions", async () => {
	const store = await enabledStore();
	let fetchedHandle: DeferredHandle | undefined;
	let cancelledHandle: DeferredHandle | undefined;
	const base = baseProvider("openai-codex", {
		fetchDeferred(_model, handle, options) {
			fetchedHandle = handle;
			const stream = completedStream("openai-codex", options);
			return stream;
		},
		async cancelDeferred(_model, handle) {
			cancelledHandle = handle;
		},
	});
	const alias = createAccountAliasProvider({
		binding: {
			aliasId: "openai-codex-work",
			providerId: "openai-codex",
			accountName: "work",
		},
		base,
		adapter: adapter("openai-codex"),
		store,
	});
	const aliasModel = alias.getModels()[0];
	assert.ok(aliasModel && alias.fetchDeferred && alias.cancelDeferred);
	const handle: DeferredHandle = {
		provider: "openai-codex-work",
		modelId: aliasModel.id,
		api: aliasModel.api,
		id: "deferred-1",
	};
	const result = await alias.fetchDeferred(aliasModel, handle, { apiKey: "access-work" }).result();
	await alias.cancelDeferred(aliasModel, handle, { apiKey: "access-work" });

	assert.equal(fetchedHandle?.provider, "openai-codex");
	assert.equal(cancelledHandle?.provider, "openai-codex");
	assert.equal(result.provider, "openai-codex-work");
});

test("alias lease cancellation reaches an in-flight delegated stream", async () => {
	const store = await enabledStore();
	const lease = new AbortController();
	let delegatedSignal: AbortSignal | undefined;
	let markDelegated: () => void = () => undefined;
	const delegated = new Promise<void>((resolve) => {
		markDelegated = resolve;
	});
	const base = baseProvider("openai-codex", {
		streamSimple(_model, _context, options) {
			delegatedSignal = options?.signal;
			markDelegated();
			const stream = createAssistantMessageEventStream();
			const output = assistant("openai-codex");
			options?.signal?.addEventListener(
				"abort",
				() => {
					output.stopReason = "aborted";
					output.errorMessage = "cancelled";
					stream.push({ type: "error", reason: "aborted", error: output });
					stream.end();
				},
				{ once: true },
			);
			return stream;
		},
	});
	const alias = createAccountAliasProvider({
		binding: {
			aliasId: "openai-codex-work",
			providerId: "openai-codex",
			accountName: "work",
		},
		base,
		adapter: adapter("openai-codex"),
		store,
		lease,
	});
	const aliasModel = alias.getModels()[0];
	assert.ok(aliasModel);
	const result = alias
		.streamSimple(aliasModel, { messages: [] }, { apiKey: "access-work" })
		.result();
	await delegated;
	lease.abort();

	assert.equal(delegatedSignal?.aborted, true);
	assert.equal((await result).stopReason, "aborted");
});

test("named alias auth refreshes one expired credential once under concurrent requests", async () => {
	const expired = credential("expired", { expires: Date.now() - 1 });
	const store = await enabledStore("anthropic", "work", expired);
	let refreshes = 0;
	const accountAdapter = adapter("anthropic");
	accountAdapter.oauth.refresh = async (current, signal) => {
		refreshes += 1;
		signal?.throwIfAborted();
		return credential("fresh", { refresh: current.refresh });
	};
	const alias = createAccountAliasProvider({
		binding: { aliasId: "anthropic-work", providerId: "anthropic", accountName: "work" },
		base: baseProvider("anthropic"),
		adapter: accountAdapter,
		store,
	});
	const resolve = alias.auth.apiKey?.resolve;
	assert.ok(resolve);
	const input = {
		ctx: { env: async () => undefined, fileExists: async () => false },
		credential: undefined as undefined,
		signal: new AbortController().signal,
	};

	const [first, second] = await Promise.all([resolve(input), resolve(input)]);

	assert.equal(refreshes, 1);
	assert.equal(first?.auth.apiKey, "access-fresh");
	assert.equal(second?.auth.apiKey, "access-fresh");
	assert.equal((await store.readProviderAsync("anthropic")).accounts.work?.access, "access-fresh");
});

test("alias auth errors redact exact credential secrets", async () => {
	const secret = credential("secret", {
		access: "TOP-SECRET-ACCESS-VALUE",
		refresh: "TOP-SECRET-REFRESH-VALUE",
	});
	const store = await enabledStore("anthropic", "work", secret);
	const accountAdapter = adapter("anthropic");
	accountAdapter.oauth.toAuth = async (current) => {
		throw new Error(`conversion exposed ${current.access} and ${current.refresh}`);
	};
	const alias = createAccountAliasProvider({
		binding: { aliasId: "anthropic-work", providerId: "anthropic", accountName: "work" },
		base: baseProvider("anthropic"),
		adapter: accountAdapter,
		store,
	});
	const resolve = alias.auth.apiKey?.resolve;
	assert.ok(resolve);

	await assert.rejects(
		resolve({
			ctx: { env: async () => undefined, fileExists: async () => false },
			signal: new AbortController().signal,
		}),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.doesNotMatch(error.message, /TOP-SECRET/);
			assert.match(error.message, /<redacted>/);
			return true;
		},
	);
});

test("alias auth and entitlement checks fail closed without another credential", async () => {
	const store = await enabledStore(
		"github-copilot",
		"enterprise",
		credential("enterprise", {
			availableModelIds: ["allowed"],
		}),
	);
	const alias = createAccountAliasProvider({
		binding: {
			aliasId: "github-copilot-enterprise",
			providerId: "github-copilot",
			accountName: "enterprise",
		},
		base: baseProvider("github-copilot", {
			getModels: () => [model("github-copilot", "allowed"), model("github-copilot", "blocked")],
		}),
		adapter: adapter("github-copilot"),
		store,
	});
	const auth = alias.auth.apiKey;
	const check = auth?.check;
	const filterModels = alias.filterModels;
	assert.ok(check && auth && filterModels);
	await check({
		ctx: { env: async () => undefined, fileExists: async () => false },
		signal: new AbortController().signal,
	});
	assert.deepEqual(
		filterModels(alias.getModels(), undefined).map((entry) => entry.id),
		["allowed"],
	);
	await store.updateProvider("github-copilot", (state) => ({ ...state, accounts: {} }));
	assert.equal(
		await auth.resolve({
			ctx: { env: async () => "ambient-must-not-be-used", fileExists: async () => false },
			signal: new AbortController().signal,
		}),
		undefined,
	);
});

test("runtime reconciliation adds, replaces, and removes account aliases immediately", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		settings: { accountProviderAliases: true },
		providers: {},
	});
	const mock = createMockPi();
	const runtime = await createAccountAliasRuntime({
		pi: mock.pi,
		store,
		providers: [adapter("openai-codex"), adapter("anthropic"), adapter("github-copilot")],
		loadBuiltinProviders: async () => [
			baseProvider("openai-codex"),
			baseProvider("anthropic"),
			baseProvider("github-copilot"),
		],
	});
	await runtime.initializeFactory(store.read());
	const availableModels = () =>
		[...mock.providers.values()].flatMap((provider) =>
			typeof (provider as Provider).getModels === "function"
				? (provider as Provider).getModels()
				: [],
		);
	const registry = {
		getRegisteredNativeProvider: (id: string) => mock.providers.get(id) as Provider | undefined,
		getRegisteredProviderConfig: () => undefined,
		getRegisteredProviderIds: () => [...mock.providers.keys()],
		getAll: availableModels,
		refresh: async () => ({ aborted: false, errors: new Map() }),
		getAvailable: availableModels,
	};
	const { ctx } = createMockContext({ modelRegistry: registry });
	await store.updateProvider("anthropic", (state) => ({
		...state,
		accounts: { work: credential("first") },
	}));
	await runtime.reconcile(ctx);
	const first = mock.providers.get("anthropic-work");
	assert.ok(first);

	await store.updateProvider("anthropic", (state) => ({
		...state,
		accounts: { work: credential("replacement") },
	}));
	await runtime.reconcile(ctx);
	assert.notEqual(mock.providers.get("anthropic-work"), first);

	await store.updateProvider("anthropic", (state) => ({ ...state, accounts: {} }));
	await runtime.reconcile(ctx);
	assert.equal(mock.providers.has("anthropic-work"), false);
});

test("disable refresh failure stays observable and can recover without stale auth", async () => {
	const store = await enabledStore("anthropic", "work");
	const mock = createMockPi();
	const runtime = await createAccountAliasRuntime({
		pi: mock.pi,
		store,
		providers: [adapter("openai-codex"), adapter("anthropic"), adapter("github-copilot")],
		loadBuiltinProviders: async () => [
			baseProvider("openai-codex"),
			baseProvider("anthropic"),
			baseProvider("github-copilot"),
		],
	});
	await runtime.initializeFactory(store.read());
	let failRefresh = true;
	const registry = {
		getRegisteredNativeProvider: (id: string) => mock.providers.get(id) as Provider | undefined,
		getRegisteredProviderConfig: () => undefined,
		getRegisteredProviderIds: () => [...mock.providers.keys()],
		getAll: () => [],
		refresh: async () => ({
			aborted: false,
			errors: failRefresh
				? new Map([["anthropic-work", new Error("injected refresh failure")]])
				: new Map(),
		}),
		getAvailable: () => [],
	};
	const { ctx } = createMockContext({ modelRegistry: registry });
	await store.update((data) => ({
		...data,
		settings: { ...(data.settings ?? {}), accountProviderAliases: false },
	}));

	await assert.rejects(runtime.reconcile(ctx), /injected refresh failure/);
	assert.equal(mock.providers.has("anthropic-work"), false);
	assert.equal(runtime.getStatus().enabled, false);
	assert.match(runtime.getStatus().error ?? "", /injected refresh failure/);

	failRefresh = false;
	await store.update((data) => ({
		...data,
		settings: { ...(data.settings ?? {}), accountProviderAliases: true },
	}));
	await runtime.reconcile(ctx);
	assert.equal(mock.providers.has("anthropic-work"), true);
});

test("shutdown waits for reconciliation and rejects stale post-shutdown registration", async () => {
	const store = await enabledStore("anthropic", "work");
	const mock = createMockPi();
	const runtime = await createAccountAliasRuntime({
		pi: mock.pi,
		store,
		providers: [adapter("openai-codex"), adapter("anthropic"), adapter("github-copilot")],
		loadBuiltinProviders: async () => [
			baseProvider("openai-codex"),
			baseProvider("anthropic"),
			baseProvider("github-copilot"),
		],
	});
	await runtime.initializeFactory(store.read());
	let releaseRefresh: () => void = () => undefined;
	const refreshGate = new Promise<void>((resolve) => {
		releaseRefresh = resolve;
	});
	let markRefreshStarted: () => void = () => undefined;
	const refreshStarted = new Promise<void>((resolve) => {
		markRefreshStarted = resolve;
	});
	let refreshCalls = 0;
	const registry = {
		getRegisteredNativeProvider: (id: string) => mock.providers.get(id) as Provider | undefined,
		getRegisteredProviderConfig: () => undefined,
		getRegisteredProviderIds: () => [...mock.providers.keys()],
		getAll: () => [],
		refresh: async () => {
			refreshCalls += 1;
			if (refreshCalls === 1) {
				markRefreshStarted();
				await refreshGate;
			}
			return { aborted: false, errors: new Map() };
		},
		getAvailable: () => [],
	};
	const { ctx } = createMockContext({ modelRegistry: registry });
	const reconciliation = runtime.reconcile(ctx);
	await refreshStarted;
	const shutdown = runtime.shutdown(ctx);
	assert.equal(
		(mock.providers.get("anthropic-work") as Provider | undefined)?.auth.apiKey !== undefined,
		true,
	);
	releaseRefresh();
	await reconciliation;
	await shutdown;

	assert.equal(mock.providers.has("anthropic-work"), false);
	await assert.rejects(runtime.reconcile(ctx), /shut down/);
	assert.equal(mock.providers.has("anthropic-work"), false);
});

test("alias runtime skips case-fold collisions and never removes a foreign replacement", async () => {
	const store = new AccountStore(new InMemoryAccountStorageBackend());
	await store.write({
		version: 1,
		settings: { accountProviderAliases: true },
		providers: {
			"openai-codex": {
				accounts: { Work: credential("upper"), work: credential("lower") },
			},
			anthropic: { accounts: { solo: credential("solo") } },
		},
	});
	const mock = createMockPi();
	const runtime = await createAccountAliasRuntime({
		pi: mock.pi,
		store,
		providers: [adapter("openai-codex"), adapter("anthropic"), adapter("github-copilot")],
		loadBuiltinProviders: async () => [
			baseProvider("openai-codex"),
			baseProvider("anthropic"),
			baseProvider("github-copilot"),
		],
	});
	await runtime.initializeFactory(store.read());
	assert.equal(mock.providers.has("openai-codex-Work"), false);
	assert.equal(mock.providers.has("openai-codex-work"), false);
	assert.equal(mock.providers.has("anthropic-solo"), true);
	assert.deepEqual(runtime.getStatus().collisions, ["openai-codex-Work", "openai-codex-work"]);

	const caseVariant = baseProvider("anthropic", {
		id: "ANTHROPIC-SOLO",
		name: "Foreign case variant",
	});
	mock.providers.set("ANTHROPIC-SOLO", caseVariant);
	const registry = {
		getRegisteredNativeProvider: (id: string) => mock.providers.get(id) as Provider | undefined,
		getRegisteredProviderConfig: () => undefined,
		getRegisteredProviderIds: () => [...mock.providers.keys()],
		getAll: () => [],
		refresh: async () => ({ aborted: false, errors: new Map() }),
		getAvailable: () => [],
	};
	const { ctx } = createMockContext({ modelRegistry: registry });
	await runtime.reconcile(ctx);
	assert.equal(mock.providers.has("anthropic-solo"), false);
	assert.equal(mock.providers.get("ANTHROPIC-SOLO"), caseVariant);
	assert.ok(runtime.getStatus().collisions.includes("anthropic-solo"));

	const foreign = baseProvider("anthropic", { id: "anthropic-solo", name: "Foreign" });
	mock.providers.set("anthropic-solo", foreign);
	const unregistrationsBeforeShutdown = mock.providerUnregistrations.length;
	await runtime.shutdown(ctx);

	assert.equal(mock.providers.get("anthropic-solo"), foreign);
	assert.equal(mock.providers.get("ANTHROPIC-SOLO"), caseVariant);
	assert.equal(mock.providerUnregistrations.length, unregistrationsBeforeShutdown);
});
