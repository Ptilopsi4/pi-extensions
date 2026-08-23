import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	AccountAliasBinding,
	AccountAliasRuntime,
	AccountAliasStatus,
} from "./account-aliases.js";
import type { AccountStore } from "./account-store.js";
import type { AccountProviderId } from "./oauth.js";
import { type EnsureActiveProviderAuthResult, redactTokenText } from "./runtime-auth.js";

type SettingsOwner = { signal: AbortSignal; isCurrent(): boolean };

export async function setAliasesEnabled(options: {
	enabled: boolean;
	ctx: ExtensionCommandContext;
	owner: SettingsOwner;
	pi: ExtensionAPI;
	store: AccountStore;
	ensureAliasRuntime(): Promise<AccountAliasRuntime>;
	reconcileAliases(
		ctx: ExtensionContext,
		options?: { notifyErrors?: boolean; signal?: AbortSignal },
	): Promise<AccountAliasStatus>;
	syncProvider(
		providerId: AccountProviderId,
		ctx: ExtensionContext,
	): Promise<EnsureActiveProviderAuthResult>;
	getBinding(providerId: string | undefined): AccountAliasBinding | undefined;
}): Promise<void> {
	const current = await options.store.readAsync();
	if (!options.owner.isCurrent()) throw new DOMException("Settings closed", "AbortError");
	const previous = current.settings?.accountProviderAliases === true;
	if (previous === options.enabled) {
		const status = await options.reconcileAliases(options.ctx, {
			notifyErrors: true,
			signal: options.owner.signal,
		});
		if (status.error) throw new Error(status.error);
		if (status.enabled !== options.enabled) {
			throw new Error("The persisted alias setting and runtime state do not match.");
		}
		return;
	}
	if (options.enabled) await options.ensureAliasRuntime();
	if (!options.owner.isCurrent()) throw new DOMException("Settings closed", "AbortError");

	const previousModel = options.ctx.model;
	const previousBinding = options.getBinding(previousModel?.provider);
	let modelChanged = false;
	await writeAliasSetting(options.store, options.enabled, options.owner);
	if (!options.owner.isCurrent()) {
		await writeAliasSetting(options.store, previous);
		throw new DOMException("Settings closed", "AbortError");
	}
	try {
		if (!options.enabled && previousModel) {
			modelChanged = await selectSafeAliasFallback(
				options.pi,
				options.ctx,
				options.store,
				options.syncProvider,
				previousBinding,
				options.owner,
			);
		}
		if (!options.owner.isCurrent()) throw new DOMException("Settings closed", "AbortError");
		const status = await options.reconcileAliases(options.ctx, {
			notifyErrors: true,
			signal: options.owner.signal,
		});
		if (status.error) throw new Error(status.error);
		if (status.enabled !== options.enabled) {
			throw new Error("The persisted alias setting and runtime state do not match.");
		}
		if (!options.enabled && previousModel && !modelChanged) {
			if (previousBinding) {
				options.ctx.ui.notify(
					`No safe same-account fallback exists for ${previousBinding.aliasId}. Select another model with /model.`,
					"warning",
				);
			}
		}
	} catch (error) {
		const rollbackErrors: string[] = [];
		try {
			await writeAliasSetting(options.store, previous);
		} catch (rollbackError) {
			rollbackErrors.push(`setting rollback failed: ${errorMessage(rollbackError)}`);
		}
		if (options.owner.isCurrent()) {
			try {
				const rollbackStatus = await options.reconcileAliases(options.ctx, {
					signal: options.owner.signal,
				});
				if (rollbackStatus.error) throw new Error(rollbackStatus.error);
				if (modelChanged && previousModel && !(await options.pi.setModel(previousModel))) {
					throw new Error("Could not restore the previous alias model.");
				}
			} catch (rollbackError) {
				rollbackErrors.push(`registry rollback failed: ${errorMessage(rollbackError)}`);
			}
		}
		throw new Error(
			[errorMessage(error), ...rollbackErrors]
				.map((message) => safeTerminalText(redactTokenText(message)))
				.join("; "),
		);
	}
}

async function writeAliasSetting(
	store: AccountStore,
	enabled: boolean,
	owner?: SettingsOwner,
): Promise<void> {
	await store.update((data) => {
		if (owner && !owner.isCurrent()) throw new DOMException("Settings closed", "AbortError");
		return {
			...data,
			settings: {
				...(data.settings ?? {}),
				accountProviderAliases: enabled,
			},
		};
	});
}

async function selectSafeAliasFallback(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	store: AccountStore,
	syncProvider: (
		providerId: AccountProviderId,
		ctx: ExtensionContext,
	) => Promise<EnsureActiveProviderAuthResult>,
	binding: AccountAliasBinding | undefined,
	owner: SettingsOwner,
): Promise<boolean> {
	if (!binding || !ctx.model) return false;
	const modelId = ctx.model.id;
	const state = await store.readProviderAsync(binding.providerId);
	if (!owner.isCurrent() || state.active !== binding.accountName) return false;
	const auth = await syncProvider(binding.providerId, ctx);
	if (!owner.isCurrent()) return false;
	if (auth.status !== "active" || auth.accountName !== binding.accountName) return false;
	const fallback = ctx.modelRegistry.find(binding.providerId, modelId);
	if (!fallback || !owner.isCurrent()) return false;
	const changed = await pi.setModel(fallback);
	return owner.isCurrent() && changed;
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
