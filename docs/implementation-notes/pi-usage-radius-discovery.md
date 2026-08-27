# pi-usage Radius discovery gate

## Decision

The Radius usage adapter is blocked as of 2026-08-27.

No Radius provider code, response fixture, README support claim, or Changeset may be added from this discovery because the mandatory usage and gateway-origin contracts remain unresolved.

The authoritative request for the missing upstream contract is recorded on [issue #1051](https://github.com/narumiruna/pi-extensions/issues/1051#issuecomment-5435918502).

## Revalidated sources

| Source | Revision or response evidence |
| --- | --- |
| `earendil-works/pi` current `main` | `e86823096c5bad39e1ca282ec24bc5eb9bec745b` |
| Repository-resolved `@earendil-works/pi-ai` 0.84.3 source | `bfb004d4418ff05c6f909eaaab856cbe75c1fde0` |
| `packages/ai/src/providers/radius.ts` at both revisions | SHA-256 `a65c0513e1999b318425a49117ebed6f38970702454730287287b644d4825f7f` |
| `packages/ai/src/providers/radius-config.ts` at both revisions | SHA-256 `1f82a7db25753be09374792ae0a3cd63417739018fb69b3212ad8b3b9eb11c21` |
| `packages/ai/src/auth/oauth/radius.ts` at both revisions | SHA-256 `a4c520d7ea0f605da1cb4499e8532c5e058cb9fda4d162bd347526bd66351801` |
| Live `GET https://radius.pi.dev/v1/agent.md` | HTTP 200; SHA-256 `dd23f9494a851b80430f34a0528680feff2006c31939ca491c992a3caf9b6c01` |
| Live `GET https://radius.pi.dev/v1/openapi.json` | HTTP 200; OpenAPI 3.1.0; SHA-256 `c5cc70fe31536029314a633606f526a57fb5aa12315f39b0e8c2f07f86bfd605` |
| Live operation search | HTTP 200; SHA-256 `2ccbbcdbf23ca8b3a620e8ba9f0dfdac80484fb47cf6054ecdef7811773b5da6` |
| Live `context.read` contract | HTTP 200; SHA-256 `15e4987ae1ea1dffe4e67ee640da997b007f7106f59c53def95aa076bda12035` |
| Live `budgets.list` contract | HTTP 200; SHA-256 `bdb5fb522c596853c8b7bb1d52f25132cb9205d9a060b3e7183a524a0686c7e1` |
| Live `analytics.schema.read` contract | HTTP 200; SHA-256 `c78bb4c51e45e3a669bfb96b6f17511fe845fde822627bd504ec6c2d508d5f38` |
| Live `analytics.query.run` contract | HTTP 200; SHA-256 `2afe1a79f0ef5e987a09eea3350ebd12bc43aa410261025b16cf1849ee8678f0` |

The current and repository-resolved Pi revisions contain byte-identical Radius provider, gateway-config, and OAuth source files.

The live OpenAPI server identity is `https://radius.pi.dev`, and the public `/v1/config` response currently returns the same inference origin.

The public `/v1/oauth` response returns a separate browser authorization origin at `https://radius.earendil.com`, which the Radius agent guide says must never receive a Radius bearer.

## Credential and disposable-account discovery

The available Pi auth stores contained no `radius` entry, and the process environment contained no Radius credential variable.

Only provider names, credential types, file modes, and credential-field presence were inspected; no credential values were printed or copied.

An official device authorization was initiated with `POST https://radius.pi.dev/v1/oauth/device` as the source-backed disposable-account attempt.

The response was HTTP 200 with the documented device-code fields, a 300-second expiry, and a browser verification origin at `https://radius.earendil.com`.

The external sign-in could not be completed autonomously without an account identity or user action.

The device code and user code were withheld from output and destroyed immediately, and no bearer was obtained or sent.

Unauthenticated requests to `/v1/context`, `/v1/budgets`, and `/v1/analytics/schema` each returned HTTP 401 without a redirect.

No organization, actor, budget, or physical analytics response was available to sanitize into a fixture.

Inventing those response fields would violate the discovery gate.

## Live contract findings

`GET /v1/context` documents an actor user ID, selected organization identity, organization role, features, and scopes for owner, admin, and member credentials.

`GET /v1/budgets` documents enabled organization-wide or group-specific budgets with daily, weekly, or monthly limits, exact USD-nano limit fields, and `effective_at`.

The budget contract does not return spend, remaining amount, interval start, reset boundary, actor applicability, or actor group membership.

The budget contract does not define whether periods are calendar or rolling intervals or how `effective_at` changes the first interval.

`GET /v1/analytics/schema` documents a credential-selected physical Parquet schema, dynamic column descriptions, dynamic row-kind descriptions, and export metadata including `generated_at`, `source_start`, `cutoff`, and `bucket_minutes`.

The public OpenAPI contract intentionally does not name the current physical columns or row kinds.

`POST /v1/analytics/query` permits read-only `SELECT` or `WITH … SELECT` queries against `organization_analytics` for owner, admin, and member roles.

The query contract describes an organization-selected export rather than an actor-scoped authorization boundary, so it does not establish that a member can obtain only their own spend without organization-wide visibility.

The query contract warns that Squirreling 0.16.1 can convert `BIGINT SUM` and `AVG` results to JavaScript numbers and lose integer precision.

The contract does not document a precision-preserving billed-USD-nano aggregate.

The export contract exposes a cutoff but does not state an acceptable freshness bound for a remaining-budget display.

## Mandatory discovery gate result

| Required fact | Result |
| --- | --- |
| Sanitized live context, budget, and schema fixtures | Blocked because no disposable signed-in Radius credential was available |
| Billed USD-nano row kind and columns | Not defined by the public static contract and not observable without the live schema |
| Calendar or rolling periods and first `effective_at` interval | Not defined |
| Organization, group, per-member, and shared applicability | Not defined for the current actor |
| Member actor-only visibility | Not guaranteed by the operation contract |
| Exact query for every applicable period | Cannot be derived without schema, applicability, period, and precision contracts |
| Export delay labeling | Cutoff fields exist, but no acceptable freshness bound is defined |
| Safe remaining amount | Cannot be calculated without guessing |

## Gateway-origin gate result

Pi defines the built-in Radius control-plane gateway as `https://radius.pi.dev` in source.

A custom `models.json` provider with `oauth: "radius"` passes its configured `baseUrl` into the Radius provider as the OAuth gateway.

That gateway remains in a provider closure while `/v1/config` supplies the model inference `baseUrl`.

The public runtime `ModelAuth` result exposes request `apiKey`, headers, and optional inference `baseUrl`, but no canonical OAuth gateway identity.

The stored Radius credential may contain legacy gateway model config, but that config contains only inference `baseUrl` and models, not the credential's canonical gateway origin.

`ModelRegistry.getRegisteredProviderConfig()` returns extension-registered compatibility config and does not expose `models.json` provider configuration.

The built-in origin is therefore source-verifiable, but a custom gateway bearer destination is not verifiable through Pi's public runtime API.

Custom Radius gateways must remain unsupported until Pi or Radius publishes one of the origin contracts requested on issue #1051.

## Required upstream contract

Radius must provide an official actor-scoped usage operation or an equally authoritative versioned analytics contract.

That contract must define exact billed USD nanos for the actor and each applicable shared bucket, applicable budget identities and semantics, interval boundaries, `effective_at` behavior, export freshness, member visibility, and precision-preserving aggregation.

Source-derived owner, admin, and member fixtures are also required before parser or query tests can be written.

Pi must additionally expose the configured OAuth gateway through a public runtime API, or Radius must provide another credential-bound and securely verifiable custom control-plane origin.

## Verification scope

This blocked outcome changes repository documentation only.

Package source, generated runtime, manifests, command behavior, settings, and published behavior remain unchanged.

A Changeset, package build smoke, pack inspection, and live package smoke are therefore not applicable.

Repository formatting, boundary, typecheck, build, and test gates remain the verification for the focused documentation artifact.
