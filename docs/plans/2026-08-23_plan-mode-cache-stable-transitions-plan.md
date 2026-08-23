# Plan-mode cache-stable transitions plan

## Goal

Change `pi-plan-mode` to keep Plan and Normal requests on one append-only conversation while preserving the provider's cached prompt prefix across mode transitions.

The default implementation path must retain the Plan conversation and tool calls in implementation context.

The target history is:

```text
A → Plan contract → B: planning conversation → Normal contract → C: implementation
```

## Context

`main` currently changes the active tool list when Plan mode starts and ends.

`main` also appends the Plan contract to the top-level system prompt from `before_agent_start`.

Both changes alter provider request fields before conversation history and can invalidate the reusable prompt prefix.

The existing default `clear-on-start` implementation path already keeps ordinary planning history in the current session and sends `Implement the plan.`.

PR #916's tree handoff intentionally excludes the Plan branch from implementation context and therefore does not match this goal.

## Architecture

### Stable tool envelope

Activate `plan_mode_question` and `plan_mode_complete` once during `session_start`, before the session's first provider request, by appending them in fixed order to the existing active tool names.

Do not call `pi.setActiveTools()` when entering Plan mode, leaving Plan mode, saving, exporting, or implementing a plan.

Treat `defaultPlanTools` and the per-workflow tool selector as a Plan-mode execution-policy allowlist rather than a request-schema selector.

Only tools already active in Pi can be allowed for that Plan workflow.

Keep all active tool definitions visible to the model during Plan mode and enforce read-only behavior in the `tool_call` hook.

Block Plan-only helper calls outside Plan mode and fail closed for active tools that are not in the workflow's allowed Plan policy.

A tool-set change made by Pi, the user, or another extension remains outside `pi-plan-mode`'s cache guarantee.

### Append-only mode contracts

Replace the dynamic `before_agent_start.systemPrompt` modification with hidden, model-visible custom messages.

Append one versioned Plan contract before the first Plan user message and one versioned Normal contract before the first post-Plan implementation or Normal user message.

Use the complete bounded Plan instructions as the Plan contract and an explicit concise override as the Normal contract.

Do not remove or rewrite these transition messages during the ordinary linear workflow.

Reconcile old sessions and compacted contexts through one canonical `context`-hook contract only when the matching physical transition message is no longer retained.

Insert a fallback contract at a deterministic retained-history boundary so later requests keep the same prefix instead of moving the fallback to the end on every turn.

Keep legacy repeated `plan-mode-context` artifacts filtered for compatibility without filtering the new versioned transition messages.

### Linear implementation handoff

For active-plan **Implement here**, append the Normal contract, clear Plan state, retain the planning history, and send the existing `Implement the plan.` kickoff.

Preserve the current exact-plan reinjection policies after the mode-contract transform.

Keep **Start fresh and implement** as the explicit path that transfers only the approved plan to a new session.

Keep saved-plan implementation compatible because a saved plan may not have usable planning history.

Do not add automatic `/tree` navigation or branch summaries.

### Remaining cache boundaries

Keep the default `thinkingLevel: "inherit"` path request-stable.

Preserve configured Plan-only thinking levels as an explicit user choice and document that changing reasoning parameters can still prevent provider-side state reuse.

Document that provider implementation, serialization, cache lifetime, minimum cacheable prefix, and session affinity determine whether a stable prefix produces a cache hit.

An upgrade from an older `pi-plan-mode` version may incur one initial miss because the always-active helper tools are new to that session's request envelope.

## Non-Goals

- Do not isolate Plan history from implementation context.
- Do not implement automatic tree rewind on `/plan off` or **Implement here**.
- Do not guarantee a provider cache hit.
- Do not change settings file names, precedence, validation, persistence, or migration formats.
- Do not change the fresh-session handoff's conversation-isolation behavior.
- Do not modify package dependencies or entrypoint metadata.

## Assumptions

- Hidden custom messages are the public Pi mechanism for persistent model-visible extension context.
- The extension can guarantee only that its own mode transitions leave active tool names, tool ordering, tool definitions, and the base system prompt unchanged.
- Existing `selectedToolNames` and `defaultPlanTools` values remain valid policy preferences even when a named tool is not active in the current Pi session.
- The replacement behavior is a publishable minor change because it improves cache locality while preserving command routes and the default linear implementation context.

## Risks

- Always-visible Plan helper schemas may cause a Normal-mode model to attempt those tools, so handlers and `tool_call` policy must reject them clearly outside Plan mode.
- Keeping mutating tool schemas visible in Plan mode increases reliance on fail-closed runtime blocking, so edit, write, update-plan, unsafe bash, deselected built-ins, and deselected custom tools need direct tests.
- Reinterpreting tool selection as an allowlist means a currently inactive custom tool is no longer activated merely by entering Plan mode.
- A misplaced compaction fallback could duplicate or reorder contracts and reduce cache reuse.
- Existing context-retention filtering could accidentally remove the new Plan or Normal transition messages.
- A configured Plan-only thinking level or an external tool-set change can still invalidate provider-side incremental reuse even when the model-visible prefix is stable.

## Applicable convention gates

- **Factory and lifecycle MUST:** keep factory evaluation free of session-owned work, release watchers and UI during shutdown, and reject stale continuations after replacement; verify with lifecycle tests and review of every changed asynchronous path.
- **Commands MUST:** preserve documented `/plan` routes, completions, busy-state checks, and observable TUI, RPC, print, and JSON behavior; verify with direct-command and non-TUI tests.
- **Tools and state MUST:** make blocked calls observable, keep outputs bounded, persist branch-sensitive state, and restore it from the active branch; verify with tool-policy, resume, fork, reload, compaction, and manual-tree tests.
- **TUI MUST:** keep custom UI TUI-only, preserve cancellation and disposal behavior, and leave rejected drafts without state changes; verify with launch-menu and lifecycle tests using configured cancellation keys.
- **Settings MUST:** preserve valid-file reads, unknown fields, write ordering, failure recovery, and canonical precedence while changing only the documented meaning of tool selection; verify with the existing settings suite and a combined read/write audit.
- **Build-backed runtime MUST:** preserve dynamic-import boundaries, package-owned bundling, deterministic atomic output, and generated-entry loading; verify with build-runtime and generated-entry tests plus a Pi load smoke.
- **Documentation and release MUST:** update deterministic behavior tests, README guidance, and release intent; verify with `npm run check`, `npm test`, `just pack plan-mode`, README review, and a minor Changeset.

## Plan

- [x] Create a feature branch from current `main` and verify the branch contains none of PR #916's tree-handoff files or commits. Evidence: created `narumi/feat/plan-mode-cache-stable-transitions` at `3f6f8fd1`; `git merge-base --is-ancestor 25008b9a HEAD` returned false, and the branch has no `tree-implementation.ts`.
- [x] Add a focused cache-contract test fixture that captures ordered active tools, chained system prompts, model-visible messages, and provider payloads for Normal, Plan, and implementation requests; verify the fixture reproduces `main` changing tool schemas and system instructions before implementation changes. Evidence: pre-change `npx vitest run packages/pi-plan-mode/test/cache-contract.test.ts` passed 1 test and demonstrated both field changes.
- [x] Add a small package-owned mode-contract module that renders bounded versioned Plan and Normal custom messages, recognizes retained contracts, and inserts at most one deterministic fallback after compaction; verify with unit tests for unchanged, missing, stale, legacy, and repeated-transform inputs. Evidence: `src/mode-contract.ts`; `mode-contract.test.ts` passed 4 tests.
- [x] Update `packages/pi-plan-mode/src/plan-mode.ts` to establish the required helper-tool superset once during `session_start` while preserving the existing tool order; verify startup, reload, resume, fork, and duplicate-registration tests produce one exact ordered baseline. Evidence: focused startup/reload/resume/lifecycle tests passed with helpers appended once in fixed order.
- [x] Remove Plan transition calls that replace or restore active tools, including activation, exit, save, export, implementation, rollback, restoration, and shutdown paths; verify every transition leaves `pi.getActiveTools()` byte-for-byte ordered-identical to the post-start baseline. Evidence: `rg setActiveTools packages/pi-plan-mode/src` finds only the session-start envelope call; transition tests passed.
- [x] Remove the Plan-only top-level system-prompt append from `before_agent_start` and append the physical Plan contract before Plan prompts instead; verify repeated Plan turns do not duplicate the contract or change the base system prompt. Evidence: cache-contract and mode-contract tests passed.
- [x] Append the Normal contract on off, exit, save, ready-plan export, and active-plan implementation transitions without triggering an extra model turn; verify failure rollback leaves the latest effective contract consistent with persisted state. Evidence: export, saved-plan, lifecycle, and failed-kickoff rollback tests passed.
- [x] Compose mode-contract reconciliation with `implementationRetention.transformContext()` so normal implementation keeps Plan messages, questions, tool calls, accepted completion evidence, and the implementation kickoff in order; verify `clear-on-start`, `clear-after-first-run`, `keep`, legacy proposed plans, and saved plans retain their documented behavior. Evidence: implementation-retention, issue-302, issue-471, and saved-plan suites passed.
- [x] Rework Plan tool selection into a runtime allowlist over the stable active-tool baseline and mark inactive tools unavailable instead of activating them; verify persisted names remain preserved, active selected custom tools remain user-opt-in, and inactive names do not change active schemas. Evidence: default-tools, launch-menu, and settings-menu suites passed.
- [x] Harden `tool_call` policy for the stable superset by blocking Plan helpers outside Plan mode and blocking edit, write, update_plan, unsafe bash, unavailable built-ins, deselected safe built-ins, and deselected custom tools inside Plan mode; verify selected read-only and explicitly selected custom tools still execute. Evidence: tool-policy, safe-subcommands, and default-tools suites passed.
- [x] Reconcile branch-owned Plan state and effective contracts after manual `/tree` navigation without automatic navigation or summaries; verify moving among Normal, active Plan, ready Plan, saved Plan, and implementation branches restores state, thinking, mutex ownership, and UI without changing active tools. Evidence: `mode-transition-lifecycle.test.ts` and workflow-mutex tests passed.
- [x] Audit every changed transition for busy-agent rejection, menu cancellation, component disposal, session replacement, reload, shutdown, stale generations, and partial custom-message publication; add deterministic regression tests for each reachable failure or cancellation path. Evidence: plan-mode, launch-menu, workflow-mutex, fresh-session, export, and transition-lifecycle suites passed.
- [x] Update launch-menu, tool-selector, status, and notification copy to distinguish model-visible tools from tools allowed by Plan policy; verify TUI and RPC assertions capture evidence after menu completion and print/JSON routes remain observable. Evidence: launch-menu, settings-menu, plan-mode, and saved-plan suites passed.
- [x] Update `packages/pi-plan-mode/README.md` to describe append-only mode contracts, retained Plan conversation, stable tool schemas, tool-policy selection, helper visibility, thinking-level tradeoffs, external tool changes, upgrade behavior, and provider-dependent cache limits.
- [x] Add a minor Changeset for `@narumitw/pi-plan-mode` that describes cache-stable linear mode transitions and the inactive-tool selection compatibility change. Evidence: `.changeset/stable-plan-transitions.md`.
- [x] Run focused `pi-plan-mode` tests and typechecking, then run `npm run check` and `npm test`; record exact passing counts and leave any failure checkbox open. Evidence: final focused suite passed 225/225; package check and root `npm run check` passed; final root suite passed 3,235/3,235. The first root run exposed two affected coexistence assertions and one transient unrelated `pi-subagents` timing failure; the affected assertions were updated, the two files passed 27/27 together, and the complete rerun passed.
- [x] Rebuild and test the generated runtime, run `just pack plan-mode`, inspect the tarball for the expected source and generated files, and load the package directory through Pi's Jiti runtime. Evidence: generated-runtime/build tests passed; dry-run listed 39 expected files including `src/mode-contract.ts` and split `dist`; deterministic RPC smoke loaded `packages/pi-plan-mode/dist/index.ts` through Pi 0.84.2 Jiti.
- [x] Run an isolated Pi RPC smoke with provider-request capture for `A → Plan → B → Implement here → C`; verify system instructions and ordered tool definitions stay identical, requests extend retained history, Plan dialogue is present in C, and mutation calls remain blocked during Plan mode. Evidence: local OpenAI-compatible scripted provider captured 5/5 payloads with identical instructions and ordered definitions; final payload retained A, both contracts, plan, kickoff, and C; attempted `write` was observably blocked and created no file.
- [x] Record cache-read token evidence from one configured live provider when practical; after one external or entitlement failure, record the limitation and rely on deterministic serialized-prefix evidence instead of retrying. Evidence: configured `openai-codex/gpt-5.6-sol` completed 4 requests with identical instruction/tool hashes; assistant usage reported cache reads `0, 4608, 5632, 5632` tokens and retained both contracts plus the plan through C. A separate Google readiness probe reported credentials not configured and was not retried.
- [x] Audit the final diff against `docs/extension-conventions.md`, `docs/extension-settings.md`, package guidance, lifecycle rules, tool safety, terminal safety, settings read/write behavior, and generated-runtime boundaries; record every deviation and unverified path. Evidence: lifecycle and cancellation paths are generation-guarded and tested; tool policy fails closed when ownership or metadata is unavailable; settings persistence code and formats are unchanged and the full settings suite passed; fixed contracts contain no untrusted terminal text; generated imports and pack contents passed. The 1,000-line split preference remains intentionally deferred because `plan-mode.ts` documents and owns the atomic session-state closure. No required smoke remains unverified.
- [ ] Create a focused signed commit, push a replacement branch, and open a pull request with verification and cache-risk evidence when the user authorizes repository publication actions.
- [ ] After the replacement pull request exists, close PR #916 as superseded with a link to the linear cache-stability change rather than merging its tree handoff.
- [ ] Delete `docs/plans/2026-08-23_plan-mode-cache-stable-transitions-plan.md` only after every completion item has evidence.

## Completion Checklist

- [x] Plan and Normal mode use the same ordered active tool names and definitions after session startup.
- [x] `pi-plan-mode` performs no active-tool mutation during start, off, exit, save, export, or implementation transitions.
- [x] The base system prompt is unchanged by Plan mode transitions.
- [x] Plan and Normal contracts are append-only, model-visible, bounded, versioned, and not duplicated on ordinary turns.
- [x] Compaction and legacy restoration produce one stable effective contract without moving it on each request.
- [x] **Implement here** retains the Plan conversation and tool calls in implementation context.
- [x] Plan-mode mutation safety remains fail closed even though mutating tool schemas stay visible.
- [x] Existing command routes, saved plans, fresh implementation, retention policies, settings persistence, and non-interactive behavior remain compatible except for the documented inactive-tool activation change.
- [x] Default inherited thinking preserves the request envelope, and configured thinking changes are documented as a cache tradeoff.
- [x] Focused tests, root checks, root tests, generated-runtime tests, pack inspection, and Pi load smoke pass.
- [x] Provider payload evidence shows identical system instructions and ordered tool definitions across the representative transition.
- [ ] The final handoff names convention audits, checks, smokes, deviations, external cache limitations, and any unverified path.
- [ ] PR #916 is not merged and is closed only after the replacement pull request is available.
- [ ] The completed plan file is deleted.
