# Subagents Retained Runtime Deletion Plan

## Goal

Delete the disconnected retained-agent implementation, tests, dependencies, benchmarks, and obsolete build assumptions from `@narumitw/pi-subagents` without changing the approved four-tool bounded runtime contract.

## Context

The bounded-runtime cutover intentionally leaves the previous retained implementation disconnected for reviewable rollback.

No release should be approved until this deletion pass proves the package contains only active bounded-runtime code and necessary historical migration documentation.

## Non-Goals

- [x] Do not change the four public tool schemas, command behavior, child process contract, job limits, or completion protocol; verify the provider-visible definitions remain byte-equivalent before and after deletion.
  Evidence: `job-tools.ts`, `bounded-subagents.ts`, and `job-types.ts` retain their baseline SHA-256 values, and every active public, lifecycle, process, invocation, and widget file except removal-only `safe-text.ts` is byte-identical to the bounded-runtime base.
- [x] Do not add retained conversations, ask/reply, persistence, settings, transports, worktrees, or Pi Harness integration; verify no new public field or runtime dependency appears.
  Evidence: the exact eleven-file source inventory and dependency audit contain none of these facilities, while cache and registration tests preserve the four-tool contract.

## Inventory

- [x] Keep the eleven generated-entry inputs reported by esbuild: `index.ts`, `subagents-extension.ts`, `bounded-subagents.ts`, `job-process.ts`, `job-runtime.ts`, `job-tools.ts`, `job-types.ts`, `job-widget.ts`, `pi-invocation.ts`, `process-control.ts`, and `safe-text.ts`; delete every other file under `src`, then verify source count and exact build metadata inputs.
  Evidence: the pre-deletion `validateEagerGraph()` inventory reported exactly these eleven inputs from 101 source files.
- [x] Keep bounded tests for build/runtime loading, cache stability, job process/runtime/widget behavior, invocation validation, startup/non-mutation, registration/lifecycle/privacy, and schema compatibility; migrate the two process-group tests from `runner-process-termination.test.ts` to active `process-control` coverage and migrate the host-entrypoint launch regression from `runner` to `runChild`; delete every other test and helper, then verify every remaining source import resolves to the bounded graph.
  Evidence: the pre-deletion test import inventory classified all 54 test/helper files by direct source subject.
- [x] Remove unused `@earendil-works/pi-agent-core`, `@narumitw/pi-tui-kit`, and `proper-lockfile` package edges; keep `pi-ai`, `pi-coding-agent`, `pi-tui`, `typebox`, esbuild, TypeScript, and Biome because active source or package tooling imports them; verify with `npm install`, lockfile review, and `npm ls`.
- [x] Delete `scripts/benchmark-pi-subagents-transports.mjs` and its `just benchmark-subagents` recipe because they benchmark removed RPC and in-process transports; retain the prior reports, protocols, and raw results under `docs/benchmarks` as explicitly historical evidence with no runnable command.
- [x] Keep active package contract, migration, architecture, direction, capability, and tool documentation; update temporary deletion-pass language, mark the RPC note as fully historical, and keep legacy-file downgrade guidance without an executable legacy workflow.
- [x] Preserve the existing major Changeset because it already names the complete retained-feature removal and downgrade behavior; verify no second Changeset is required for implementation-only cleanup within the same unreleased major cutover.
- [x] Capture the public-contract baseline before deletion and require it to remain unchanged.
  Evidence: SHA-256 was `7345348c0c528950f9378cd3419582fb79a52dfbb9295fc2915657c799004ea9` for `job-tools.ts`, `b3dd1ec5afb95baba9135495514814d5ce96779cef466c2b47ad4ed5b4765946` for `bounded-subagents.ts`, and `5d79114ae0f1c67421826c69a87f98d380710ea64342aad1513462e0dba06186` for `job-types.ts`.

## Plan

- [x] Inventory every source file, test, fixture, benchmark, dependency, script branch, and document reachable only by the removed retained runtime; verify each item has an explicit delete, keep, or migrate disposition.
  Evidence: the exhaustive keep/delete/migrate rules above cover the 101 source files, 54 test/helper files, package dependency edges, root transport benchmark, package documents, and existing release record.
- [x] Delete disconnected retained registries, persistence, mailboxes, hierarchy, settings, catalogs, context projection, contracts, workspaces, usage recording, renderers, and multi-transport modules; verify source and generated import graphs still load only the bounded modules.
  Evidence: `find packages/pi-subagents/src -type f` reports only the eleven inventoried files, and package check rebuilt the exact bounded graph successfully.
- [x] Delete tests and fixtures whose sole subject is removed behavior, and migrate any remaining process, sanitization, invocation, or lifecycle regression into bounded test files before deletion; verify package tests preserve equivalent safety coverage.
  Evidence: only ten bounded test files remain; process-group escalation and inherited-stream cleanup now import `process-control`, the host-entrypoint regression now exercises `runChild`, and the focused run passed 44 tests.
- [x] Remove dependencies and peer imports no longer required by the bounded source, update the lockfile with `npm install`, and verify `npm ls` plus package-boundary checks show no accidental dependency loss.
  Evidence: `npm install` completed with no vulnerability, and `npm ls --workspace @narumitw/pi-subagents --depth=0` shows only the four active peers plus Biome, esbuild, TypeScript, and their package-local development installs.
- [x] Remove obsolete benchmark inputs and mark retained benchmark reports historical when their evidence remains useful; verify active guidance contains no executable retained workflow.
  Evidence: the transport benchmark script and `just` recipe are deleted, the three retained benchmark decisions/analyses have historical warnings, existing protocols already identify themselves as retired, and repository search finds no obsolete command outside this plan.
- [x] Simplify the generated-runtime builder and package file inventory after source deletion while preserving atomic publication, source maps, exact import validation, and loader smoke coverage.
  Evidence: the builder now validates the exact eleven-file source graph without a retained-code denylist; package check passed, and focused builder tests passed deterministic output, stale removal, external imports, exact paths, maps, loader reload, path safety, and rollback scenarios.
- [ ] Run focused tests, package check, root `npm run check`, root `npm test`, `just pack subagents`, source and generated loader smokes, and the applicable non-interactive Pi smoke; record exact evidence for every gate.
  Passing evidence: the initial ten-file focused run passed 44 tests; the added source-loader regression passed with all five builder tests; package check passed; root `npm run check` passed; a changed-scope run passed 20 files and 92 tests; `just pack subagents` produced a 24-file tarball containing only bounded source, `dist/index.ts` with its map, active/historical docs, metadata, and license; source and generated `DefaultResourceLoader` tests passed.
  Unverified evidence: unfiltered `npm test` attempts at default, two, and one worker hit the 300-second harness deadline amid unrelated baseline timeouts and concurrent test processes from other worktrees; a later focused rerun also timed out in previously passing subprocess tests while system load exceeded 30.
  Smoke evidence: Pi loaded `packages/pi-subagents/dist/index.ts` and registered the extension before the selected Hugging Face provider returned HTTP 402 for exhausted credits; policy forbids retrying that external entitlement failure, so model response remains unverified.
- [x] Add the required Changeset update for the published cleanup if release policy requires it, inspect the tarball for obsolete files, and request release approval only after every completion criterion passes.
  Evidence: `changeset status` selects the existing `.changeset/quiet-badgers-wait.md` major bump to 3.0.0, which already records the complete removal and downgrade behavior; no additional Changeset is required, the tarball is clean, and no release approval, publication, tag, or workflow was requested.

## Risks

- [x] Preserve invocation validation, process-group termination, UTF-8 bounds, terminal sanitization, cancellation races, stale-session guards, and atomic build publication while deleting similarly named retained helpers; verify each preserved behavior with a focused regression test.
  Evidence: invocation and process regressions now target `runChild` and `process-control`; the initial focused run passed all 44 tests covering these behaviors, and the source-loader addition passed separately.
- [x] Preserve downgrade guidance without shipping obsolete executable code; verify historical documentation is clearly labeled and cannot be mistaken for active behavior.
  Evidence: migration and README guidance preserve legacy files for downgrade, benchmark reports and the RPC note are explicitly historical, and search finds no obsolete runnable benchmark command.

## Rollback / Recovery

- [x] Keep deletion commits mechanically separable so Git can restore an incorrectly removed safety helper without reverting the bounded public contract; verify each commit has one deletion or migration intent.
  Evidence: signed commit `fb7db2b9` contains the mechanical source, test, dependency, builder, benchmark-runner, and root settings-inventory cleanup while leaving the bounded contract commit history intact; documentation and incomplete-plan evidence remain separate.

## Completion Checklist

- [x] `packages/pi-subagents/src` contains only code reachable from or directly supporting the bounded package contract, as verified by import inventory and manual review.
  Evidence: source contains exactly eleven files and 1,756 lines, every file is in the validated generated-entry graph, and no source file exceeds 1,000 lines.
- [x] Active package tests contain no retained public-surface expectations, and every preserved safety behavior has bounded-runtime coverage.
  Evidence: ten bounded test files remain, their source imports resolve only to active modules, and migrated process, invocation, schema, startup, lifecycle, cache, privacy, sanitization, and loader coverage passed before host contention rose.
- [x] Package dependencies, published files, documentation, build output, and tarball contain no obsolete retained runtime or child bridge.
  Evidence: dependency and package-lock inventories are minimal, local documentation links resolve, root boundaries pass, and the inspected 24-file dry-run tarball contains no retained source, child bridge, tests, benchmark runner, or unused dependency.
- [ ] All required checks and smokes pass with no unresolved lifecycle, compatibility, packaging, or documentation finding.
  Blocked evidence: changed-scope verification and all semantic audits pass, but the unfiltered root test gate and live provider response cannot be marked passed under current host contention and provider-credit exhaustion.
