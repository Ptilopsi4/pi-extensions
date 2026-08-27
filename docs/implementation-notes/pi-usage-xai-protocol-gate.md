# pi-usage xAI protocol gate

Gate date: 2026-08-27.

Related issue: [#1051](https://github.com/narumiruna/pi-extensions/issues/1051).

## Outcome

The disposable-account protocol-validation gate is blocked.

The test environment has no xAI credential available through Pi's official `readStoredCredential("xai")` API, and `XAI_API_KEY` is unset.

An inference API key would not satisfy the gate because the proposed consumer request requires a Pi-managed xAI OAuth bearer.

No request was sent to `cli-chat-proxy.grok.com`, and no xAI adapter, package documentation claim, statusline behavior, test fixture, or Changeset was added.

Implementation must remain disabled until the unresolved live contract below is validated with a disposable SuperGrok or X subscription account.

## Revalidated official revisions

The current default-branch heads matched the planned revisions when this gate was run.

| Source | Current revision | Relevant contract |
| --- | --- | --- |
| [`earendil-works/pi`](https://github.com/earendil-works/pi/tree/e86823096c5bad39e1ca282ec24bc5eb9bec745b) | `e86823096c5bad39e1ca282ec24bc5eb9bec745b` | xAI provider origin, API-key auth, and Pi-managed OAuth |
| [`xai-org/grok-build`](https://github.com/xai-org/grok-build/tree/77cd7eb675ba911c225c3aaeeece3a20cbccc426) | `77cd7eb675ba911c225c3aaeeece3a20cbccc426` | Consumer identity and credits requests, headers, and response structs |
| [`xai-org/xai-proto`](https://github.com/xai-org/xai-proto/tree/723dd2aa22d17be35617463837dc47cda008d90e) | `723dd2aa22d17be35617463837dc47cda008d90e` | Public team-management billing definitions |

Pi's xAI provider uses `https://api.x.ai/v1` for inference and supports either `XAI_API_KEY` or a Pi-managed OAuth login for a Grok/X subscription.

Pi's OAuth scope is `openid profile email offline_access grok-cli:access api:access`, and its runtime auth uses the OAuth access token as the inference API key.

The public `xai-proto` billing service operates on team IDs and does not establish that an inference API key may read consumer or team billing.

## Source-observed consumer flow

The pinned Grok Build revision queries `GET https://cli-chat-proxy.grok.com/v1/user?include=subscription` to obtain the live subscription tier and a canonical `userId`.

Its billing handler then queries `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` and sends the stored user ID as `x-userid`.

The source sends these headers on the user request:

- `Authorization: Bearer <OAuth access token>`;
- `X-XAI-Token-Auth: xai-grok-cli`;
- `x-grok-client-version: <xai-grok-version::VERSION>`;
- `x-grok-client-mode: interactive|headless`;
- a Grok Build `User-Agent` installed on the shared HTTP client.

The billing request sends the same headers plus `x-userid`.

Grok Build comments describe `x-grok-client-version` as required by the proxy's version gate.

At the pinned revision, `xai-grok-version::VERSION` uses the build-time `GROK_VERSION` value when supplied and otherwise falls back to the `xai-grok-version` package version `1.0.10`.

That fallback is source evidence, not permission for `pi-usage` to identify itself as Grok Build or proof that the proxy accepts the value from another client.

The first-party source also always supplies `x-grok-client-mode` and a Grok Build `User-Agent`, so source inspection alone cannot prove that either may be omitted or truthfully replaced by a `pi-usage` identity.

The credits response contract contains a preferred `config.creditUsagePercent`, a typed `config.currentPeriod`, legacy `monthlyLimit` and `used` cents, optional on-demand cents, optional prepaid balance cents, and optional subscription-tier text.

The first-party UI clamps the preferred percentage, falls back to legacy values only when needed, and displays accounting cents with absolute-value behavior where applicable.

## Exact missing live contract

A disposable Pi-managed xAI OAuth account is required to establish all of the following without guessing:

1. Whether the Pi OAuth bearer is accepted by both consumer endpoints without Grok Build's persisted identity or device state.
2. The minimum accepted header set for `/user?include=subscription` and `/billing?format=credits`.
3. Whether `x-grok-client-version` is mandatory for these two requests and which value a non-Grok client is permitted to send.
4. Whether `x-grok-client-mode` and the Grok Build `User-Agent` are mandatory, optional, or replaceable with truthful `pi-usage` identification.
5. Whether `/user` returns a non-empty canonical `userId` for the same bearer and whether billing requires that value only as `x-userid`.
6. Whether the live credits payload matches the pinned structs for a disposable subscription account.
7. Whether both endpoints complete without redirects when the client rejects every redirect.

The gate must stop if reproducing the flow requires undocumented Grok Build files, device state, client impersonation, or any credential other than the freshly matched Pi OAuth bearer.

## Required validation procedure

Use a disposable SuperGrok or X subscription account and authenticate it through Pi's `/login xai` flow.

Resolve the effective runtime bearer through Pi, then require an exact match with a complete OAuth candidate from Pi's stored credential API or the extension-neutral `oauth:credential-source:v1` protocol.

Run a bounded request matrix against only `https://cli-chat-proxy.grok.com`, with redirects rejected and with candidate headers removed one at a time.

Record only status classes, accepted header names, sanitized field presence, and bounded schema observations.

Never record bearer values, refresh tokens, authenticated headers, raw bodies, user IDs, email addresses, or account labels.

After the live gate passes, implement the complete adapter, lifecycle races, privacy tests, menu integration, README changes, package smoke, and minor Changeset described by the implementation plan.

## Safety evidence

Credential inspection used Pi's package-root `readStoredCredential` API and emitted only credential presence metadata.

The official stored xAI credential was absent, and no secret value was printed, persisted, logged, or added to this repository.

No Grok Build credential files or other extension-owned files were read.

Because no qualifying OAuth bearer was available, the safest and strongest valid result is this revision-pinned gate record rather than speculative runtime behavior.
