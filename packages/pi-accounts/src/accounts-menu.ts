import { join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { AccountAliasBinding, AccountAliasStatus } from "./account-aliases.js";
import {
	type AccountStore,
	type AccountsData,
	defineOwn,
	defineOwnMap,
	getOwnCredential,
	normalizeStoredCredential,
	parseAccountName,
	type StoredOAuthCredential,
} from "./account-store.js";
import {
	type AccountProviderAdapter,
	type AccountProviderId,
	loginWithOAuthUI,
	SUPPORTED_PROVIDER_IDS,
} from "./oauth.js";
import { type EnsureActiveProviderAuthResult, redactTokenText } from "./runtime-auth.js";

export const DEFAULT_PI_LOGIN_LABEL = "(default pi login)";

export type MenuOwner = { signal: AbortSignal; isCurrent(): boolean };

export type AliasControls = {
	getBinding(providerId: string | undefined): AccountAliasBinding | undefined;
	getStatus(): AccountAliasStatus;
	reconcile(
		ctx: ExtensionContext,
		options?: { notifyErrors?: boolean; signal?: AbortSignal },
	): Promise<AccountAliasStatus>;
	setEnabled(enabled: boolean, ctx: ExtensionCommandContext, owner: MenuOwner): Promise<void>;
};

export function createAccountCommand(
	pi: ExtensionAPI,
	store: AccountStore,
	adapters: Map<AccountProviderId, AccountProviderAdapter>,
	syncProvider: (
		providerId: AccountProviderId,
		ctx: ExtensionContext,
	) => Promise<EnsureActiveProviderAuthResult>,
	aliases: AliasControls,
	getMenuOwner: () => MenuOwner,
) {
	return {
		description: "Open the interactive subscription account manager",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await showAccountsMenu(pi, ctx, store, adapters, syncProvider, aliases, getMenuOwner());
		},
	};
}

const LOGIN_ACTION = "Login new account";
const REMOVE_ACTION = "Remove account";
const SWITCH_PROVIDER_ACTION = "Switch provider account";
const SWITCH_ANOTHER_PROVIDER_ACTION = "Switch another provider’s account";
const SETTINGS_ACTION = "Settings";
const STATUS_ACTION = "Status";
const HELP_ACTION = "Help";

type ProviderMenuState = {
	id: AccountProviderId;
	adapter: AccountProviderAdapter;
	active: string | undefined;
	accounts: Record<string, StoredOAuthCredential>;
};

async function showAccountsMenu(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	store: AccountStore,
	adapters: Map<AccountProviderId, AccountProviderAdapter>,
	syncProvider: (
		providerId: AccountProviderId,
		ctx: ExtensionContext,
	) => Promise<EnsureActiveProviderAuthResult>,
	aliases: AliasControls,
	owner: MenuOwner,
): Promise<void> {
	if (!ctx.hasUI) {
		throw new Error("/accounts requires interactive UI (TUI or RPC mode).");
	}
	const { defineMenu, runMenu } = await import("@narumitw/pi-tui-kit");
	if (!owner.isCurrent()) return;
	let selectedProviderId: AccountProviderId | undefined;
	type State = {
		states: Map<AccountProviderId, ProviderMenuState>;
		currentProviderId: AccountProviderId | undefined;
		currentAlias: AccountAliasBinding | undefined;
		hasAnyStoredAccount: boolean;
		aliasesEnabled: boolean;
		aliasStatus: AccountAliasStatus;
		storageError?: string;
	};
	type Screen =
		| "main"
		| "login-providers"
		| "switch-providers"
		| "switch-accounts"
		| "remove"
		| "settings"
		| "status"
		| "help";
	type Action =
		| "login-route"
		| "login-provider"
		| "switch-current"
		| "switch-route"
		| "switch-provider"
		| "switch-account"
		| "remove-route"
		| "remove-account"
		| "settings-route"
		| "set-aliases"
		| "status-route"
		| "help-route";
	const menu = defineMenu<State, Screen, Action, ExtensionCommandContext>({
		start: "main",
		screens: {
			main: ({ state }) => {
				const currentState = state.currentProviderId
					? state.states.get(state.currentProviderId)
					: undefined;
				return {
					kind: "actions",
					title: "Accounts",
					lines: formatAccountsMenuTitle(
						ctx,
						state.states,
						state.hasAnyStoredAccount,
						state.currentAlias,
						state.storageError,
					)
						.split("\n")
						.slice(1),
					items: buildAccountMainItems(
						state.states,
						currentState,
						state.hasAnyStoredAccount,
						state.storageError === undefined,
					),
					hint: "close",
				};
			},
			"login-providers": ({ state }) => ({
				kind: "actions",
				title: "Select provider",
				items: sortedProviderStates(state.states).map((provider) => ({
					id: provider.id,
					label: provider.adapter.displayName,
					action: "login-provider",
				})),
				hint: "back",
			}),
			"switch-providers": ({ state }) => ({
				kind: "actions",
				title: "Select provider",
				items: providerStatesWithAccounts(state.states, state.currentProviderId).map(
					(provider) => ({
						id: provider.id,
						label: provider.adapter.displayName,
						action: "switch-provider",
					}),
				),
				hint: "back",
			}),
			"switch-accounts": ({ state }) => {
				const provider = selectedProviderId ? state.states.get(selectedProviderId) : undefined;
				const options = provider
					? switchAccountOptions(provider.active, Object.keys(provider.accounts))
					: [];
				return {
					kind: "actions",
					title: provider ? `Switch ${provider.adapter.displayName} account` : "Switch account",
					items: options.map((option) => {
						const accountName = stripActiveMarker(option);
						return {
							id: accountItemId(accountName),
							label: option,
							action: "switch-account" as const,
							disabled: accountName === (provider?.active ?? "default"),
						};
					}),
					hint: "back",
				};
			},
			remove: ({ state }) => ({
				kind: "actions",
				title: "Remove account",
				items: removeAccountOptions(state.states, state.currentProviderId).map((option) => ({
					id: removeAccountItemId(option.adapter.id, option.accountName),
					label: option.label,
					action: "remove-account",
				})),
				hint: "back",
			}),
			settings: ({ state }) =>
				state.storageError
					? {
							kind: "detail",
							title: "Account Settings · Read only",
							lines: [
								`Invalid settings file. Fix ${safeTerminalText(accountsFilePath())} and run /reload.`,
								safeTerminalText(state.storageError),
							],
							hint: "back",
						}
					: {
							kind: "settings",
							title: "Account Settings",
							lines: [
								`User settings · ${safeTerminalText(accountsFilePath())}`,
								"Experimental aliases stay bound to one named OAuth account.",
							],
							items: [
								{
									id: "accountProviderAliases",
									label: "Account provider aliases (experimental)",
									description:
										"Expose every named subscription account as a selectable model provider.",
									currentValue: state.aliasesEnabled ? "Enabled" : "Disabled",
									values: ["Disabled", "Enabled"],
									action: "set-aliases",
								},
							],
							hint: "back",
						},
			status: ({ state }) => ({
				kind: "detail",
				title: "Account Status",
				lines: [
					`Settings file: ${safeTerminalText(accountsFilePath())}`,
					`Account provider aliases: ${state.aliasesEnabled ? "Enabled (experimental)" : "Disabled (default)"}`,
					`Managed aliases: ${state.aliasStatus.managed}`,
					`Available aliases: ${state.aliasStatus.available}`,
					...(state.aliasStatus.collisions.length > 0
						? [`Skipped collisions: ${state.aliasStatus.collisions.join(", ")}`]
						: []),
					...(state.aliasStatus.error
						? [`Alias error: ${safeTerminalText(state.aliasStatus.error)}`]
						: []),
					...(state.storageError ? [`Storage error: ${safeTerminalText(state.storageError)}`] : []),
				],
				hint: "back",
			}),
			help: () => ({
				kind: "detail",
				title: "Account Help",
				lines: [
					"Switching an active account changes authentication for the original provider.",
					"Experimental aliases are separate providers permanently bound to one named account.",
					"Select alias models through /model or use --provider <alias> --model <model-id>.",
					"Aliases never fall back to default auth or another named account.",
				],
				hint: "back",
			}),
		},
		actions: {
			"login-route": async () => ({ kind: "to", screen: "login-providers" }),
			"login-provider": async ({ itemId, signal }) => {
				if (!isAccountProviderId(itemId)) return { kind: "rejected" };
				const adapter = requireAdapter(adapters, itemId);
				const name = await ctx.ui.input(`Name this ${adapter.displayName} account:`, "work", {
					signal,
				});
				if (name === undefined || !owner.isCurrent()) return { kind: "close" };
				await loginAccount(
					pi,
					ctx,
					store,
					adapter,
					name,
					signal,
					syncProvider,
					() => aliases.reconcile(ctx, { notifyErrors: true, signal }),
					owner.isCurrent,
				);
				return { kind: "close" };
			},
			"switch-current": async ({ itemId }) => {
				if (!isAccountProviderId(itemId)) return { kind: "rejected" };
				selectedProviderId = itemId;
				return { kind: "to", screen: "switch-accounts" };
			},
			"switch-route": async () => ({ kind: "to", screen: "switch-providers" }),
			"switch-provider": async ({ itemId }) => {
				if (!isAccountProviderId(itemId)) return { kind: "rejected" };
				selectedProviderId = itemId;
				return { kind: "to", screen: "switch-accounts" };
			},
			"switch-account": async ({ itemId }) => {
				const providerId = selectedProviderId;
				if (!providerId) return { kind: "rejected" };
				const latest = await store.readProviderAsync(providerId);
				if (!owner.isCurrent()) return { kind: "close" };
				const accountName = switchAccountOptions(latest.active, Object.keys(latest.accounts))
					.map(stripActiveMarker)
					.find((name) => accountItemId(name) === itemId);
				if (!accountName) return { kind: "rejected" };
				await switchAccount(
					ctx,
					store,
					requireAdapter(adapters, providerId),
					accountName,
					syncProvider,
				);
				return { kind: "close" };
			},
			"remove-route": async () => ({ kind: "to", screen: "remove" }),
			"remove-account": async ({ itemId, signal }) => {
				const states = await readProviderMenuStates(store, adapters);
				if (!owner.isCurrent()) return { kind: "close" };
				const option = removeAccountOptions(states, toProviderId(ctx.model?.provider)).find(
					(candidate) =>
						removeAccountItemId(candidate.adapter.id, candidate.accountName) === itemId,
				);
				if (!option) return { kind: "rejected" };
				const confirmed = await ctx.ui.confirm(
					"Remove account",
					`Remove ${option.adapter.displayName} account "${option.accountName}"?`,
				);
				if (!confirmed || !owner.isCurrent()) return { kind: "close" };
				await removeAccount(
					ctx,
					store,
					option.adapter,
					option.accountName,
					syncProvider,
					() => aliases.reconcile(ctx, { notifyErrors: true, signal }),
					aliases.getBinding(ctx.model?.provider),
				);
				return { kind: "close" };
			},
			"settings-route": async () => ({ kind: "to", screen: "settings" }),
			"set-aliases": async ({ value }) => {
				const enabled = value === "Enabled";
				if (enabled) {
					const confirmed = await ctx.ui.confirm(
						"Enable experimental account provider aliases?",
						"Each saved OAuth account will appear as a model provider. Alias IDs and behavior may change.",
					);
					if (!confirmed || !owner.isCurrent()) return { kind: "rejected" };
				}
				try {
					await aliases.setEnabled(enabled, ctx, owner);
					if (!owner.isCurrent()) return { kind: "close" };
					ctx.ui.notify(
						enabled
							? "Experimental account provider aliases are enabled."
							: "Account provider aliases are disabled.",
						enabled ? "warning" : "info",
					);
					return { kind: "stay" };
				} catch (error) {
					ctx.ui.notify(
						`Could not ${enabled ? "enable" : "disable"} account provider aliases: ${safeTerminalText(redactTokenText(errorMessage(error)))}`,
						"error",
					);
					return { kind: "rejected" };
				}
			},
			"status-route": async () => ({ kind: "to", screen: "status" }),
			"help-route": async () => ({ kind: "to", screen: "help" }),
		},
	});
	await runMenu(ctx, menu, {
		getState: async () => readAccountsMenuState(ctx, store, adapters, aliases),
		signal: owner.signal,
		isCurrent: owner.isCurrent,
	});
}

async function readAccountsMenuState(
	ctx: ExtensionCommandContext,
	store: AccountStore,
	adapters: Map<AccountProviderId, AccountProviderAdapter>,
	aliases: AliasControls,
): Promise<{
	states: Map<AccountProviderId, ProviderMenuState>;
	currentProviderId: AccountProviderId | undefined;
	currentAlias: AccountAliasBinding | undefined;
	hasAnyStoredAccount: boolean;
	aliasesEnabled: boolean;
	aliasStatus: AccountAliasStatus;
	storageError?: string;
}> {
	try {
		const data = await store.readAsync();
		const states = providerMenuStatesFromData(data, adapters);
		return {
			states,
			currentProviderId: toProviderId(ctx.model?.provider),
			currentAlias: aliases.getBinding(ctx.model?.provider),
			hasAnyStoredAccount: [...states.values()].some((state) => accountNames(state).length > 0),
			aliasesEnabled: data.settings?.accountProviderAliases === true,
			aliasStatus: aliases.getStatus(),
		};
	} catch (error) {
		return {
			states: emptyProviderMenuStates(adapters),
			currentProviderId: toProviderId(ctx.model?.provider),
			currentAlias: aliases.getBinding(ctx.model?.provider),
			hasAnyStoredAccount: false,
			aliasesEnabled: false,
			aliasStatus: aliases.getStatus(),
			storageError: safeTerminalText(errorMessage(error)),
		};
	}
}

async function readProviderMenuStates(
	store: AccountStore,
	adapters: Map<AccountProviderId, AccountProviderAdapter>,
): Promise<Map<AccountProviderId, ProviderMenuState>> {
	return providerMenuStatesFromData(await store.readAsync(), adapters);
}

function providerMenuStatesFromData(
	data: AccountsData,
	adapters: Map<AccountProviderId, AccountProviderAdapter>,
): Map<AccountProviderId, ProviderMenuState> {
	const states = new Map<AccountProviderId, ProviderMenuState>();
	for (const id of SUPPORTED_PROVIDER_IDS) {
		const state = data.providers[id];
		states.set(id, {
			id,
			adapter: requireAdapter(adapters, id),
			active: state?.active,
			accounts: state?.accounts ?? Object.create(null),
		});
	}
	return states;
}

function emptyProviderMenuStates(
	adapters: Map<AccountProviderId, AccountProviderAdapter>,
): Map<AccountProviderId, ProviderMenuState> {
	return providerMenuStatesFromData({ version: 1, providers: Object.create(null) }, adapters);
}

function formatAccountsMenuTitle(
	ctx: ExtensionCommandContext,
	states: Map<AccountProviderId, ProviderMenuState>,
	hasAnyStoredAccount: boolean,
	currentAlias?: AccountAliasBinding,
	storageError?: string,
): string {
	if (storageError) {
		return [
			"Accounts",
			"",
			"The account settings file is invalid and remains read only.",
			"",
			"What do you want to do?",
		].join("\n");
	}
	if (!hasAnyStoredAccount) return "Accounts\n\nNo saved accounts yet.\n\nWhat do you want to do?";
	const activeLines = sortedProviderStates(states).map(
		(state) => `  ${state.adapter.displayName}: ${state.active ?? "default"}`,
	);
	return [
		"Accounts",
		"",
		"Current model:",
		`  ${formatCurrentModel(ctx, currentAlias)}`,
		"",
		"Active accounts:",
		...activeLines,
		"",
		"What do you want to do?",
	].join("\n");
}

function formatCurrentModel(
	ctx: ExtensionCommandContext,
	currentAlias?: AccountAliasBinding,
): string {
	if (!ctx.model) return "(none)";
	if (currentAlias) {
		return `${providerDisplayName(currentAlias.providerId)} · ${currentAlias.accountName} alias (experimental) / ${ctx.model.id}`;
	}
	const providerId = toProviderId(ctx.model.provider);
	const providerName = providerId ? providerDisplayName(providerId) : ctx.model.provider;
	return `${providerName} / ${ctx.model.id}`;
}

type AccountMainAction =
	| "login-route"
	| "switch-current"
	| "switch-route"
	| "remove-route"
	| "settings-route"
	| "status-route"
	| "help-route";

type AccountMainItem = { id: string; label: string; action: AccountMainAction };

function buildAccountMainItems(
	states: Map<AccountProviderId, ProviderMenuState>,
	currentState: ProviderMenuState | undefined,
	hasAnyStoredAccount: boolean,
	storageValid: boolean,
): AccountMainItem[] {
	const managerItems: AccountMainItem[] = [
		{ id: "settings", label: SETTINGS_ACTION, action: "settings-route" },
		{ id: "status", label: STATUS_ACTION, action: "status-route" },
		{ id: "help", label: HELP_ACTION, action: "help-route" },
	];
	if (!storageValid) return managerItems;
	if (!hasAnyStoredAccount) {
		return [{ id: "login", label: LOGIN_ACTION, action: "login-route" }, ...managerItems];
	}
	const currentHasAccounts = currentState ? accountNames(currentState).length > 0 : false;
	if (currentState && currentHasAccounts) {
		return [
			{
				id: currentState.id,
				label: switchCurrentProviderAction(currentState.adapter),
				action: "switch-current",
			},
			{ id: "login", label: LOGIN_ACTION, action: "login-route" },
			{ id: "remove", label: REMOVE_ACTION, action: "remove-route" },
			...(providerStatesWithAccounts(states, currentState.id).length > 0
				? [
						{
							id: "switch-other",
							label: SWITCH_ANOTHER_PROVIDER_ACTION,
							action: "switch-route" as const,
						},
					]
				: []),
			...managerItems,
		];
	}
	return [
		{ id: "login", label: LOGIN_ACTION, action: "login-route" },
		{
			id: "switch-provider",
			label: currentState ? SWITCH_ANOTHER_PROVIDER_ACTION : SWITCH_PROVIDER_ACTION,
			action: "switch-route",
		},
		{ id: "remove", label: REMOVE_ACTION, action: "remove-route" },
		...managerItems,
	];
}

function accountItemId(accountName: string): string {
	return `account:${encodeURIComponent(accountName)}`;
}

function removeAccountItemId(providerId: AccountProviderId, accountName: string): string {
	return `${providerId}:${encodeURIComponent(accountName)}`;
}

function switchCurrentProviderAction(adapter: AccountProviderAdapter): string {
	return `Switch ${adapter.displayName} account`;
}

function sortedProviderStates(
	states: Map<AccountProviderId, ProviderMenuState>,
): ProviderMenuState[];
function sortedProviderStates(states: readonly ProviderMenuState[]): ProviderMenuState[];
function sortedProviderStates(
	states: Map<AccountProviderId, ProviderMenuState> | readonly ProviderMenuState[],
): ProviderMenuState[] {
	const values = Array.isArray(states) ? [...states] : [...states.values()];
	return values.sort((left, right) =>
		left.adapter.displayName.localeCompare(right.adapter.displayName),
	);
}

function providerStatesWithAccounts(
	states: Map<AccountProviderId, ProviderMenuState>,
	excludeProviderId?: AccountProviderId,
): ProviderMenuState[] {
	return sortedProviderStates(states).filter(
		(state) => state.id !== excludeProviderId && accountNames(state).length > 0,
	);
}

function accountNames(state: ProviderMenuState): string[] {
	return Object.keys(state.accounts).sort();
}

function switchAccountOptions(activeName: string | undefined, names: string[]): string[] {
	const active = activeName ?? "default";
	const sortedNames = [...names].sort();
	const options = [formatSwitchAccountOption(active, true)];
	for (const name of sortedNames) {
		if (name !== active) options.push(formatSwitchAccountOption(name, false));
	}
	if (active !== "default") options.push(formatSwitchAccountOption("default", false));
	return options;
}

function formatSwitchAccountOption(name: string, active: boolean): string {
	return active ? `✓ ${name}` : name;
}

function stripActiveMarker(value: string): string {
	return value.replace(/^✓\s+/, "");
}

function removeAccountOptions(
	states: Map<AccountProviderId, ProviderMenuState>,
	currentProviderId?: AccountProviderId,
): Array<{ label: string; adapter: AccountProviderAdapter; accountName: string }> {
	const providerStates = providerStatesWithAccounts(states);
	if (currentProviderId) {
		const currentIndex = providerStates.findIndex((state) => state.id === currentProviderId);
		if (currentIndex > 0) {
			const [current] = providerStates.splice(currentIndex, 1);
			if (current) providerStates.unshift(current);
		}
	}
	return providerStates.flatMap((state) =>
		accountNames(state).map((accountName) => ({
			label: `${state.adapter.displayName} · ${accountName}`,
			adapter: state.adapter,
			accountName,
		})),
	);
}

function providerDisplayName(providerId: AccountProviderId): string {
	switch (providerId) {
		case "anthropic":
			return "Anthropic";
		case "github-copilot":
			return "GitHub Copilot";
		case "openai-codex":
			return "OpenAI Codex";
	}
}

async function loginAccount(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	store: AccountStore,
	adapter: AccountProviderAdapter,
	nameArg: string,
	signal: AbortSignal,
	syncProvider: (
		providerId: AccountProviderId,
		ctx: ExtensionContext,
	) => Promise<EnsureActiveProviderAuthResult>,
	reconcileAliases: () => Promise<AccountAliasStatus>,
	isCurrent: () => boolean,
): Promise<void> {
	const parsed = parseAccountName(nameArg);
	if (!parsed.ok) return ctx.ui.notify(parsed.error, "warning");
	if (isDefaultPiLoginArg(parsed.name)) {
		ctx.ui.notify('"default" is reserved for Pi\'s built-in login.', "warning");
		return;
	}
	if (!ctx.hasUI) {
		ctx.ui.notify("Account login requires interactive UI.", "error");
		return;
	}
	const state = await store.readProviderAsync(adapter.id);
	if (!isCurrent()) return;
	if (getOwnCredential(state.accounts, parsed.name)) {
		const confirmed = await ctx.ui.confirm(
			"Replace account",
			`${adapter.displayName} account "${parsed.name}" already exists. Replace it?`,
		);
		if (!confirmed || !isCurrent()) return;
	}
	ctx.ui.notify(`Starting ${adapter.displayName} login for "${parsed.name}".`, "info");
	try {
		const credential = normalizeStoredCredential(
			await loginWithOAuthUI(ctx, adapter, signal),
			parsed.name,
		);
		if (!isCurrent()) return;
		await store.updateProvider(adapter.id, (state) =>
			isCurrent()
				? {
						...state,
						active: parsed.name,
						accounts: defineOwn(state.accounts, parsed.name, credential),
					}
				: state,
		);
		if (!isCurrent()) return;
		const aliasStatus = await reconcileAliases();
		if (aliasStatus.error) throw new Error(aliasStatus.error);
		if (!isCurrent()) return;
		const result = await syncProvider(adapter.id, ctx);
		if (!isCurrent()) return;
		await selectDefaultModelIfUnknown(pi, ctx, adapter);
		if (!isCurrent()) return;
		ctx.ui.notify(
			formatActivationMessage("Logged in", adapter, parsed.name, result),
			result.status === "active" ? "info" : "error",
		);
	} catch (error) {
		if (!isCurrent()) return;
		ctx.ui.notify(
			`${adapter.displayName} login failed: ${redactTokenText(errorMessage(error))}`,
			"error",
		);
	}
}

async function switchAccount(
	ctx: ExtensionCommandContext,
	store: AccountStore,
	adapter: AccountProviderAdapter,
	nameArg: string,
	syncProvider: (
		providerId: AccountProviderId,
		ctx: ExtensionContext,
	) => Promise<EnsureActiveProviderAuthResult>,
): Promise<void> {
	const name = nameArg.trim();
	if (!name) {
		ctx.ui.notify(`Select a ${adapter.displayName} account from /accounts.`, "warning");
		return;
	}
	if (isDefaultPiLoginArg(name)) {
		await store.updateProvider(adapter.id, (state) => ({ ...state, active: undefined }));
		const result = await syncProvider(adapter.id, ctx);
		if (result.status === "error") {
			ctx.ui.notify(
				`Could not restore default Pi ${adapter.displayName} login; requests will fail closed: ${result.message}`,
				"error",
			);
			return;
		}
		ctx.ui.notify(`Using default Pi ${adapter.displayName} login.`, "info");
		return;
	}
	const parsed = parseAccountName(name);
	if (!parsed.ok) return ctx.ui.notify(parsed.error, "warning");
	let found = false;
	await store.updateProvider(adapter.id, (state) => {
		if (!getOwnCredential(state.accounts, parsed.name)) return state;
		found = true;
		return { ...state, active: parsed.name };
	});
	if (!found) {
		ctx.ui.notify(`${adapter.displayName} account "${parsed.name}" was not found.`, "warning");
		return;
	}
	const result = await syncProvider(adapter.id, ctx);
	ctx.ui.notify(
		formatActivationMessage("Activated", adapter, parsed.name, result),
		result.status === "active" ? "info" : "error",
	);
}

async function removeAccount(
	ctx: ExtensionCommandContext,
	store: AccountStore,
	adapter: AccountProviderAdapter,
	nameArg: string,
	syncProvider: (
		providerId: AccountProviderId,
		ctx: ExtensionContext,
	) => Promise<EnsureActiveProviderAuthResult>,
	reconcileAliases: () => Promise<AccountAliasStatus>,
	currentAlias?: AccountAliasBinding,
): Promise<void> {
	const parsed = parseAccountName(nameArg);
	if (!parsed.ok) return ctx.ui.notify(parsed.error, "warning");
	let removed = false;
	let removedActive = false;
	await store.updateProvider(adapter.id, (state) => {
		if (!getOwnCredential(state.accounts, parsed.name)) return state;
		removed = true;
		removedActive = state.active === parsed.name;
		const accounts = defineOwnMap(state.accounts);
		delete accounts[parsed.name];
		return { ...state, active: removedActive ? undefined : state.active, accounts };
	});
	if (!removed) {
		ctx.ui.notify(`${adapter.displayName} account "${parsed.name}" was not found.`, "warning");
		return;
	}
	const aliasStatus = await reconcileAliases();
	if (aliasStatus.error) throw new Error(aliasStatus.error);
	if (currentAlias?.providerId === adapter.id && currentAlias.accountName === parsed.name) {
		ctx.ui.notify(
			`The selected alias ${currentAlias.aliasId} was removed. Select another model with /model.`,
			"warning",
		);
	}
	if (removedActive) {
		const result = await syncProvider(adapter.id, ctx);
		if (result.status === "error") {
			ctx.ui.notify(
				`Removed ${adapter.displayName} account "${parsed.name}", but default auth restoration failed closed: ${result.message}`,
				"error",
			);
			return;
		}
	}
	ctx.ui.notify(`Removed ${adapter.displayName} account "${parsed.name}".`, "info");
}

async function selectDefaultModelIfUnknown(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	adapter: AccountProviderAdapter,
): Promise<void> {
	if (!adapter.defaultModelId || !isUnknownModel(ctx.model)) return;
	const model = ctx.modelRegistry.find(adapter.id, adapter.defaultModelId);
	if (!model) {
		ctx.ui.notify(
			`Logged in, but ${adapter.id}/${adapter.defaultModelId} was not found.`,
			"warning",
		);
		return;
	}
	if (!(await pi.setModel(model))) {
		ctx.ui.notify(`Logged in, but selecting ${adapter.defaultModelId} failed.`, "warning");
	}
}

function isUnknownModel(model: NonNullable<ExtensionContext["model"]> | undefined): boolean {
	return model?.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

function accountsFilePath(): string {
	return join(getAgentDir(), "pi-accounts.json");
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

function isDefaultPiLoginArg(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		normalized === "default" || normalized === "--default" || normalized === DEFAULT_PI_LOGIN_LABEL
	);
}

function formatActivationMessage(
	action: "Logged in" | "Activated",
	adapter: AccountProviderAdapter,
	name: string,
	result: EnsureActiveProviderAuthResult,
): string {
	if (
		result.status !== "inactive" &&
		result.accountName !== "unknown" &&
		result.accountName !== name
	) {
		return `${action} ${adapter.displayName} account "${name}" was superseded by "${result.accountName}" before activation.`;
	}
	if (result.status === "error") {
		return `${action} ${adapter.displayName} account "${name}", but authentication failed; requests will fail closed: ${result.message}`;
	}
	if (result.status === "inactive") {
		return `${action} ${adapter.displayName} account "${name}" was superseded before activation.`;
	}
	return `${action} ${adapter.displayName} account "${name}".`;
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
