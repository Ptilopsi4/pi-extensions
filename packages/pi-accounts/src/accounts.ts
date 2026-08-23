import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setAliasesEnabled } from "./account-alias-settings.js";
import type {
	AccountAliasBinding,
	AccountAliasModule,
	AccountAliasRuntime,
	AccountAliasStatus,
} from "./account-aliases.js";
import {
	AccountStore,
	consumeMigrationNotice,
	getOwnCredential,
	type StoredOAuthCredential,
} from "./account-store.js";
import { type AliasControls, createAccountCommand } from "./accounts-menu.js";
import {
	type AccountProviderAdapter,
	type AccountProviderId,
	createBuiltinProviderAdapters,
	SUPPORTED_PROVIDER_IDS,
} from "./oauth.js";
import {
	type EnsureActiveProviderAuthResult,
	RUNTIME_FAIL_CLOSED_API_KEY,
	RuntimeAuthCoordinator,
	redactTokenText,
} from "./runtime-auth.js";

export {
	ACCOUNTS_FILE,
	AccountStore,
	type AccountsData,
	InMemoryAccountStorageBackend,
	LEGACY_CODEX_ACCOUNTS_FILE,
	migrateLegacyCodexAccountsFile,
	type ProviderAccountsData,
	parseAccountName,
	parseAccountsData,
	type StoredOAuthCredential,
} from "./account-store.js";

export { DEFAULT_PI_LOGIN_LABEL } from "./accounts-menu.js";

export const ACCOUNTS_STATUS_KEY = "accounts";
export const FAIL_CLOSED_API_KEY = RUNTIME_FAIL_CLOSED_API_KEY;

export type AccountsDependencies = {
	store?: AccountStore;
	providers?: readonly AccountProviderAdapter[];
	closeCodexWebSockets?: (sessionId?: string) => unknown | Promise<unknown>;
	aliasModuleLoader?: () => Promise<AccountAliasModule>;
};

export default function accountsExtension(
	pi: ExtensionAPI,
	dependencies: AccountsDependencies = {},
): void | Promise<void> {
	const store = dependencies.store ?? new AccountStore();
	let migrationNotice = dependencies.store ? undefined : consumeMigrationNotice();
	const providers = [
		...(dependencies.providers ??
			createBuiltinProviderAdapters({ closeCodexWebSockets: dependencies.closeCodexWebSockets })),
	];
	validateProviderSet(providers);
	const adapters = new Map(providers.map((provider) => [provider.id, provider]));
	const coordinators = new Map(
		providers.map((provider) => [provider.id, new RuntimeAuthCoordinator(pi, provider)]),
	);
	const results = new Map<AccountProviderId, EnsureActiveProviderAuthResult>();
	const appliedIdentities = new Map<AccountProviderId, string>();
	const abortProviders = new Set<AccountProviderId>();
	const syncTasks = new Map<AccountProviderId, Promise<EnsureActiveProviderAuthResult>>();
	let sessionGeneration = 0;
	let menuController = new AbortController();
	let aliasRuntime: AccountAliasRuntime | undefined;
	let aliasRuntimePromise: Promise<AccountAliasRuntime> | undefined;
	let aliasSettingsTail: Promise<void> = Promise.resolve();
	let aliasStartupError: string | undefined;
	let initialAliasData: ReturnType<AccountStore["read"]> | undefined;
	try {
		initialAliasData = store.read();
	} catch (error) {
		aliasStartupError = safeTerminalText(errorMessage(error));
	}

	const ensureAliasRuntime = async (): Promise<AccountAliasRuntime> => {
		if (aliasRuntime) return aliasRuntime;
		if (!aliasRuntimePromise) {
			const loader = dependencies.aliasModuleLoader ?? defaultAliasModuleLoader;
			const pending = loader().then((module) =>
				module.createAccountAliasRuntime({ pi, store, providers }),
			);
			aliasRuntimePromise = pending;
			void pending.catch(() => {
				if (aliasRuntimePromise === pending) aliasRuntimePromise = undefined;
			});
		}
		aliasRuntime = await aliasRuntimePromise;
		return aliasRuntime;
	};

	const reconcileAliases = async (
		ctx: ExtensionContext,
		options: { notifyErrors?: boolean; signal?: AbortSignal } = {},
	): Promise<AccountAliasStatus> => {
		let enabledRequested = aliasRuntime?.getStatus().enabled ?? false;
		try {
			if (!aliasRuntime) {
				const data = await store.readAsync();
				enabledRequested = data.settings?.accountProviderAliases === true;
				if (!enabledRequested) {
					aliasStartupError = undefined;
					return disabledAliasStatus();
				}
			}
			const status = await (await ensureAliasRuntime()).reconcile(ctx, options.signal);
			aliasStartupError = status.error;
			if (status.enabled && status.collisions.length > 0 && options.notifyErrors) {
				ctx.ui.notify(
					`Account provider aliases skipped collisions: ${status.collisions.join(", ")}.`,
					"warning",
				);
			}
			return status;
		} catch (error) {
			aliasStartupError = safeTerminalText(redactTokenText(errorMessage(error)));
			if (options.notifyErrors) {
				ctx.ui.notify(`Account provider aliases failed: ${aliasStartupError}`, "error");
			}
			return {
				enabled: aliasRuntime?.getStatus().enabled ?? enabledRequested,
				managed: aliasRuntime?.getStatus().managed ?? 0,
				available: aliasRuntime?.getStatus().available ?? 0,
				collisions: aliasRuntime?.getStatus().collisions ?? [],
				error: aliasStartupError,
			};
		}
	};

	const syncProvider = (
		providerId: AccountProviderId,
		ctx: ExtensionContext,
		model = ctx.model,
	): Promise<EnsureActiveProviderAuthResult> => {
		let task!: Promise<EnsureActiveProviderAuthResult>;
		task = (async () => {
			const adapter = requireAdapter(adapters, providerId);
			const coordinator = coordinators.get(providerId);
			if (!coordinator) throw new Error(`Missing runtime coordinator for ${providerId}.`);
			let result = await coordinator.ensureActive(ctx, store);
			let latest = syncTasks.get(providerId);
			if (latest && latest !== task) return latest;
			try {
				const identity = await authIdentity(store, result);
				latest = syncTasks.get(providerId);
				if (latest && latest !== task) return latest;
				const previousIdentity = appliedIdentities.get(providerId);
				const shouldInvalidate =
					previousIdentity !== identity &&
					!(previousIdentity === undefined && identity === "default");
				if (shouldInvalidate) {
					await adapter.invalidateConnections?.(ctx.sessionManager.getSessionId());
					latest = syncTasks.get(providerId);
					if (latest && latest !== task) return latest;
				}
				appliedIdentities.set(providerId, identity);
			} catch (error) {
				latest = syncTasks.get(providerId);
				if (latest && latest !== task) return latest;
				const credential = await selectedCredential(store, providerId, result);
				latest = syncTasks.get(providerId);
				if (latest && latest !== task) return latest;
				result = await coordinator.forceFailClosed(
					ctx,
					result.status === "inactive" ? "unknown" : result.accountName,
					error,
					credential,
				);
			}
			latest = syncTasks.get(providerId);
			if (latest && latest !== task) return latest;
			results.set(providerId, result);
			updateStatus(ctx, results, model, aliasRuntime?.getBinding(model?.provider));
			return result;
		})();
		syncTasks.set(providerId, task);
		return task;
	};

	const syncAll = async (ctx: ExtensionContext): Promise<void> => {
		for (const provider of providers) {
			const result = await syncProvider(provider.id, ctx);
			if (result.status === "error") {
				ctx.ui.notify(
					`${provider.displayName} account "${result.accountName}" failed closed: ${result.message}`,
					"error",
				);
			}
		}
		updateStatus(ctx, results, ctx.model, aliasRuntime?.getBinding(ctx.model?.provider));
	};

	const aliasControls: AliasControls = {
		getBinding: (providerId) => aliasRuntime?.getBinding(providerId),
		getStatus: () => aliasRuntime?.getStatus() ?? disabledAliasStatus(aliasStartupError),
		reconcile: reconcileAliases,
		setEnabled: (enabled, ctx, owner) => {
			const operation = aliasSettingsTail.then(() =>
				setAliasesEnabled({
					enabled,
					ctx,
					owner,
					pi,
					store,
					ensureAliasRuntime,
					reconcileAliases,
					syncProvider,
					getBinding: (providerId) => aliasRuntime?.getBinding(providerId),
				}),
			);
			aliasSettingsTail = operation.catch(() => undefined);
			return operation;
		},
	};
	const accountCommand = createAccountCommand(
		pi,
		store,
		adapters,
		syncProvider,
		aliasControls,
		() => {
			const generation = sessionGeneration;
			return {
				signal: menuController.signal,
				isCurrent: () => generation === sessionGeneration && !menuController.signal.aborted,
			};
		},
	);
	pi.registerCommand("accounts", accountCommand);

	pi.on("session_start", async (_event, ctx) => {
		sessionGeneration += 1;
		menuController.abort(new DOMException("Accounts session replaced", "AbortError"));
		menuController = new AbortController();
		if (migrationNotice) {
			ctx.ui.notify(migrationNotice, "warning");
			migrationNotice = undefined;
		}
		const aliasStatus = await reconcileAliases(ctx, { notifyErrors: true });
		if (aliasStatus.enabled) {
			ctx.ui.notify(
				"Account provider aliases are experimental and remain bound to their named accounts.",
				"warning",
			);
		}
		await syncAll(ctx);
		updateStatus(ctx, results, ctx.model, aliasRuntime?.getBinding(ctx.model?.provider));
	});

	pi.on("model_select", async (event, ctx) => {
		const providerId = toProviderId(event.model.provider);
		if (providerId) await syncProvider(providerId, ctx, event.model);
		else {
			updateStatus(ctx, results, event.model, aliasRuntime?.getBinding(event.model.provider));
		}
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		abortProviders.clear();
		const providerId = toProviderId(ctx.model?.provider);
		if (!providerId) return;
		try {
			const result = await syncProvider(providerId, ctx);
			const coordinator = coordinators.get(providerId);
			if (result.status === "error") abortProviders.add(providerId);
			if (
				result.status === "active" &&
				ctx.model &&
				coordinator &&
				!coordinator.isModelAvailable(ctx.model.id)
			) {
				abortProviders.add(providerId);
				ctx.ui.notify(
					`${requireAdapter(adapters, providerId).displayName} model ${ctx.model.id} is not available to account "${result.accountName}".`,
					"error",
				);
			}
		} catch (error) {
			abortProviders.add(providerId);
			throw error;
		}
	});

	pi.on("turn_start", (_event, ctx) => {
		const providerId = toProviderId(ctx.model?.provider);
		if (!providerId || !abortProviders.has(providerId)) return;
		abortProviders.delete(providerId);
		ctx.abort();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		sessionGeneration += 1;
		menuController.abort(new DOMException("Accounts session shut down", "AbortError"));
		abortProviders.clear();
		await aliasSettingsTail;
		await Promise.allSettled([
			...(aliasRuntime ? [aliasRuntime.shutdown(ctx)] : []),
			...[...coordinators.values()].map(async (coordinator) => {
				coordinator.invalidate(ctx);
				await coordinator.clear(ctx);
			}),
		]);
		setStatus(ctx, undefined);
	});

	if (initialAliasData?.settings?.accountProviderAliases === true) {
		return ensureAliasRuntime()
			.then((runtime) =>
				runtime.initializeFactory(initialAliasData as NonNullable<typeof initialAliasData>),
			)
			.catch((error) => {
				aliasStartupError = safeTerminalText(redactTokenText(errorMessage(error)));
			});
	}
}

function validateProviderSet(providers: readonly AccountProviderAdapter[]): void {
	const ids = new Set<AccountProviderId>();
	for (const provider of providers) {
		if (ids.has(provider.id)) throw new Error(`Duplicate account provider: ${provider.id}`);
		ids.add(provider.id);
	}
	for (const id of SUPPORTED_PROVIDER_IDS) {
		if (!ids.has(id)) throw new Error(`Missing required account provider: ${id}`);
	}
}

function requireAdapter(
	adapters: Map<AccountProviderId, AccountProviderAdapter>,
	providerId: AccountProviderId,
): AccountProviderAdapter {
	const adapter = adapters.get(providerId);
	if (!adapter) throw new Error(`Unsupported account provider: ${providerId}`);
	return adapter;
}

function toProviderId(value: string | undefined): AccountProviderId | undefined {
	return value && isAccountProviderId(value) ? value : undefined;
}

function isAccountProviderId(value: string): value is AccountProviderId {
	return (SUPPORTED_PROVIDER_IDS as readonly string[]).includes(value);
}

async function selectedCredential(
	store: AccountStore,
	providerId: AccountProviderId,
	result: EnsureActiveProviderAuthResult,
): Promise<StoredOAuthCredential | undefined> {
	if (result.status === "inactive") return undefined;
	try {
		const state = await store.readProviderAsync(providerId);
		return getOwnCredential(state.accounts, result.accountName);
	} catch {
		return undefined;
	}
}

async function authIdentity(
	store: AccountStore,
	result: EnsureActiveProviderAuthResult,
): Promise<string> {
	if (result.status === "inactive") return "default";
	if (result.status === "error") return `error:${result.accountName}`;
	const state = await store.readProviderAsync(result.providerId);
	return `${result.accountName}:${getOwnCredential(state.accounts, result.accountName)?.access ?? "missing"}`;
}

function updateStatus(
	ctx: ExtensionContext,
	results: Map<AccountProviderId, EnsureActiveProviderAuthResult>,
	model = ctx.model,
	alias?: AccountAliasBinding,
): void {
	if (alias) {
		setStatus(ctx, `account:${alias.accountName} alias (experimental)`);
		return;
	}
	const providerId = toProviderId(model?.provider);
	const result = providerId ? results.get(providerId) : undefined;
	if (!result || result.status === "inactive") {
		setStatus(ctx, undefined);
		return;
	}
	if (result.status === "active") {
		setStatus(ctx, `account:${result.accountName}`);
		return;
	}
	setStatus(ctx, `account:${result.accountName} auth error`);
}

function setStatus(ctx: ExtensionContext, value: string | undefined): void {
	try {
		ctx.ui.setStatus(ACCOUNTS_STATUS_KEY, value);
	} catch (error) {
		if (!isStaleContextError(error)) throw error;
	}
}

function isStaleContextError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes("This extension ctx is stale after session replacement or reload")
	);
}

function disabledAliasStatus(error?: string): AccountAliasStatus {
	return {
		enabled: false,
		managed: 0,
		available: 0,
		collisions: [],
		...(error ? { error } : {}),
	};
}

async function defaultAliasModuleLoader(): Promise<AccountAliasModule> {
	return import("./account-aliases.js");
}

function safeTerminalText(value: string): string {
	return [...value]
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			if (character === "\n") return character;
			return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
		})
		.join("")
		.trim();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
