# Plan and Goal coexistence release readiness

## Outcome

Workflow Mutex Protocol v1 is characterized on `@earendil-works/pi-coding-agent@0.84.2` and implemented independently by Plan mode and Goal.
The current Changesets produce the first v1 release-intent versions `@narumitw/pi-plan-mode@0.52.0` and `@narumitw/pi-goal@0.53.0`.
No package was published and no tag, visibility change, release workflow, or deprecation action was performed.

## Coexistence matrix

| Evidence | Result |
| --- | --- |
| Plan-first load, Plan-first acquisition | Plan holds and Goal rejects without state, prompt, status, thinking, or active-tool writes. |
| Plan-first load, Goal-first acquisition | Goal holds and Plan rejects without state, prompt, status, thinking, or active-tool writes. |
| Goal-first load, Plan-first acquisition | Plan holds and Goal rejects without state, prompt, status, thinking, or active-tool writes. |
| Goal-first load, Goal-first acquisition | Goal holds and Plan rejects without state, prompt, status, thinking, or active-tool writes. |
| Plan planning, ready review, and revision | Goal direct and managed starts remain rejected while the Plan tool set stays unchanged. |
| Goal active and waiting | Plan direct, prompted, launch-menu, selected-tool, shortcut, and startup-flag starts remain rejected. |
| Both persisted states active | Lifecycle registration order selects one holder and the loser enters its documented non-running fallback. |
| Release and reacquisition | Goal starts only after Plan cleanup, and Plan starts only after Goal cleanup. |
| Standalone load | Plan and Goal each retain representative start, stop, persistence, tools, status, and shutdown behavior. |
| Generated entries | Both built `dist/index.ts` entries load through Pi's Jiti resource loader on one event bus, and runtime invalidation removes their tracked mutex listeners. |

Focused package suites additionally cover Plan save, export, implementation handoff, fresh-session cancellation, replacement, and shutdown.
Focused Goal suites additionally cover pause, blocker, completion, clear, managed cancel, safety and budget limits, tool loss, waits, continuations, provider retries, settings rollback, replacement, and shutdown.
Legacy Goal queue-only state remains inert, does not acquire the mutex, and cannot schedule automatic work.

## Compatibility

| Installation | Result |
| --- | --- |
| Plan mode without another participant | Supported standalone behavior. |
| Goal without another participant | Supported standalone behavior. |
| Plan mode `>=0.52.0` with Goal `>=0.53.0` on Pi `0.84.2` | Guaranteed cooperative v1 mutual exclusion. |
| Either package below its floor | Standalone behavior only; mutual exclusion is unsupported. |
| Another Pi version, process, event bus, or non-v1 participant | Outside the characterized v1 guarantee. |

The mutex is cooperative and does not protect against a trusted non-participant that starts work or replaces Pi's active-tool array.
The packages do not import, identify, configure, start, stop, or depend on one another.

## Verification evidence

- `npm exec -- vitest run test/workflow-mutex-runtime.test.ts test/plan-goal-coexistence.test.ts` passed 17 tests.
- `npm exec -- vitest run packages/pi-plan-mode/test` passed 203 tests across 18 files.
- `npm exec -- vitest run packages/pi-goal/test` passed 295 tests across 21 files.
- `npm --workspace @narumitw/pi-plan-mode run build` passed.
- `npm --workspace @narumitw/pi-goal run build` passed.
- Both package build-runtime and generated-entry tests plus the dual-entry loader test passed 26 tests across five files.
- `npm --workspace @narumitw/pi-goal run test:runtime` passed normal, guard, retry, ownership, pause, managed-run, terminal-budget, and manual-compaction scenarios.
- `npm run check` passed build, Biome, package-boundary, and workspace-typecheck gates.
- `npm test` passed 3,805 tests across 402 files on the final run.
- One preceding full-suite run hit a transient `pi-subagents` semantic-resource revalidation failure; its focused 25-test rerun and the complete final rerun passed without a code change.
- Both `npm pack --workspace <package> --dry-run --json` inspections included `dist/index.ts`, source, `src/workflow-mutex.ts`, README, and license.
- `npm run changeset:status` reported Plan `0.52.0` and Goal `0.53.0` release intent.

Changesets status also reported pre-existing `pi-tui-kit` range warnings for unrelated packages.
Those warnings do not change either mutex package's resolved release intent.

## Convention audit

The implementation was reviewed against `docs/extension-conventions.md`, `docs/extension-settings.md`, `docs/readme-conventions.md`, both package `AGENTS.md` files, and the protocol conformance list.
Factory registration performs no session-owned background work.
Session replacement and shutdown cancel or invalidate menus, questionnaires, waits, continuations, retries, managed runs, timers, prompts, statuses, and local owners.
Every changed asynchronous path revalidates its session, generation, Goal or Plan identity, and workflow ownership after `await`.
Busy command behavior is observable in TUI, RPC, print, and JSON modes without ad hoc protocol output.
Inactive Goal tool visibility holds temporary ownership across runtime application, persistence, rollback, and release.
Settings validation, unknown-field preservation, invalid-file protection, atomic publication, and rollback semantics remain covered.
Generated runtimes preserve lazy interactive imports and external Pi peer dependencies.
Package boundaries report no extension-to-extension dependency or import.
README headings, standalone behavior, compatibility floors, restore fallbacks, and mixed-version limits were reviewed against implementation and tests.

## Deviations and unverified paths

No live-provider `pi -e` chat smoke was run because it would require provider credentials and external model execution.
The deterministic Jiti `DefaultResourceLoader`, generated-entry lifecycle, and Goal runtime smokes cover the changed runtime-loading boundary without a provider.
No external publication state was changed, so registry installation of the future compatibility-floor versions remains intentionally unverified until an approved release.
