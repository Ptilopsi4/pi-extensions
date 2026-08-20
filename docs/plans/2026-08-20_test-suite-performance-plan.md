# Test suite performance

## Goal

Make the canonical `npm test` workflow deterministic and materially faster without reducing real Git, subprocess, lifecycle, or integration coverage.

Enforce a repository-wide hard cap of 5,000 milliseconds for every individual Vitest test, with no larger per-test override.

The objective is complete when three controlled full-suite runs pass, their median wall time is at most 200 seconds on the baseline machine, no run reaches 300 seconds, no individual test exceeds 5,000 milliseconds, and test Git commits do not invoke the user's signing agent.

## Context

The canonical test runner builds `pi-tui-kit`, compiles the test TypeScript project, and runs 355 Vitest files containing 3,504 tests.

The first 2026-08-20 baseline took 399.47 seconds wall time, of which Vitest reported 392.30 seconds, and load-sensitive Git and subprocess tests reached 30-second and 60-second timeouts.

A second controlled pre-change run reproduced widespread signing-sensitive delays before it was interrupted without a final suite total, including individual tests at the existing 30-second limit and one explicit 60-second override.

The baseline machine exposes eight logical CPUs and runs Node.js 25.9.0, while CI runs Node.js 26.

The baseline user Git configuration enables SSH commit signing through 1Password.

Temporary repositories set fixture authors but several fixture commits inherit `commit.gpgsign=true`, so parallel tests invoke the external signer and amplify filesystem, process, and endpoint-scanner contention.

A command-scoped diagnostic with `commit.gpgsign=false` passed a representative seven-file Git and subprocess hotspot set containing 64 tests in 79.37 seconds.

That focused diagnostic establishes the suspected cause but is not a substitute for a controlled full-suite comparison.

The repository already limits CI pull requests to affected workspaces, while release verification and local `npm test` intentionally run the full suite.

The applicable `AGENTS.md` MUST rules are to keep active tests in package test directories, run checks and tests as separate gates, rebuild `pi-tui-kit` before consumer tests, start subprocess deadlines after readiness, avoid fixed-sleep HTTP synchronization, and disable fixture commit signing only through command-scoped Git configuration.

This objective will add the user-approved repository rule that every Vitest test has a 5,000-millisecond hard cap and no test may override that cap upward.

The applicable `docs/extension-conventions.md` MUST rules are to preserve deterministic behavioral tests and run both `npm run check` and `npm test` before completion.

No extension metadata, command surface, settings, persistence, TUI behavior, package contents, or runtime loading behavior is intended to change, so settings review, package smokes, Pi loading smokes, and Changesets are not applicable unless the implementation expands scope.

## Non-Goals

- Raising Vitest's global test or hook timeouts above 5,000 milliseconds is prohibited rather than a performance fix.
- Replacing real Git, worktree, reflog, lease, process-termination, or lifecycle tests with mocks is out of scope.
- Changing the user's global Git configuration or disabling signing outside the test command is out of scope.
- Combining `npm run check` and `npm test` or weakening affected-test selection is out of scope.
- Changing the worker count without representative timing and stability evidence is out of scope.
- Optimizing published extension runtime behavior or adding package dependencies is out of scope.

## Risks

- Test-level Git configuration could accidentally hide a test that intentionally verifies inherited Git settings, so the affected tests must be reviewed before applying the override.
- Worker-count measurements can be distorted by unrelated host load, so each candidate must use the same file set, repeat count, and idle-host conditions.
- Fixed waits may encode process-termination or cancellation guarantees, so they must not be replaced with fake timers unless the exercised boundary is entirely in-process.
- Splitting a broad test to meet the hard cap can accidentally weaken scenario coverage, so every extracted case must preserve its original assertions and cleanup.
- Existing non-performance failures, including temporary-path alias assertions, may block full-suite acceptance and must be separated from regressions introduced by this work.
- Local Node.js 25 timing does not prove Node.js 26 CI behavior, so CI evidence remains required for the supported workflow.

## Evidence

- Baseline environment: Node.js 25.9.0, eight available CPUs, 355 canonical test files, global `commit.gpgsign=true`, and `/Applications/1Password.app/Contents/MacOS/op-ssh-sign` from `~/.gitconfig`.
- Complete baseline: `/usr/bin/time -p npm test` reached 3,504 tests in 399.47 seconds wall time, with Vitest reporting 392.30 seconds and five load-sensitive failures.
- Reproduction on the current base: a second isolated `npm test` run again reached repeated 30-second and 60-second signing-sensitive timeouts before interruption, so the environmental cause reproduced even though that run has no final total.
- Signing-sensitive direct Git fixtures: `pi-file-context/git-context`, `pi-subagents/panel-execution`, `subagent-workflow-execution`, `verification-harness`, `workflow-completion-controller`, `workflow-tree-identity`, `workspace-manager-owned-worktrees`, `pi-sync/git-backend`, and `pi-worktree/git.integration`.
- Compatibility exception: `pi-sync/git-runner` intentionally strips inherited `GIT_*` variables before production Git execution, while `pi-subagents/panel-execution` already applies explicit `commit.gpgsign=false` to its fixture commits.
- Hard-cap regression red phase: `test/test-runtime-policy.test.ts` detected the existing `60_000` override in `subagent-workflow-execution.test.ts` before that scenario aggregation was split.
- Focused hard-cap green phase: the policy test and split workflow execution file passed 20 tests, while a JSON run of the workflow file passed all 18 tests with a 2,233 ms slowest case.
- The workflow execution file now stubs tree identity only at its orchestration boundary; dedicated real-Git identity coverage remains in `workflow-tree-identity.test.ts` and real completion integration coverage remains in `workflow-completion-controller.test.ts`.
- The pre-existing worktree search failure reproduced in isolation because subsequence matching kept a low-entropy decoy and the narrow viewport hid the distinguishing path; high-entropy path and branch fixtures plus a reviewable viewport passed the focused test in 475 ms without changing production behavior.
- One representative run was invalidated rather than counted because another worktree ran a full eight-worker Vitest suite concurrently on the same host, producing system-wide endpoint-scanner contention.
- Final execution used Node.js 26.5.0 on Linux with 32 available CPUs, plus an eight-CPU `taskset` profile to match the baseline CPU count; the original Node.js 25 macOS host was not available for rerun.
- The signing-sensitive seven-file set now contains 76 tests and passed all nine worker-comparison runs.

| Worker policy | Run 1 | Run 2 | Run 3 | Median | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Vitest default | 6.11 s | 6.01 s | 5.85 s | 6.01 s | Retained |
| `maxWorkers=4` | 5.92 s | 5.96 s | 5.97 s | 5.96 s | 0.8% faster, below threshold |
| `maxWorkers=6` | 5.87 s | 5.83 s | 5.86 s | 5.86 s | 2.5% faster, below threshold |

- The representative set's slowest test was 708 ms, so all measured cases stayed well below the hard cap.
- A full-suite JSON run passed 373 suites and 3,518 tests in 20.47 seconds wall time, with no test at or above 4,000 ms and a 2,117 ms slowest test.

| Rank | File | File time | Slowest test | Disposition |
| ---: | --- | ---: | ---: | --- |
| 1 | `pi-sync/git-backend.test.ts` | 10,806 ms | 1,036 ms | Required real Git commits, refs, leases, and history integration across 33 bounded cases |
| 2 | `pi-subagents/subagent-workflow-execution.test.ts` | 5,654 ms | 698 ms | Subprocess orchestration cases split from two oversized aggregations, with tree identity stubbed only at this orchestration boundary |
| 3 | `pi-sync/sync-storage.test.ts` | 3,283 ms | 760 ms | Production `node:timers/promises` retry backoff; fake timers had no effect and the attempted test-only edit was reverted rather than adding production injection |
| 4 | `pi-fleet/transport.test.ts` | 2,778 ms | 1,678 ms | In-process transport rate-window semantics with bounded timing |
| 5 | `pi-subagents/panel-execution.test.ts` | 2,654 ms | 390 ms | Real child-process cancellation and panel orchestration across 16 bounded cases |
| 6 | `pi-sync/settings-management.test.ts` | 2,522 ms | 1,378 ms | Real cross-process lock serialization and settings integration |
| 7 | `pi-subagents/peer-communication.test.ts` | 2,139 ms | 2,047 ms | Real socket handshake deadline and shutdown cleanup |
| 8 | `pi-fleet/process-transport.test.ts` | 2,117 ms | 2,117 ms | Real three-process discovery, delivery, and cleanup; obsolete 15-second override removed |
| 9 | `pi-github-pr/github-pr.test.ts` | 2,067 ms | 1,001 ms | Twenty-eight bounded lifecycle and status cases with one intentional expiry timer boundary |
| 10 | `pi-subagents/workflow-completion-controller.test.ts` | 1,927 ms | 866 ms | Required real Git identity plus completion, cancellation, and drift integration |

- The runtime hard-cap runner exposed two previously missed 15-second aliases in `pi-fleet` during the first full run, which failed 2 tests for the intended policy reason before both overrides were removed.
- A generated skipped-test smoke also failed before execution with the expected 6,000 ms policy error, proving that collection-time enforcement covers skipped aliases as well as executed tests.
- Three final focused runs passed 44 tests each; their slowest test was 2,097-2,098 ms and every process fixture completed cleanup.
- Final `npm run check` passed the build, Biome check over 1,064 files, package-boundary validation, and every workspace typecheck.

| Controlled `npm test` run | CPU profile | Build | Compile | Vitest | Wall | Result | Signer observations |
| ---: | --- | --- | --- | ---: | ---: | --- | ---: |
| 1 | 32 CPU | passed | passed | 21.50 s | 24.32 s | 356 files and 3,518 tests passed | 0 |
| 2 | 32 CPU | passed | passed | 20.74 s | 23.65 s | 356 files and 3,518 tests passed | 0 |
| 3 | 32 CPU | passed | passed | 20.68 s | 23.59 s | 356 files and 3,518 tests passed | 0 |
| 1 | 8 CPU baseline profile | passed | passed | 46.23 s | 49.14 s | 356 files and 3,518 tests passed | 0 |
| 2 | 8 CPU baseline profile | passed | passed | 46.90 s | 49.82 s | 356 files and 3,518 tests passed | 0 |
| 3 | 8 CPU baseline profile | passed | passed | 46.71 s | 49.73 s | 356 files and 3,518 tests passed | 0 |

- The final eight-CPU median was 49.73 seconds, no run reached 300 seconds, and the collection-time runner rejected every effective timeout outside 1-5,000 ms.
- User Git signing remained `file:/home/narumi/.gitconfig true` before and after all runs, repository-local signing stayed unset, and the configured 1Password signer process had zero observations during each controlled run.
- The final semantic audit found no extension metadata, settings, persistence, TUI, package-content, runtime-loading, dependency, lockfile, or production behavior change.
- `AGENTS.md` test placement, separate-gate, hard-cap, fixture-signing, readiness, and cleanup rules are satisfied by root and package test placement, the separate final gates, the collection runner, the Git regression, observable child handshakes, and repeated cleanup coverage.
- The `docs/extension-conventions.md` touched area is deterministic behavioral tests plus both repository gates; package and Pi loading smokes and a Changeset are not applicable to repository-only test tooling.
- `git diff --check` passed, no package manifest or Changeset changed, and the exact original macOS baseline host remains the only performance path not rerun locally.

## Plan

- [x] Record a controlled pre-change benchmark with no concurrent root check or `pi-tui-kit` build by capturing `node --version`, CPU availability, Git signing origin, canonical test count, `/usr/bin/time -p npm test`, and Vitest's phase summary in this plan; expected result: the baseline is reproducible or environmental variance is explicitly documented, verified by the saved command output and test totals.

- [x] Audit tests that execute real `git commit` or `git commit-tree` operations and tests that intentionally inspect Git environment filtering; expected result: every signing-sensitive path and any compatibility exception are listed before editing, verified with `rg` results and focused source review.

- [x] Add a specific `AGENTS.md` rule that sets a 5,000-millisecond hard cap for each Vitest test, prohibits larger per-test overrides, and directs authors to split or synchronize slow tests instead; expected result: future test changes have a clear reviewable performance limit, verified by documentation review and the tooling regression below.

- [x] Set Vitest's global `testTimeout` to 5,000 milliseconds and remove every larger per-test timeout override by optimizing or splitting the owning test without dropping scenarios; expected result: all individual tests are bounded at five seconds, verified by focused tests and a repository tooling regression that checks both the global value and forbidden upward overrides.

- [x] Add a Vitest-only command-scoped Git configuration that sets `commit.gpgsign=false` for test processes without modifying repository-local or user-global Git configuration and without changing production Git-runner sanitization; expected result: direct Vitest runs and `npm test` use unsigned fixture commits while non-test Git commands remain unchanged, verified by inspecting the process environment and `git config --show-origin --get --bool commit.gpgsign` inside a test worker.

- [x] Add a deterministic root regression test for the test Git boundary that creates a temporary repository, confirms the effective signing value originates from command scope, performs a fixture commit without external prompting, and removes the fixture in `finally`; expected result: the test fails when the Vitest override is absent and passes without contacting a signing agent, verified with a focused Vitest run.

- [x] Run the signing-sensitive representative set covering `pi-sync` Git backend and routes, `pi-worktree` Git integration, and `pi-subagents` tree identity, completion, workflow execution, and timeout output; expected result: all previously measured scenarios pass with every individual test below the 5,000-millisecond hard cap, verified with the focused Vitest command and wall-time evidence appended to this plan.

- [x] Reproduce any remaining non-timeout failure from the canonical baseline, including temporary-path aliases, in isolation and either correct the fixture/assertion at its raw-versus-canonical path boundary or record it as an external blocker before broader timing work; expected result: the controlled full-suite benchmark is not contaminated by unrelated deterministic failures, verified by focused tests for each reproduced failure.

- [x] Benchmark the same representative hotspot set with Vitest's effective default worker count and explicit caps of four and six workers, using three runs per candidate under equivalent host conditions; expected result: retain the default unless another setting improves median wall time by at least 10 percent with all runs passing, verified by a timing table in this plan and the resulting `vitest.config.ts` value or documented no-change decision.

- [x] Produce one canonical JSON timing report with the selected Git isolation and worker policy, then inspect the ten slowest files and every individual test approaching or violating the five-second cap; expected result: each hotspot is classified as required real integration time, avoidable fixture setup, oversized scenario aggregation, fixed waiting, polling, or contention, verified by a ranked table and source references appended to this plan.

- [x] Split oversized scenario aggregations and replace avoidable waits found in the ranked hotspot audit with bounded cases, observable readiness callbacks, marker handshakes, event completion, or fake timers only where the boundary is fully in-process; expected result: changed tests preserve every original assertion plus cancellation, timeout, cleanup, and late-result semantics without arbitrary success sleeps, verified by focused tests run three times and by reviewing child-process cleanup after each run.

- [x] Not applicable: final hardening added a constant-time collection guard and removed timeout declarations without materially changing the representative workload, so the completed comparison remains current; expected result: the committed concurrency policy reflects the final workload rather than stale measurements, verified by an updated timing table or a documented unchanged-workload decision.

- [x] Run `npm run check` without `npm test` or a `pi-tui-kit` build in parallel; expected result: build, Biome, package boundaries, and all workspace typechecks pass, verified by the complete command result.

- [x] Run the canonical `npm test` three times under controlled conditions and record build, compile, Vitest, wall-time, pass/fail, slowest-test duration, timeout, and signing-agent evidence for each run; expected result: all runs pass, every test stays within 5,000 milliseconds, median wall time is at most 200 seconds, no run reaches 300 seconds, and no fixture commit contacts the user's signer, verified by the timing table and process observations.

- [x] Inspect the final diff against `AGENTS.md` and the touched-area checklist in `docs/extension-conventions.md`, including test placement, deterministic behavior, subprocess readiness, cleanup, separate gates, and command-scoped signing; expected result: every applicable MUST has named evidence and any deviation or unverified path is recorded in this plan.

- [x] Confirm repository-only scope with `git diff --check`, `git status --short`, and Changesets review; expected result: only intended test tooling, tests, and this plan changed, no package behavior or metadata changed, and no Changeset, pack smoke, or Pi runtime smoke is required, verified by final diff inspection.

- [ ] Obtain Node.js 26 CI evidence for both the check gate and the applicable test gate before declaring the objective complete; expected result: CI passes without new timeout or signing dependence, verified by the workflow run URL or recorded CI result.

## Rollback / Recovery

- [x] Keep Git isolation, worker policy, and individual hotspot edits separable so a regression can be reverted to the last passing checkpoint without discarding verified improvements; expected result: each checkpoint has focused test evidence before the next class of change begins, verified by the synchronized evidence in this plan.

- [x] Not needed: the central override passed the Git boundary regression, the intentional `pi-sync` sanitization tests, and the full suite without changing production runner code; expected result: production semantics remain unchanged while fixture commits stay hermetic, verified by the Git environment regression and affected package tests.

- [x] The split workflow and process fixtures passed three repeated focused runs, and the ineffective fake-timer experiment was reverted instead of changing production timing semantics; expected result: rollback is limited to the failing test contract, verified by three repeated focused runs.

## Completion Checklist

- [x] `AGENTS.md`, Vitest configuration, and the tooling regression consistently enforce a 5,000-millisecond maximum for every test with no upward per-test override.
- [x] The command-scoped Git isolation is covered by a deterministic root test and leaves user and repository Git configuration unchanged, verified by focused test output and `git config --show-origin` before and after `npm test`.
- [x] Every final worker setting is supported by repeated representative measurements, or the Vitest default is retained with the comparison documented.
- [x] The ten slowest files and all tests approaching the five-second cap have a recorded disposition, and every modified asynchronous fixture has verified readiness and cleanup behavior.
- [x] `npm run check` passes as a separate gate.
- [x] Three controlled `npm test` runs pass with every test below 5,000 milliseconds, a median wall time of at most 200 seconds, and no run of 300 seconds or longer.
- [ ] Node.js 26 CI passes the check and applicable test gates.
- [x] The final semantic audit names `AGENTS.md`, `docs/extension-conventions.md`, focused tests, full gates, timing evidence, deviations, and unverified paths.
- [x] The final diff contains no unintended package metadata, published behavior, dependency, generated artifact, or user Git configuration change.
- [ ] The objective is marked `DONE` only after every required checkbox above has evidence and is checked.
