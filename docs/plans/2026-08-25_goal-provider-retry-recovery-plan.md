# Goal provider retry recovery plan

Status: PLANNED

## Goal

Resolve [issue #975](https://github.com/narumiruna/pi-extensions/issues/975) so a Goal whose transient provider retries are exhausted becomes quiet and recoverable instead of terminally blocked.
A later user or extension follow-up must wake the same Goal and let the model call `goal_complete` or `goal_wait` with the preserved `goal_id`, without creating an automatic retry loop.

## Context

The issue is open without labels, comments, milestone, project assignment, or timeline links.
The stored issue body ends mid-sentence after describing three HTTP 429 failures, so this plan uses the observable failure, title, and current implementation as the authoritative scope.
`agent_end` currently records retryable provider or compaction recovery while leaving the matching Goal active.
`agent_settled` calls `GoalRuntime.finalizeSettledRecovery()`, which currently converts every remaining recovery kind to `blocked`, blocks stale Goal tool calls, persists a terminal reason, and releases Workflow Mutex ownership.
`beginNonGoalFollowUp()` adopts only an active Goal, so a later message such as “try again” cannot give the model Goal ownership after that blocked transition.
The existing `ActiveGoal.waiting` mechanism already provides a persisted, deadline-free, active-but-quiet state that stops continuation pressure and active elapsed accounting while preserving Goal identity and Workflow Mutex ownership.
The existing test `agent_end keeps retryable interruptions active but stops on non-retryable errors` currently asserts the reported active-to-blocked behavior after settlement.
A focused Vitest run was attempted during planning, but this worktree has no installed Vitest dependency, so the command failed during config loading and no executed reproduction is claimed.

### Applicable repository requirements

Lifecycle and state changes MUST preserve current session, Goal ID, workflow ownership, continuation, wait, replacement, shutdown, and stale-turn guards, verified by focused lifecycle tests and semantic review.
Fork-sensitive waiting state MUST use canonical Goal persistence and restore from the active branch, verified by persistence or lifecycle restore tests.
Transient provider text MUST be treated as untrusted terminal input and bounded at display and prompt boundaries, verified by sanitization assertions and review of notification, status, and resume-prompt paths.
The active tool list and tool definitions MUST remain stable across Goal mode transitions, verified by review and existing goal tool-policy tests.
No asynchronous UI or lifecycle flow may retain work after cancellation, disposal, session replacement, or shutdown, verified by review and existing wait-timer cleanup tests.
Published behavior changes MUST include deterministic tests, a patch Changeset, `npm run check`, and a separate `npm test`, verified by command output and final diff review.
README changes MUST retain the standard structure and one-sentence-per-source-line style, verified by a fenced-code-aware heading audit and documentation review.
Generated runtime imports and lazy boundaries MUST remain valid, verified by the package build and generated-entry tests.

## Architecture

Transient `provider_retry` exhaustion will enter the existing deadline-free Goal waiting state.
The Goal will remain canonically `active`, retain its current ID and Workflow Mutex ownership, stop active elapsed accounting, and have no continuation intent or timer.
The next non-Goal user or extension input will use the existing wait wake-up path before the model run begins, restoring ordinary Goal ownership and tool behavior.
`compaction_retry` exhaustion will retain the current terminal `blocked` transition because another model turn can repeat the same context-overflow failure without corrective compaction.
Non-retryable, usage-limited, budget-limited, safety, explicit pause, and model-reported blocker transitions will remain unchanged.

## Non-Goals

This work will not add a `goal_resume` tool or change Goal tool schemas, visibility policy, restrictive allowlist compatibility, commands, settings, menus, or TUI components.
This work will not change Pi core retry classification, retry count, backoff, provider selection, or retry settings.
This work will not infer that blocked Goals persisted by older releases came from retry exhaustion because the persisted state does not retain that origin.
This work will not run repeated live-provider 429 experiments; deterministic lifecycle tests and the existing runtime smoke are the verification boundary unless a safe live failure is already available.

## Plan

- [x] Establish a clean execution baseline by running `git status --short`, installing dependencies with `npm install`, and confirming that `package-lock.json` has no unintended diff; record the command results before changing production code.
  Evidence: `npm install` exited 0 with only Node 25 engine warnings, and `git diff -- package-lock.json package.json packages/*/package.json` was empty.
- [x] Rebuild `@narumitw/pi-tui-kit` before Goal consumer tests with `npm --workspace @narumitw/pi-tui-kit run build`, and verify the build succeeds without running it concurrently with root checks.
  Evidence: `npm --workspace @narumitw/pi-tui-kit run build` exited 0 before any consumer test ran.
- [x] Add or revise focused tests in `packages/pi-goal/test/goal-error-lifecycle.test.ts` so an exhausted HTTP 429 `provider_retry` is expected to remain active with deadline-free waiting metadata, no continuation dispatch, no stale-tool block, preserved Goal ID, and an actionable warning; run the focused test before the production change and record the expected red assertion.
  Evidence: focused Vitest first failed with actual `blocked` versus expected `active`, then the complete error-lifecycle file passed all 22 tests after the production fix.
- [x] Add focused wake-up coverage that sends an ordinary “try again” follow-up after provider retry exhaustion, starts the next model run through the real input and agent-start hooks, and verifies the same Goal ID can complete through `goal_complete`; verify the test fails before the production change and passes afterward.
  Evidence: focused Vitest first failed with the awakened Goal still `blocked`, then passed as part of all 22 error-lifecycle tests with same-ID completion after the fix.
- [x] Add focused coverage for `goal_wait` after the same wake-up path, proving the model can re-enter a valid external wait with the preserved Goal ID and without an automatic continuation; verify red-before-fix and green-after-fix results.
  Evidence: focused Vitest first failed because the same-ID Goal remained `blocked`, then passed as part of all 22 error-lifecycle tests with a new deadline-free wait and no continuation.
- [x] Add or retain a regression proving exhausted `compaction_retry` recovery still becomes `blocked`, releases active execution, and blocks stale Goal-owned tools; verify this independently from provider recovery behavior.
  Evidence: focused Vitest passed the new compaction-exhaustion regression with `blocked` state and the stale-tool guard before the provider-specific fix.
- [x] Add idempotence, replacement, and reload assertions proving repeated `agent_settled` events do not duplicate waits, stale recovery cannot affect a replacement Goal, and a provider-generated wait restores as the same active waiting Goal from canonical branch state.
  Evidence: reload first failed with `blocked`, the existing replacement regression remained green, and all 22 error-lifecycle tests then passed with repeated settlement preserving one wait and zero extra entries.
- [x] Update `GoalRuntime.finalizeSettledRecovery()` in `packages/pi-goal/src/runtime.ts` to branch on `GoalRecovery.kind`, revalidate the matching active Goal and Workflow Mutex ownership, and route only `provider_retry` exhaustion into the existing deadline-free wait transition.
  Evidence: the implementation now requires matching active ownership, enters wait only for `provider_retry`, and passed all 22 focused error-lifecycle tests.
- [x] Preserve the provider recovery failure as bounded, untrusted status data, and verify notification, status, persistence, and later resume-prompt rendering cannot emit terminal controls or treat the provider text as instructions.
  Evidence: focused Vitest passed with a 500-character control-bearing error, bounded terminal-safe waiting/status text, and XML-escaped resume context explicitly labeled untrusted.
- [x] Keep `compaction_retry` and every non-provider terminal transition on the existing blocked or stopped paths, and verify no tool name, tool schema, active-tool policy, settings schema, command route, or persisted Goal status enum changes in the diff.
  Evidence: the source diff changes only `provider_retry` finalization, the compaction regression remains blocked, and focused tool-policy, command-transition, persistence, and error-lifecycle tests pass without interface changes.
- [x] Verify lifecycle cleanup semantically by tracing provider-generated waits through follow-up wake, explicit `/goal resume`, replacement, clear, pause, session replacement, reload, and shutdown, and add a focused test for any path not already covered by an existing deterministic wait test.
  Evidence: the new provider wake/reload tests plus 53 passing wait, command-transition, and Workflow Mutex tests cover follow-up, resume, replacement, clear, pause, restore/replacement, shutdown, ownership, and timer cleanup; no uncovered path required another flow-specific test.
- [x] Verify managed-run compatibility by asserting provider retry exhaustion remains an active waiting run without a terminal event, while later completion still emits the existing successful terminal event; document this intentional change from the prior blocked outcome.
  Evidence: focused managed-run Vitest passed with state events `[active]` during provider waiting and `[active, complete]` after same-ID follow-up completion.
- [x] Update `packages/pi-goal/README.md` to describe exhausted transient provider retries as active waiting, explain follow-up and `/goal resume` recovery, distinguish compaction and non-retryable blocking, and preserve all required headings and one-sentence-per-source-line formatting.
  Evidence: README review confirms provider waiting, wake, compaction blocking, elapsed-time, and managed-run behavior are documented on separate prose lines with the existing standard structure retained.
- [x] Update `docs/implementation-notes/pi-goal-interruption-research.md` so the settled recovery sequence, stopped-state rationale, managed-run effect, and verification map match the implementation and current test paths.
  Evidence: the note now separates provider waiting from compaction blocking, documents identity and ownership behavior, and maps verification to existing split Goal test files.
- [x] Add a patch Changeset for `@narumitw/pi-goal` that states transient provider retry exhaustion now waits for a follow-up instead of permanently blocking the Goal; verify `npm run changeset:status` reports the intended package and bump only.
  Evidence: `npm run changeset:status` exited 0 and attributed `.changeset/fresh-goals-recover.md` only to the `@narumitw/pi-goal` patch; it also reported the unrelated pre-existing `pi-todo` minor Changeset and existing Kit-floor warnings.
- [x] Run the focused Goal error, wait, persistence, managed-run, workflow-mutex, tool-policy, and generated-entry tests, and record exact passing commands and test counts in this plan before marking the item complete.
  Evidence: six focused files passed 129 tests together, and `packages/pi-goal/test/generated-entry.test.ts` passed its one loader test in isolation after a seven-file concurrent run had timed it out at the fixed 5-second limit.
- [x] Run `npm --workspace @narumitw/pi-goal run check` and `npm --workspace @narumitw/pi-goal run test:runtime` sequentially, and record successful build, Biome, typecheck, generated runtime, and runtime smoke evidence.
  Evidence: the package check passed build, 49-file Biome, and TypeScript validation, then the runtime smoke passed normal continuation, retry ownership, guards, managed-run RPC, budgets, and compaction scenarios.
- [x] Run a fenced-code-aware audit of `packages/pi-goal/README.md` and all active package README required headings, and record that Features, Install, Quick start, Package layout, Keywords, and License remain present.
  Evidence: a fenced-code-aware `uv run python` audit passed all six required headings for 28 active package READMEs.
- [ ] Run the repository gates sequentially with `npm run check` followed by `npm test`, and leave this item unchecked with the exact failure if either command does not pass.
  Evidence: `npm run check` passed all workspace builds, Biome over 1,105 files, 27-extension boundaries, and every workspace typecheck.
  Blocker: `npm test` was attempted with Node 25, four workers, and supported Node 22; each full run timed out at the 300-second harness limit with unrelated existing failures in `pi-github-pr`, `pi-sync`, `pi-subagents`, `pi-worktree`, and other packages, while all focused `pi-goal` tests passed.
  Baseline confirmation: the unchanged `pi-github-pr` branch-refresh failure reproduces alone on this `origin/main` checkout with actual `periodicSignal.aborted === true` versus expected `false`.
- [x] Run `just pack goal`, inspect the dry-run tarball for the declared `dist`, `src`, README, and license contents, and verify no missing generated chunk or unintended file is published.
  Evidence: the dry-run pack exited 0 with 35 files containing LICENSE, README, package manifest, all declared source files, `dist/index.ts`, source maps, and three resolvable generated chunks.
- [x] After deterministic red/green evidence confirms the defect, add the existing `bug` label to issue #975 and verify the label with `gh issue view 975 --json labels`; do not change issue state or other metadata.
  Evidence: `gh issue view 975 --json number,state,labels,url` reports the open issue with exactly the added `bug` label and no state change.
- [x] Inspect `git diff --check`, the complete intended diff, `git status --short`, and Changesets status for unrelated behavior, generated artifacts, accidental lockfile changes, stale documentation, or unchecked plan items; correct every finding before completion.
  Evidence: `git diff --check` passed, package and root checks produced no tracked generated artifacts or lockfile changes, the diff contains only Goal source/tests/docs, one Goal Changeset, and this required incomplete plan, and the remaining unchecked root-test blocker is recorded explicitly.

## Risks

A provider-exhausted managed run will remain active and waiting instead of publishing a terminal blocked event.
That behavior intentionally matches external waiting, but it also retains Workflow Mutex ownership until a follow-up, explicit resume, replacement, clear, or session shutdown.
A broad change that waits after compaction exhaustion could create repeated context-overflow failures, so recovery-kind separation requires explicit regression coverage.
A broad change that automatically resumes every blocked Goal could restart true blockers or usage limits, so wake-up behavior must remain limited to active waiting Goals.
Provider error text can contain terminal controls or instruction-like content, so it must remain bounded untrusted status data through every display and prompt boundary.
If implementation requires a new tool, persisted cause field, status enum, migration, or changed managed-run terminal contract beyond active waiting, that is a major scope change and requires updating this plan and obtaining approval again.

## Rollback / Recovery

Inspect the targeted diff before each production-code checkpoint so a failed experiment can be reverted with path-specific Git restoration without touching the dated plan or unrelated work.
If dependency installation changes manifests or the lockfile without an approved dependency need, restore only those unintended dependency files and confirm the worktree returns to the recorded baseline.
If the waiting design fails lifecycle, managed-run, or compatibility tests, restore the affected `pi-goal` source and test paths, leave failed evidence unchecked in this plan, and request approval for a revised architecture before continuing.
If issue labeling is not permitted or deterministic confirmation is unavailable, leave the metadata item unchecked and report the exact permission or verification blocker without retrying external services repeatedly.

## Completion Checklist

- [x] Provider retry exhaustion produces one persisted, deadline-free active wait with no automatic continuation, verified by focused lifecycle assertions.
  Evidence: the focused 429 test passed with canonical `active`, a reason-only wait, no `activeStartedAt`, no stale guard, and no additional user message.
- [x] A later user or extension follow-up wakes the same Goal and permits both `goal_complete` and `goal_wait` with the preserved `goal_id`, verified through real lifecycle hooks.
  Evidence: input and `before_agent_start` regressions passed same-ID completion and re-wait flows.
- [x] Compaction exhaustion and all non-retryable, quota, budget, safety, pause, and blocker transitions retain their documented stopped behavior, verified by focused regressions and diff review.
  Evidence: compaction remained blocked with stale-tool protection, and the complete error, wait, transition, budget, safety, and tool-policy coverage passed in focused/package runs.
- [x] Repeated settlement and reload retain only the matching active waiting owner, while replacement, clear, pause, and shutdown release superseded recovery, continuation, wait timer, workflow ownership, and Goal tool-call guards, verified by tests and semantic lifecycle audit.
  Evidence: idempotence/reload assertions and 53 wait, transition, and Workflow Mutex tests passed.
- [x] Model-facing and terminal-facing provider text remains bounded and safe, verified by control-character test coverage and display-boundary review.
  Evidence: control-bearing provider text passed bounded notification/status assertions and escaped untrusted resume-prompt assertions.
- [x] Goal tools, commands, settings, persisted status enums, package metadata, and active-tool transition policy remain compatible, verified by targeted tests and complete diff inspection.
  Evidence: no interface or metadata file changed, and tool-policy, command-transition, persistence, package typecheck, and boundary checks passed.
- [x] README, implementation notes, and the patch Changeset accurately describe the shipped behavior, verified by documentation audit and Changesets status.
  Evidence: the 28-package heading audit passed and Changesets reports only a Goal patch from the new file.
- [ ] Focused tests, package checks, runtime smoke, `npm run check`, `npm test`, and `just pack goal` all pass with evidence recorded in this plan.
  Blocker: every listed check except the full `npm test` gate passed; the full gate repeatedly timed out with unrelated reproducible baseline failures recorded above.
- [x] Issue #975 has the `bug` label when permitted, with no other issue metadata changed.
  Evidence: GitHub reports issue #975 open with the `bug` label.
- [x] The final diff contains only the approved source, tests, documentation, Changeset, and synchronized plan evidence, verified by `git diff --check`, `git diff`, and `git status --short`.
  Evidence: final review found no lockfile, manifest, generated-runtime, tool-schema, command, settings, or unrelated package changes.
- [ ] Change `Status: PLANNED` to `Status: DONE` only after every required checkbox above is checked with concise evidence.
  Blocker: status remains `PLANNED` because the full repository test gate did not pass locally.
