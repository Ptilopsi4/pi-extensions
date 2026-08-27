# 📊 pi-usage — Check Provider Usage and Codex Fast Mode

[![npm](https://img.shields.io/npm/v/@narumitw/pi-usage)](https://www.npmjs.com/package/@narumitw/pi-usage) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Check the limits and usage for the provider account Pi is actually using, toggle Fast mode for supported OpenAI Codex models, and report xAI OAuth subscription usage.

The extension reports each provider's native semantics instead of presenting unlike quotas as equivalent.
xAI reporting defaults On, and the Settings screen warns that it uses an undocumented first-party consumer endpoint.

## ✨ Features

- Shows current-account usage and next actions through `/usage`.
- Supports OpenAI Codex subscription windows, credits, resets, and model-specific buckets.
- Supports GitHub Copilot allowances and OpenRouter per-key limits and spend windows.
- Supports xAI OAuth subscription allowance and credit reporting.
- Toggles persistent Codex Fast routing through `/fast` or the contextual usage menu.
- Redeems eligible Codex resets only after fresh account matching and explicit confirmation.
- Refreshes one or all configured providers with bounded concurrency and partial-result preservation.
- Keeps statusline and cache data scoped to the current provider and runtime account.
- Resolves credentials through Pi or the process-local OAuth credential-source protocol and validates the effective provider endpoint before sending them.

## 📦 Install

Requires Pi 0.81.0 or newer so the extension can validate the effective base URL attached to resolved provider auth before sending credentials to an official usage endpoint.
The v1 credential-source interoperability path is characterized against Pi 0.84.3; other runtimes retain standalone fallback but do not receive the protocol timing guarantee.

```bash
pi install npm:@narumitw/pi-usage
```

Try without installing permanently:

```bash
pi -e npm:@narumitw/pi-usage
```

Build and try this package locally from the repository root:

```bash
npm --workspace @narumitw/pi-usage run build
pi -e ./packages/pi-usage
```

The package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.

## 🚀 Quick start

Run `/usage` in TUI or RPC mode to inspect the current provider, refresh usage, or choose another configured provider.
Use `/fast` separately to toggle Fast mode for a supported current Codex model.

## 💬 Commands

Run:

```text
/usage
```

In TUI or RPC mode, the standard menu first queries the current model provider and presents its state with these actions:

```text
Refresh current usage
Settings
Turn Fast mode on/off       # Supported current Codex models only
Redeem usage limit reset…   # Current Codex OAuth accounts only
View another configured provider…
View all configured providers…
Close
```

There are intentionally no `/usage --refresh`, `/usage <provider>`, or `/usage --all` argument paths.
Cross-provider traffic requires an explicit interactive choice.
Escape returns from provider selection and closes the root menu.
Print and JSON modes reject `/usage` observably because they cannot host the interactive flow.
The cancellable live-query progress view remains extension-owned because it streams provider work and supports in-flight abort rather than presenting a standard menu screen.

For the current OpenAI Codex provider, **Redeem usage limit reset…** checks fresh earned-reset details, lets you select a reset when details are available, and shows the exact reset before asking for confirmation.
**No, go back** is the safe default and cancellation before confirmation sends no mutation.
After confirmation, the reset operation cannot be cancelled from its progress view; session replacement or shutdown still aborts owned work.
A transport failure offers **Try again** with the same redemption request ID so the backend can treat an uncertain retry idempotently.
Successful, already-completed, not-needed, and no-credit outcomes are reported separately, then usage and the statusline are refreshed for the still-current account.

## ⚙️ Settings

Choose **Settings** in `/usage` to edit Codex Fast mode and xAI usage through Pi's settings-list interaction in TUI mode.
The xAI row retains a warning that usage queries send the matched OAuth bearer to an undocumented first-party endpoint.
RPC mode reports the active manual settings path instead of opening terminal UI.

Both preferences live in Pi's user agent directory as `pi-usage.json`, normally `~/.pi/agent/pi-usage.json`.
The file reloads at every session start and is not created until the first successful save.
Changes save immediately in input order inside one Pi process.
Unknown JSON fields are preserved, writes use a private temporary file plus rename, and malformed or invalid files remain untouched.
A failed save restores the prior displayed and effective value, while shutdown waits for queued writes.
Separate Pi processes are not mutually locked.

### Codex Fast mode

Run bare `/fast` to toggle Fast for the active supported Codex model, or use **Turn Fast mode on/off** in `/usage`.

Fast is about 1.5× faster and uses more of your plan allowance.
The `codexFastMode` preference defaults to Off.

Fast currently applies only to official `openai-codex-responses` requests for `gpt-5.4`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` at `https://chatgpt.com`.
It sends `service_tier: "priority"` while enabled and explicit `service_tier: "default"` otherwise.
The statusline adds `fast` only while the preference is effective, for example `codex fast 59% 5h`.
Unsupported models and custom or proxy origins are left unchanged.

`/fast` supports TUI and RPC mode, accepts no arguments, and rejects print or JSON mode before mutation.
A toggle affects provider requests whose payload hook starts after the save; a request already sent is unchanged.
Repair or remove an invalid file, then run `/reload` before trying the toggle again.

### xAI usage

> **Privacy warning:** xAI usage sends the OAuth bearer matched to Pi's current runtime account to the undocumented first-party `https://cli-chat-proxy.grok.com` consumer service.

The `xaiUsage` preference defaults to `true` when the settings file or field is absent.
Turn it Off in the TUI Settings screen or edit the active user file manually, then run `/reload`:

```json
{
  "xaiUsage": false
}
```

While enabled, xAI is available only through explicit `/usage` current, configured-provider, or all-provider actions.
It does not schedule xAI requests or publish xAI data to the statusline.
The disabled, malformed, and invalid-settings states perform no xAI usage auth resolution or consumer requests.
Turning it Off clears xAI cache state and prevents stale in-flight results from being published.

## 📋 Provider semantics

### OpenAI Codex

- Provider ID: `openai-codex`
- Semantics: ChatGPT consumer subscription limits
- Source: the Codex usage and earned-reset endpoints using Pi's resolved runtime authorization
- Displayed data: returned duration-based windows, resets, credits, earned usage-limit resets, and additional model buckets
- Reset mutation: `POST /wham/rate-limit-reset-credits/consume` with a unique redemption request ID and, when available, the selected opaque credit ID
- Statusline examples: `codex 59% 5h 61% wk`, `codex fast 59% 5h`, or `codex spark 100% 5h`

The statusline selects a returned bucket that matches the current Codex model when one is available.
Unlike `pi-codex-usage`, this successor intentionally has no Codex CLI fallback because the CLI may be logged into a different account than Pi's active runtime account.

Reset redemption is available only when Codex is the current provider and Pi's freshly resolved access token exactly matches an OAuth credential from Pi's stored login or a compatible credential source.
`pi-usage` forwards only the bearer authorization and matching `chatgpt-account-id` to the official ChatGPT origin.
API-key credentials, configured-but-not-current Codex accounts, account changes during the flow, and custom/proxy origins fail before mutation.
Backend-provided titles and descriptions are sanitized for terminal display.
Opaque credit and account IDs are never shown or persisted by the extension.

### GitHub Copilot

- Provider ID: `github-copilot`
- Semantics: the allowance reported for the active Copilot plan—AI credits for current usage-based billing, premium requests for legacy annual billing, or chat requests for Copilot Free's limited response shape
- Source: GitHub's undocumented `GET /copilot_internal/user` endpoint
- Displayed data: entitlement, remaining allowance, percentage, reset time, plan, and any additional usage beyond the included allowance
- Statusline examples: `copilot credits 1200/1500 80%`, `copilot 245/300 82%`, or `copilot chat 40/50 80%`

GitHub's quota endpoint requires the original GitHub OAuth token rather than the short-lived Copilot inference token exposed by runtime auth.
`pi-usage` supports Copilot accounts created through Pi's `/login` flow and named accounts offered by a compatible `oauth:credential-source:v1` owner.
It uses a candidate only when its short-lived access token exactly matches the freshly resolved active runtime credential.
Duplicate equivalent candidates are harmless, while conflicting matches fail closed without choosing by extension load order.
API-key credentials, account mismatches, GitHub Enterprise accounts, and proxy/custom provider origins fail closed.
The detailed report follows the endpoint's `token_based_billing` marker so AI credits are not mislabeled as legacy premium requests, and it reports overage without treating a negative included balance as a malformed response.

### OpenRouter

- Provider ID: `openrouter`
- Semantics: API-key spend and per-key credit limits—not consumer subscription quota
- Source: OpenRouter's documented [`GET /api/v1/key`](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) endpoint using Pi's resolved inference API key
- Displayed data: key label when safely returned, optional per-key limit and remaining amount, reset period, and daily/weekly/monthly/all-time spend
- Statusline examples: `openrouter $74.50 left` or `openrouter $25.50 used`

The extension does not call OpenRouter's account-level `/credits` endpoint because that operation requires a separate management key.
OpenRouter documents the distinction between credit and rate limits in its [API limits guide](https://openrouter.ai/docs/api_reference/limits).

### OpenCode Go (Zen)

- Provider ID: `opencode-go`
- Semantics: OpenCode Zen plan usage windows—rolling, weekly, and monthly
- Source: `GET https://opencode.ai/zen/go/v1/usage` using Pi's resolved inference API key
- Displayed data: used percentage and reset time for each window; `rate-limited` windows remain visible at their reported usage, while unknown statuses are reported as unavailable notes
- Statusline examples: `zen 0% r 4% w 2% m`

The fixed endpoint is queried only when the candidate OpenCode Go model and the resolved provider-auth base URL, when present, use the official `https://opencode.ai` origin; other origins fail before sending the credential.

### xAI consumer subscriptions

- Provider ID: `xai`
- Semantics: consumer subscription allowance and credits, not xAI API-team billing
- Identity route: `GET https://cli-chat-proxy.grok.com/v1/user?include=subscription`
- Billing route: `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`
- Displayed data: included allowance percentage or legacy monetary limit, weekly or monthly period and reset, on-demand spend and cap, prepaid balance, and a sanitized optional plan tier
- Statusline: not published; xAI is queried only through an explicit `/usage` action while xAI usage is enabled

The adapter accepts only the official Pi inference origin `https://api.x.ai` and a freshly resolved bearer that exactly matches one complete Pi OAuth credential.
Pi's reviewed OAuth scope is `openid profile email offline_access grok-cli:access api:access`.
`XAI_API_KEY`, duplicate or conflicting OAuth candidates, account mismatches, incomplete OAuth records, custom origins, and proxy-resolved origins fail before consumer-proxy access.
API-key users can review API-team spend through [console.x.ai](https://console.x.ai/) instead.
The public Management API requires a separate management key and team ID and is intentionally outside this runtime-credential integration.

The identity response supplies a transient proxy-canonical `userId` that is validated and sent as `x-userid` only on the billing request.
The extension sends the matched bearer as `Authorization` plus Grok Build's source-defined non-secret `X-XAI-Token-Auth`, client-version, and interactive client-mode headers.
It does not read Grok Build files, device state, names, email, or other profile fields.
Responses are body-bounded, redirects are rejected, raw identity and billing payloads are not retained, and secrets are redacted from errors.
Included allowance, on-demand usage, and prepaid balance remain distinct because they represent different billing concepts.

The implementation contract was selected from these first-party revisions:

- Pi [`providers/xai.ts`](https://github.com/earendil-works/pi/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/ai/src/providers/xai.ts) and [`auth/oauth/xai.ts`](https://github.com/earendil-works/pi/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/ai/src/auth/oauth/xai.ts) at `e868230`, revalidated byte-for-byte for those files at [`ccfe79e`](https://github.com/earendil-works/pi/tree/ccfe79ed238674f760c986e3a61493aab794000a).
- Grok Build [`UserInfo`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-shell/src/auth/model.rs), [`subscription_check.rs`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-shell/src/agent/subscription_check.rs), [`billing.rs`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-shell/src/extensions/billing.rs), [`auth/config.rs`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-shell/src/auth/config.rs), [`xai-grok-http`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-http/src/lib.rs), and [`xai-grok-version`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-version/Cargo.toml) at `9684fa3`.
- [xAI Management API team billing boundary at `723dd2a`](https://github.com/xai-org/xai-proto/blob/723dd2aa22d17be35617463837dc47cda008d90e/proto/xai/management_api/v1/billing.proto).

The approved 2026-08-27 disposable-or-maintainer-account protocol smoke used only Pi's OAuth bearer, read no Grok-local files, and received HTTP 200 without redirects from both routes.
The implementation also sends the non-secret client headers present on both routes in current Grok Build source, with `x-userid` added only for billing.
The sanitized identity shape contained a string `userId` and nullable `subscriptionTier`; the billing shape contained an object `config` with period and distinct on-demand and prepaid wrappers, without retaining field values.

These consumer routes are not a stable public API and may change or disappear without notice.
Disable `xaiUsage` to stop all xAI consumer usage traffic while preserving other provider behavior.

### Z.AI (GLM Coding Plan)

- Provider ID: `zai` and `zai-coding-cn`
- Semantics: GLM Coding Plan quota windows—the rolling 5-hour and weekly plan-usage windows plus the monthly MCP allowance
- Source: Z.AI's undocumented `GET {origin}/api/monitor/usage/quota/limit` endpoint, also used by its official coding plugin, with the origin derived from the model base URL (`https://api.z.ai` or `https://open.bigmodel.cn`)
- Displayed data: explicit used and remaining values, reset times, provider-reported per-tool MCP details, and the reported plan level. Windows that report only a percentage remain percent-based
- Statusline: not published; Z.AI is queried only through `/usage` actions

The monitor endpoint is not a published API contract and may return legacy `TOKENS_LIMIT` or newer `CREDIT_LIMIT` window names.
The extension classifies both forms by the provider's window unit and does not label provider-reported counts as tokens or calls.
The quota monitor expects the raw API key without a `Bearer` prefix, so the extension strips a `Bearer` prefix from the resolved authorization before sending it to the monitor endpoint.
Fingerprinting and redaction keep using the original resolved credential.
Only the official `api.z.ai` and `open.bigmodel.cn` origins are queried; other origins fail before sending the credential.

## 🧭 Current and configured accounts

`Current` means the provider and credential used by Pi's selected model.
`Configured` means Pi reports runtime auth for another supported provider; it does not mean that provider is active.

The extension does not enumerate multiple accounts inside one provider and does not switch accounts.
Account selection remains owned by Pi or an account-management extension.
A compatible credential owner may offer the verified active named account through the versioned process-local protocol without exposing its account label or storage.
Without such an owner, `pi-usage` retains its standalone Pi `auth.json` behavior.
An older or incompatible owner degrades to the existing authentication-unavailable result when the stored login does not match runtime auth.
After the active runtime credential changes, the next command, turn, or scheduled refresh resolves auth again and cannot reuse another account's cached report.

## 📊 Statusline behavior

The `usage` status item is active only for selected providers that publish statusline usage.
It refreshes every five minutes while the session remains on such a provider and is cleared when the model changes to an unsupported or menu-only provider.
xAI is always menu-only and never starts a scheduled status refresh.

Manual another-provider and all-provider queries never publish to the statusline.
`@narumitw/pi-statusline` supplies the default `📊` icon; `pi-usage` publishes text-only values.

## 🔄 Migrating from pi-codex-usage

`pi-codex-usage` is deprecated and its source is archived under `deprecated/`.
To migrate one installation:

```bash
pi remove npm:@narumitw/pi-codex-usage
pi install npm:@narumitw/pi-usage
```

Remove the deprecated package rather than loading both usage extensions together.

Behavior changes:

- Use `/usage` for usage management; `/codex-status` is no longer registered.
- Refresh and cross-provider operations are menu actions rather than flags.
- Codex CLI fallback is removed to preserve active-runtime-account correctness.
- The status key changes from `codex-usage` to `usage`.

## 🔒 Security and privacy

Credential candidates are collected synchronously in memory and are not cached, persisted, logged, formatted, or appended to the Pi session.
The protocol carries no account name or extension identity.
Only the selected provider's exact runtime match is used, and secrets are sent only to the validated official provider origin.
Pi extensions run with the user's process privileges, so the shared event bus is not a security boundary between installed extensions.
Install only trusted extensions because any installed extension may already read user files and process memory.
Protocol v1 interoperability is characterized for the repository's supported Pi runtime; an absent or incompatible peer preserves standalone fallback and fail-closed mismatch behavior.

## 🚧 Limitations

- Only providers with a meaningful usage source and verifiable Pi runtime auth are supported.
- GitHub Copilot quota, Z.AI quota, xAI consumer usage, and OpenAI Codex reset redemption use undocumented provider endpoints that may change without notice.
- Codex reset redemption requires a current ChatGPT OAuth credential from Pi's login or a compatible credential source; Codex API keys cannot redeem earned subscription resets.
- xAI usage supports only a uniquely matched Pi OAuth subscription credential; xAI API keys and Management API credentials are unsupported.
- Credentials resolved for custom provider base URLs are never forwarded to the providers' official usage endpoints; effective auth origin validation requires Pi 0.81.0 or newer.
- Provider reports are snapshots and may themselves be delayed by the provider.
- OpenRouter successful inference responses do not expose proactive request-rate counters; `/usage` reports the documented per-key credit/spend fields instead.
- A provider may not return a safe human-readable account identity.
  In that case the provider and runtime credential state remain visible without exposing secrets.
- Immediate account-change events are not available from Pi; auth is re-resolved before commands, turns, and scheduled refreshes.
- Fast model support is intentionally conservative and may require an extension update when Codex adds or removes service tiers.
- Another later-loaded extension can replace the final provider payload, so arbitrary third-party payload-rewrite conflicts cannot be prevented.

## 🗂️ Package layout

```txt
packages/pi-usage/
├── dist/                  # Generated TypeScript runtime loaded by Jiti
├── scripts/
│   └── build-runtime.mjs  # Deterministic runtime builder and boundary validator
├── src/
│   ├── index.ts       # Pi package entrypoint and helper export barrel
│   ├── usage.ts       # Menu, cache, and usage lifecycle orchestration
│   ├── usage-settings-ui.ts # Pi SettingsList interaction and save rollback
│   ├── codex-fast.ts  # Fast eligibility, request tier, and cost correction
│   ├── codex-fast-runtime.ts # Fast command, persistence lifecycle, and request hooks
│   ├── settings.ts    # Validated user settings and atomic persistence
│   ├── usage-helpers.ts # Small orchestration helpers
│   ├── query.ts       # Runtime auth resolution and bounded provider queries
│   ├── oauth-credential-source.ts # Ephemeral OAuth candidate collection
│   ├── codex-resets.ts # Codex reset auth, API contracts, and normalization
│   ├── format.ts      # Provider-aware notifications and statusline text
│   ├── core.ts        # Cache, concurrency, fingerprint, and redaction helpers
│   ├── providers/     # Provider-specific usage normalization adapters
│   └── types.ts       # Common presentation and adapter contracts
├── test/
├── README.md
├── LICENSE
├── tsconfig.json
└── package.json
```

`index.ts` is the Pi entrypoint and forwards the default factory from `usage.ts` while retaining the package's named helper exports; other source modules are internal.

The generated runtime is built from the authoritative `src/index.ts` graph and does not import back into `src`.

## 🔎 Keywords

Pi extension, Pi coding agent, usage, quota, OpenAI Codex usage, ChatGPT subscription limits, GitHub Copilot AI credits, GitHub Copilot premium requests, OpenRouter credits, xAI OAuth usage, Grok subscription allowance, API-key spend limits, TypeScript Pi package, npm Pi extension.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
