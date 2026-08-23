import type {
	Api,
	ApiStreamOptions,
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	AuthCheck,
	Context,
	DeferredCancelOptions,
	DeferredFetchOptions,
	DeferredHandle,
	Model,
	ModelAuth,
	OAuthCredential,
	Provider,
	ProviderHeaders,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import {
	type AccountStore,
	type AccountsData,
	defineOwn,
	getOwnCredential,
	normalizeStoredCredential,
} from "./account-store.js";
import type { AccountProviderAdapter, AccountProviderId } from "./oauth.js";
import { redactTokenText } from "./runtime-auth.js";

const PROVIDERS_MODULE_ID = "@earendil-works/pi-ai/providers/all";
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const EXPERIMENTAL_AUTH_SOURCE = "pi-accounts alias (experimental)";

export type AccountAliasBinding = {
	aliasId: string;
	providerId: AccountProviderId;
	accountName: string;
};

export type AccountAliasStatus = {
	enabled: boolean;
	managed: number;
	available: number;
	collisions: readonly string[];
	error?: string;
};

export type AliasReconcileResult = AccountAliasStatus;

export interface AccountAliasRuntime {
	initializeFactory(data: AccountsData): Promise<void>;
	reconcile(ctx: ExtensionContext, signal?: AbortSignal): Promise<AliasReconcileResult>;
	shutdown(ctx: ExtensionContext): Promise<void>;
	getStatus(): AccountAliasStatus;
	getBinding(providerId: string | undefined): AccountAliasBinding | undefined;
}

export type AccountAliasModule = {
	createAccountAliasRuntime(options: AccountAliasRuntimeOptions): Promise<AccountAliasRuntime>;
};

export type AccountAliasRuntimeOptions = {
	pi: ExtensionAPI;
	store: AccountStore;
	providers: readonly AccountProviderAdapter[];
	loadBuiltinProviders?: () => Promise<readonly Provider[]>;
};

export async function createAccountAliasRuntime(
	options: AccountAliasRuntimeOptions,
): Promise<AccountAliasRuntime> {
	const baseProviders = await (options.loadBuiltinProviders ?? loadBuiltinProviders)();
	const bases = new Map<string, Provider>();
	for (const provider of baseProviders) bases.set(provider.id, provider);
	for (const adapter of options.providers) {
		if (!bases.has(adapter.id)) {
			throw new Error(`Pi's built-in ${adapter.displayName} provider is unavailable.`);
		}
	}
	return new NativeAccountAliasRuntime(options.pi, options.store, options.providers, bases);
}

class NativeAccountAliasRuntime implements AccountAliasRuntime {
	private owned = new Map<string, Provider>();
	private bindings = new Map<string, AccountAliasBinding>();
	private lease = new AliasLease();
	private status: AccountAliasStatus = {
		enabled: false,
		managed: 0,
		available: 0,
		collisions: [],
	};
	private operationTail: Promise<void> = Promise.resolve();
	private readonly lifetimeController = new AbortController();
	private activeReconcileController: AbortController | undefined;
	private closed = false;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly store: AccountStore,
		private readonly providers: readonly AccountProviderAdapter[],
		private readonly bases: ReadonlyMap<string, Provider>,
	) {}

	async initializeFactory(data: AccountsData): Promise<void> {
		if (!aliasesEnabled(data)) return;
		const prepared = this.prepare(data, this.lease);
		try {
			for (const [id, provider] of prepared.providers) {
				this.pi.registerProvider(provider);
				this.owned.set(id, provider);
			}
			this.bindings = prepared.bindings;
			this.status = {
				enabled: true,
				managed: this.owned.size,
				available: this.owned.size,
				collisions: prepared.collisions,
			};
		} catch (error) {
			this.lease.abort("Alias initialization failed");
			for (const id of this.owned.keys()) this.pi.unregisterProvider(id);
			this.owned.clear();
			this.bindings.clear();
			this.status = {
				enabled: true,
				managed: 0,
				available: 0,
				collisions: prepared.collisions,
				error: safeError(error),
			};
			throw error;
		}
	}

	reconcile(ctx: ExtensionContext, ownerSignal?: AbortSignal): Promise<AliasReconcileResult> {
		this.lease.abort("Account alias reconciliation requested");
		this.activeReconcileController?.abort(
			new DOMException("A newer account alias reconciliation started", "AbortError"),
		);
		const operationController = new AbortController();
		this.activeReconcileController = operationController;
		const signal = ownerSignal
			? AbortSignal.any([ownerSignal, operationController.signal, this.lifetimeController.signal])
			: AbortSignal.any([operationController.signal, this.lifetimeController.signal]);
		const operation = this.serialized(async () => {
			signal.throwIfAborted();
			if (this.closed) throw new Error("The account alias runtime is shut down.");
			return this.reconcileCurrent(ctx, signal);
		});
		return operation.finally(() => {
			if (this.activeReconcileController === operationController) {
				this.activeReconcileController = undefined;
			}
		});
	}

	private async reconcileCurrent(
		ctx: ExtensionContext,
		signal: AbortSignal,
	): Promise<AliasReconcileResult> {
		let data: AccountsData;
		try {
			data = await this.store.readAsync();
			signal.throwIfAborted();
		} catch (error) {
			if (signal.aborted) throw error;
			await this.removeOwned(ctx, "Alias storage became invalid", true, signal);
			this.status = {
				enabled: false,
				managed: 0,
				available: 0,
				collisions: [],
				error: safeError(error),
			};
			return this.getStatus();
		}
		if (!aliasesEnabled(data)) {
			try {
				await this.removeOwned(ctx, "Account provider aliases were disabled", false, signal);
				this.status = {
					enabled: false,
					managed: 0,
					available: 0,
					collisions: [],
				};
				return this.getStatus();
			} catch (error) {
				this.status = {
					enabled: false,
					managed: 0,
					available: 0,
					collisions: [],
					error: safeError(error),
				};
				throw error;
			}
		}

		const previousOwned = this.owned;
		const previousBindings = this.bindings;
		const oldIds = [...previousOwned.keys()];
		const nextLease = new AliasLease();
		const prepared = this.prepare(data, nextLease);
		const foreignCollisions: string[] = [];
		const occupiedIds = new Set([
			...ctx.modelRegistry.getRegisteredProviderIds(),
			...ctx.modelRegistry.getAll().map((model) => model.provider),
		]);
		const eligible = new Map<string, Provider>();
		const eligibleBindings = new Map<string, AccountAliasBinding>();
		for (const [id, provider] of prepared.providers) {
			const previous = previousOwned.get(id);
			const native = ctx.modelRegistry.getRegisteredNativeProvider(id);
			const config = ctx.modelRegistry.getRegisteredProviderConfig(id);
			const caseFoldCollision = [...occupiedIds].some(
				(occupied) => occupied !== id && occupied.toLowerCase() === id.toLowerCase(),
			);
			if ((native && native !== previous) || config || caseFoldCollision) {
				foreignCollisions.push(id);
				continue;
			}
			eligible.set(id, provider);
			const binding = prepared.bindings.get(id);
			if (binding) eligibleBindings.set(id, binding);
		}

		this.lease.abort("Account aliases were reconciled");
		this.lease = nextLease;
		this.owned = new Map();
		this.bindings = new Map();
		try {
			for (const [id, provider] of previousOwned) {
				if (ctx.modelRegistry.getRegisteredNativeProvider(id) === provider) {
					this.pi.unregisterProvider(id);
				}
			}
			for (const [id, provider] of eligible) {
				this.pi.registerProvider(provider);
				this.owned.set(id, provider);
				const binding = eligibleBindings.get(id);
				if (binding) this.bindings.set(id, binding);
			}
			await refreshAliases(
				ctx.modelRegistry,
				[...new Set([...oldIds, ...eligible.keys()])],
				signal,
			);
			this.status = {
				enabled: true,
				managed: this.owned.size,
				available: countAvailableAliases(ctx.modelRegistry, this.owned.keys()),
				collisions: [...prepared.collisions, ...foreignCollisions].sort(),
			};
			return this.getStatus();
		} catch (error) {
			this.lease.abort("Alias reconciliation failed");
			const rollbackErrors: string[] = [];
			for (const [id, provider] of this.owned) {
				if (ctx.modelRegistry.getRegisteredNativeProvider(id) !== provider) continue;
				try {
					this.pi.unregisterProvider(id);
				} catch (rollbackError) {
					rollbackErrors.push(`${id} cleanup: ${safeError(rollbackError)}`);
				}
			}
			const restoreLease = new AliasLease();
			const restored = this.prepareFromBindings(previousBindings, restoreLease);
			this.lease = restoreLease;
			this.owned = new Map();
			this.bindings = new Map();
			for (const [id, provider] of restored.providers) {
				if (
					ctx.modelRegistry.getRegisteredNativeProvider(id) ||
					ctx.modelRegistry.getRegisteredProviderConfig(id)
				) {
					continue;
				}
				try {
					this.pi.registerProvider(provider);
					this.owned.set(id, provider);
					const binding = restored.bindings.get(id);
					if (binding) this.bindings.set(id, binding);
				} catch (rollbackError) {
					rollbackErrors.push(`${id} restore: ${safeError(rollbackError)}`);
				}
			}
			try {
				await refreshAliases(
					ctx.modelRegistry,
					[...new Set([...oldIds, ...eligible.keys(), ...this.owned.keys()])],
					signal,
				);
			} catch (rollbackError) {
				rollbackErrors.push(`model refresh: ${safeError(rollbackError)}`);
			}
			const report = [safeError(error), ...rollbackErrors].join("; ");
			this.status = {
				enabled: true,
				managed: this.owned.size,
				available: countAvailableAliases(ctx.modelRegistry, this.owned.keys()),
				collisions: [...prepared.collisions, ...foreignCollisions].sort(),
				error: report,
			};
			throw new Error(report, { cause: error });
		}
	}

	shutdown(ctx: ExtensionContext): Promise<void> {
		this.closed = true;
		this.lifetimeController.abort(new DOMException("Account aliases shut down", "AbortError"));
		this.activeReconcileController?.abort(
			new DOMException("Account aliases shut down", "AbortError"),
		);
		this.lease.abort("Account aliases shut down");
		return this.serialized(async () => {
			await this.removeOwned(
				ctx,
				"Account aliases shut down",
				true,
				this.lifetimeController.signal,
			);
			this.status = {
				enabled: false,
				managed: 0,
				available: 0,
				collisions: [],
			};
		});
	}

	getStatus(): AccountAliasStatus {
		return {
			...this.status,
			collisions: [...this.status.collisions],
		};
	}

	getBinding(providerId: string | undefined): AccountAliasBinding | undefined {
		const binding = providerId ? this.bindings.get(providerId) : undefined;
		return binding ? { ...binding } : undefined;
	}

	private prepare(data: AccountsData, lease: AliasLease): PreparedAliases {
		const bindings: AccountAliasBinding[] = [];
		for (const adapter of this.providers) {
			for (const accountName of Object.keys(data.providers[adapter.id]?.accounts ?? {})) {
				bindings.push({
					aliasId: `${adapter.id}-${accountName}`,
					providerId: adapter.id,
					accountName,
				});
			}
		}
		return this.prepareBindings(bindings, lease);
	}

	private prepareFromBindings(
		bindings: ReadonlyMap<string, AccountAliasBinding>,
		lease: AliasLease,
	): PreparedAliases {
		return this.prepareBindings([...bindings.values()], lease);
	}

	private prepareBindings(
		bindings: readonly AccountAliasBinding[],
		lease: AliasLease,
	): PreparedAliases {
		const folded = new Map<string, AccountAliasBinding[]>();
		for (const binding of bindings) {
			const key = binding.aliasId.toLowerCase();
			folded.set(key, [...(folded.get(key) ?? []), binding]);
		}
		const collisions = [...folded.values()]
			.filter((group) => group.length > 1)
			.flatMap((group) => group.map((binding) => binding.aliasId))
			.sort();
		const collisionIds = new Set(collisions);
		const providers = new Map<string, Provider>();
		const preparedBindings = new Map<string, AccountAliasBinding>();
		for (const binding of [...bindings].sort((left, right) =>
			left.aliasId.localeCompare(right.aliasId),
		)) {
			if (collisionIds.has(binding.aliasId)) continue;
			const adapter = this.providers.find((candidate) => candidate.id === binding.providerId);
			const base = this.bases.get(binding.providerId);
			if (!adapter || !base) continue;
			providers.set(
				binding.aliasId,
				createAccountAliasProvider({ binding, base, adapter, store: this.store, lease }),
			);
			preparedBindings.set(binding.aliasId, binding);
		}
		return { providers, bindings: preparedBindings, collisions };
	}

	private async serialized<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.operationTail;
		let release: () => void = () => undefined;
		this.operationTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}

	private async removeOwned(
		ctx: ExtensionContext,
		reason: string,
		ignoreRefreshErrors = false,
		signal?: AbortSignal,
	): Promise<void> {
		this.lease.abort(reason);
		const ids = [...this.owned.keys()];
		for (const [id, provider] of this.owned) {
			if (ctx.modelRegistry.getRegisteredNativeProvider(id) === provider) {
				this.pi.unregisterProvider(id);
			}
		}
		this.owned.clear();
		this.bindings.clear();
		const refresh = refreshAliases(ctx.modelRegistry, ids, signal);
		if (ignoreRefreshErrors) await refresh.catch(() => undefined);
		else await refresh;
	}
}

type PreparedAliases = {
	providers: Map<string, Provider>;
	bindings: Map<string, AccountAliasBinding>;
	collisions: string[];
};

class AliasLease {
	private readonly controller = new AbortController();

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	abort(reason: string): void {
		if (!this.controller.signal.aborted) {
			this.controller.abort(new DOMException(reason, "AbortError"));
		}
	}
}

export function createAccountAliasProvider(options: {
	binding: AccountAliasBinding;
	base: Provider;
	adapter: AccountProviderAdapter;
	store: AccountStore;
	lease?: { signal: AbortSignal };
}): Provider {
	const { adapter, base, binding, store } = options;
	const lease = options.lease ?? new AliasLease();
	let availableModelIds: ReadonlySet<string> | undefined;
	const aliasModels = () => base.getModels().map((model) => aliasModel(model, binding.aliasId));

	const check = async (signal: AbortSignal): Promise<AuthCheck | undefined> => {
		const effectiveSignal = combineSignals(signal, lease.signal);
		effectiveSignal.throwIfAborted();
		const data = await store.readAsync();
		effectiveSignal.throwIfAborted();
		if (!aliasesEnabled(data)) return undefined;
		const credential = getOwnCredential(
			data.providers[binding.providerId]?.accounts ?? Object.create(null),
			binding.accountName,
		);
		if (!credential) return undefined;
		availableModelIds = readAvailableModelIds(credential);
		return { type: "api_key", source: EXPERIMENTAL_AUTH_SOURCE };
	};

	const resolve = async (
		signal: AbortSignal,
	): Promise<{ auth: ModelAuth; source: string } | undefined> => {
		const effectiveSignal = combineSignals(signal, lease.signal);
		effectiveSignal.throwIfAborted();
		const initialCredential = await safelyReadCredential(store, binding);
		effectiveSignal.throwIfAborted();
		try {
			const credential = await resolveNamedCredential(
				store,
				adapter,
				binding.accountName,
				effectiveSignal,
			);
			if (!credential) return undefined;
			availableModelIds = readAvailableModelIds(credential);
			const auth = await adapter.oauth.toAuth(credential);
			effectiveSignal.throwIfAborted();
			validateModelAuth(auth, adapter.displayName);
			await assertCredentialCurrent(store, binding, credential, effectiveSignal);
			return { auth, source: EXPERIMENTAL_AUTH_SOURCE };
		} catch (error) {
			const currentCredential = effectiveSignal.aborted
				? undefined
				: await safelyReadCredential(store, binding);
			throw new Error(redactCredentialError(error, initialCredential, currentCredential));
		}
	};

	const preflight = async (
		model: Model<Api>,
		request: { apiKey?: string; headers?: ProviderHeaders },
		signal: AbortSignal,
	): Promise<void> => {
		let credential: OAuthCredential | undefined;
		try {
			const data = await store.readAsync();
			signal.throwIfAborted();
			if (!aliasesEnabled(data)) throw new Error("Account provider aliases are disabled.");
			credential = getOwnCredential(
				data.providers[binding.providerId]?.accounts ?? Object.create(null),
				binding.accountName,
			);
			if (!credential) {
				throw new Error(`Account "${binding.accountName}" is no longer available.`);
			}
			const allowed = readAvailableModelIds(credential);
			if (allowed && !allowed.has(model.id)) {
				throw new Error(`Model ${model.id} is not available to account "${binding.accountName}".`);
			}
			const auth = await adapter.oauth.toAuth(credential);
			signal.throwIfAborted();
			validateModelAuth(auth, adapter.displayName);
			if (auth.apiKey !== undefined && request.apiKey !== auth.apiKey) {
				throw new Error(
					`The ${adapter.displayName} alias credential changed before request dispatch.`,
				);
			}
			if (auth.baseUrl !== undefined && model.baseUrl !== auth.baseUrl) {
				throw new Error(
					`The ${adapter.displayName} alias endpoint changed before request dispatch.`,
				);
			}
			for (const [name, value] of Object.entries(auth.headers ?? {})) {
				if (value !== null && request.headers?.[name] !== value) {
					throw new Error(
						`The ${adapter.displayName} alias headers changed before request dispatch.`,
					);
				}
				if (value === null && request.headers?.[name] !== undefined) {
					throw new Error(
						`The ${adapter.displayName} alias headers changed before request dispatch.`,
					);
				}
			}
		} catch (error) {
			throw new Error(redactCredentialError(error, credential));
		}
	};

	const deferredStreams: Partial<Provider> = {
		...(base.fetchDeferred
			? {
					fetchDeferred: (
						model: Model<Api>,
						handle: DeferredHandle,
						fetchOptions?: DeferredFetchOptions,
					) =>
						delegateStream({
							aliasId: binding.aliasId,
							baseId: binding.providerId,
							model,
							context: { messages: [] },
							options: fetchOptions,
							leaseSignal: lease.signal,
							preflight,
							delegate: (baseModel, _context, baseOptions) =>
								base.fetchDeferred?.(
									baseModel,
									mapDeferredHandle(handle, binding.providerId),
									baseOptions as DeferredFetchOptions,
								) as AssistantMessageEventStream,
						}),
				}
			: {}),
		...(base.cancelDeferred
			? {
					cancelDeferred: async (
						model: Model<Api>,
						handle: DeferredHandle,
						cancelOptions?: DeferredCancelOptions,
					) => {
						const signal = combineSignals(cancelOptions?.signal, lease.signal);
						await preflight(model, cancelOptions ?? {}, signal);
						await base.cancelDeferred?.(
							baseModel(model, binding.providerId),
							mapDeferredHandle(handle, binding.providerId),
							{ ...cancelOptions, signal } as DeferredCancelOptions,
						);
					},
				}
			: {}),
	};
	const provider: Provider = {
		id: binding.aliasId,
		name: `${adapter.displayName} · ${binding.accountName} (experimental)`,
		baseUrl: base.baseUrl,
		headers: base.headers,
		auth: {
			apiKey: {
				name: `${adapter.displayName} ${binding.accountName} account alias`,
				check: async ({ signal }) => check(signal),
				resolve: async ({ signal }) => resolve(signal),
			},
		},
		getModels: aliasModels,
		filterModels: (models) =>
			availableModelIds ? models.filter((model) => availableModelIds?.has(model.id)) : models,
		stream: (model, context, streamOptions) =>
			delegateStream({
				aliasId: binding.aliasId,
				baseId: binding.providerId,
				model,
				context,
				options: streamOptions,
				leaseSignal: lease.signal,
				preflight,
				delegate: (baseModel, baseContext, baseOptions) =>
					base.stream(baseModel, baseContext, baseOptions as never),
			}),
		streamSimple: (model, context, streamOptions) =>
			delegateStream({
				aliasId: binding.aliasId,
				baseId: binding.providerId,
				model,
				context,
				options: streamOptions,
				leaseSignal: lease.signal,
				preflight,
				delegate: (baseModel, baseContext, baseOptions) =>
					base.streamSimple(baseModel, baseContext, baseOptions as SimpleStreamOptions),
			}),
		...deferredStreams,
	};
	return provider;
}

function delegateStream(options: {
	aliasId: string;
	baseId: string;
	model: Model<Api>;
	context: Context;
	options?: ApiStreamOptions<Api> | SimpleStreamOptions | DeferredFetchOptions;
	leaseSignal: AbortSignal;
	preflight(
		model: Model<Api>,
		request: { apiKey?: string; headers?: ProviderHeaders },
		signal: AbortSignal,
	): Promise<void>;
	delegate(
		model: Model<Api>,
		context: Context,
		options: ApiStreamOptions<Api> | SimpleStreamOptions | DeferredFetchOptions,
	): AssistantMessageEventStream;
}): AssistantMessageEventStream {
	const output = createAssistantMessageEventStream();
	void (async () => {
		const signal = combineSignals(options.options?.signal, options.leaseSignal);
		try {
			await options.preflight(options.model, options.options ?? {}, signal);
			const mappedOptions = mapRequestOptions(options.options, options.aliasId, signal, () =>
				options.preflight(options.model, options.options ?? {}, signal),
			);
			const source = options.delegate(
				baseModel(options.model, options.baseId),
				baseContext(options.context, options.aliasId, options.baseId),
				mappedOptions,
			);
			for await (const event of source) {
				output.push(mapEvent(event, options.aliasId));
			}
			output.end();
		} catch (error) {
			const message = errorAssistantMessage(options.model, signal, error);
			output.push({
				type: "error",
				reason: signal.aborted ? "aborted" : "error",
				error: message,
			});
			output.end(message);
		}
	})();
	return output;
}

function mapRequestOptions(
	options: ApiStreamOptions<Api> | SimpleStreamOptions | DeferredFetchOptions | undefined,
	aliasId: string,
	signal: AbortSignal,
	preflight: () => Promise<void>,
): ApiStreamOptions<Api> | SimpleStreamOptions | DeferredFetchOptions {
	const originalPayload = options?.onPayload;
	const originalResponse = options?.onResponse;
	return {
		...(options ?? {}),
		signal,
		onPayload: async (payload, model) => {
			await preflight();
			return originalPayload?.(payload, aliasModel(model, aliasId));
		},
		onResponse: originalResponse
			? (response, model) => originalResponse(response, aliasModel(model, aliasId))
			: undefined,
	};
}

function mapEvent(event: AssistantMessageEvent, aliasId: string): AssistantMessageEvent {
	if (event.type === "done") {
		return { ...event, message: aliasAssistantMessage(event.message, aliasId) };
	}
	if (event.type === "error") {
		return { ...event, error: aliasAssistantMessage(event.error, aliasId) };
	}
	return { ...event, partial: aliasAssistantMessage(event.partial, aliasId) };
}

function aliasAssistantMessage(message: AssistantMessage, aliasId: string): AssistantMessage {
	return {
		...message,
		provider: aliasId,
		...(message.deferred ? { deferred: mapDeferredHandle(message.deferred, aliasId) } : {}),
	};
}

function aliasModel<TApi extends Api>(model: Model<TApi>, aliasId: string): Model<TApi> {
	return { ...model, provider: aliasId };
}

function baseModel<TApi extends Api>(model: Model<TApi>, baseId: string): Model<TApi> {
	return { ...model, provider: baseId };
}

function baseContext(context: Context, aliasId: string, baseId: string): Context {
	return {
		...context,
		messages: context.messages.map((message) =>
			message.role === "assistant" && message.provider === aliasId
				? {
						...message,
						provider: baseId,
						...(message.deferred ? { deferred: mapDeferredHandle(message.deferred, baseId) } : {}),
					}
				: message,
		),
	};
}

function mapDeferredHandle(handle: DeferredHandle, provider: string): DeferredHandle {
	return { ...handle, provider };
}

async function resolveNamedCredential(
	store: AccountStore,
	adapter: AccountProviderAdapter,
	accountName: string,
	signal: AbortSignal,
): Promise<OAuthCredential | undefined> {
	signal.throwIfAborted();
	let data = await store.readAsync();
	signal.throwIfAborted();
	if (!aliasesEnabled(data)) return undefined;
	let credential = getOwnCredential(
		data.providers[adapter.id]?.accounts ?? Object.create(null),
		accountName,
	);
	if (!credential) return undefined;
	if (credential.expires <= Date.now() + REFRESH_SKEW_MS) {
		let refreshed: OAuthCredential | undefined;
		await store.updateAsync(async (latest) => {
			signal.throwIfAborted();
			if (!aliasesEnabled(latest)) return latest;
			const current = getOwnCredential(
				latest.providers[adapter.id]?.accounts ?? Object.create(null),
				accountName,
			);
			if (!current) return latest;
			if (current.expires > Date.now() + REFRESH_SKEW_MS) {
				refreshed = current;
				return latest;
			}
			const next = normalizeStoredCredential(
				await adapter.oauth.refresh(current, signal),
				accountName,
			);
			signal.throwIfAborted();
			refreshed = next;
			return {
				...latest,
				providers: defineOwn(latest.providers, adapter.id, {
					...(latest.providers[adapter.id] ?? { accounts: Object.create(null) }),
					accounts: defineOwn(
						latest.providers[adapter.id]?.accounts ?? Object.create(null),
						accountName,
						next,
					),
				}),
			};
		});
		credential = refreshed;
		data = await store.readAsync();
	}
	signal.throwIfAborted();
	if (!aliasesEnabled(data)) return undefined;
	const current = getOwnCredential(
		data.providers[adapter.id]?.accounts ?? Object.create(null),
		accountName,
	);
	if (!credential || !current || JSON.stringify(current) !== JSON.stringify(credential)) {
		return undefined;
	}
	return credential;
}

async function assertCredentialCurrent(
	store: AccountStore,
	binding: AccountAliasBinding,
	credential: OAuthCredential,
	signal: AbortSignal,
): Promise<void> {
	const data = await store.readAsync();
	signal.throwIfAborted();
	const current = getOwnCredential(
		data.providers[binding.providerId]?.accounts ?? Object.create(null),
		binding.accountName,
	);
	if (!aliasesEnabled(data) || !current || JSON.stringify(current) !== JSON.stringify(credential)) {
		throw new Error(`Account "${binding.accountName}" changed during authentication.`);
	}
}

async function safelyReadCredential(
	store: AccountStore,
	binding: AccountAliasBinding,
): Promise<OAuthCredential | undefined> {
	try {
		const data = await store.readAsync();
		return getOwnCredential(
			data.providers[binding.providerId]?.accounts ?? Object.create(null),
			binding.accountName,
		);
	} catch {
		return undefined;
	}
}

function aliasesEnabled(data: AccountsData): boolean {
	return data.settings?.accountProviderAliases === true;
}

function readAvailableModelIds(credential: OAuthCredential): ReadonlySet<string> | undefined {
	if (!Object.hasOwn(credential, "availableModelIds")) return undefined;
	const value = credential.availableModelIds;
	if (
		!Array.isArray(value) ||
		value.length > 1_000 ||
		!value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256)
	) {
		throw new Error("OAuth credential has invalid availableModelIds metadata.");
	}
	return new Set(value);
}

function validateModelAuth(auth: unknown, providerName: string): asserts auth is ModelAuth {
	if (!isRecord(auth)) throw new Error(`${providerName} OAuth returned invalid request auth.`);
	if (typeof auth.apiKey !== "string" || !auth.apiKey) {
		throw new Error(`${providerName} OAuth returned no API key.`);
	}
	if (auth.baseUrl !== undefined) {
		if (typeof auth.baseUrl !== "string") {
			throw new Error(`${providerName} OAuth returned an invalid endpoint.`);
		}
		const endpoint = new URL(auth.baseUrl);
		if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
			throw new Error(`${providerName} OAuth returned an unsafe endpoint.`);
		}
	}
	if (auth.headers !== undefined) {
		if (!isRecord(auth.headers)) throw new Error(`${providerName} OAuth returned invalid headers.`);
		for (const [name, value] of Object.entries(auth.headers)) {
			if (!name || /[\r\n]/u.test(name) || (value !== null && typeof value !== "string")) {
				throw new Error(`${providerName} OAuth returned invalid headers.`);
			}
			if (typeof value === "string" && /[\r\n]/u.test(value)) {
				throw new Error(`${providerName} OAuth returned invalid headers.`);
			}
		}
	}
}

function combineSignals(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
	return first ? AbortSignal.any([first, second]) : second;
}

async function refreshAliases(
	registry: ModelRegistry,
	providerIds: readonly string[],
	signal?: AbortSignal,
): Promise<void> {
	if (providerIds.length === 0) return;
	const result = await registry.refresh({
		providers: [...new Set(providerIds)],
		allowNetwork: false,
		signal,
	});
	if (result.aborted) throw new Error("Alias model refresh was cancelled.");
	if (result.errors.size > 0) {
		throw new Error(
			[...result.errors.entries()].map(([id, error]) => `${id}: ${safeError(error)}`).join("; "),
		);
	}
}

function countAvailableAliases(registry: ModelRegistry, providerIds: Iterable<string>): number {
	const ids = new Set(providerIds);
	return new Set(
		registry
			.getAvailable()
			.filter((model) => ids.has(model.provider))
			.map((model) => model.provider),
	).size;
}

function errorAssistantMessage(
	model: Model<Api>,
	signal: AbortSignal,
	error: unknown,
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: signal.aborted ? "aborted" : "error",
		errorMessage: safeError(error),
		timestamp: Date.now(),
	};
}

function redactCredentialError(
	error: unknown,
	...credentials: readonly (OAuthCredential | undefined)[]
): string {
	return redactTokenText(
		error instanceof Error ? error.message : String(error),
		credentials.flatMap((credential) =>
			credential ? [credential.access, credential.refresh] : [],
		),
	);
}

function safeError(error: unknown): string {
	return redactTokenText(error instanceof Error ? error.message : String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

async function loadBuiltinProviders(): Promise<readonly Provider[]> {
	const module = (await import(PROVIDERS_MODULE_ID)) as {
		builtinProviders(): readonly Provider[];
	};
	return module.builtinProviders();
}
