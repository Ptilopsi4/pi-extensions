# Subagents Retained Runtime Deletion Plan

## Goal

Delete the disconnected retained-agent implementation, tests, dependencies, benchmarks, and obsolete build assumptions from `@narumitw/pi-subagents` without changing the approved four-tool bounded runtime contract.

## Context

The bounded-runtime cutover intentionally leaves the previous retained implementation disconnected for reviewable rollback.

No release should be approved until this deletion pass proves the package contains only active bounded-runtime code and necessary historical migration documentation.

## Non-Goals

- [ ] Do not change the four public tool schemas, command behavior, child process contract, job limits, or completion protocol; verify the provider-visible definitions remain byte-equivalent before and after deletion.
- [ ] Do not add retained conversations, ask/reply, persistence, settings, transports, worktrees, or Pi Harness integration; verify no new public field or runtime dependency appears.

## Plan

- [ ] Inventory every source file, test, fixture, benchmark, dependency, script branch, and document reachable only by the removed retained runtime; verify each item has an explicit delete, keep, or migrate disposition.
- [ ] Delete disconnected retained registries, persistence, mailboxes, hierarchy, settings, catalogs, context projection, contracts, workspaces, usage recording, renderers, and multi-transport modules; verify source and generated import graphs still load only the bounded modules.
- [ ] Delete tests and fixtures whose sole subject is removed behavior, and migrate any remaining process, sanitization, invocation, or lifecycle regression into bounded test files before deletion; verify package tests preserve equivalent safety coverage.
- [ ] Remove dependencies and peer imports no longer required by the bounded source, update the lockfile with `npm install`, and verify `npm ls` plus package-boundary checks show no accidental dependency loss.
- [ ] Remove obsolete benchmark inputs and mark retained benchmark reports historical when their evidence remains useful; verify active guidance contains no executable retained workflow.
- [ ] Simplify the generated-runtime builder and package file inventory after source deletion while preserving atomic publication, source maps, exact import validation, and loader smoke coverage.
- [ ] Run focused tests, package check, root `npm run check`, root `npm test`, `just pack subagents`, source and generated loader smokes, and the applicable non-interactive Pi smoke; record exact evidence for every gate.
- [ ] Add the required Changeset update for the published cleanup if release policy requires it, inspect the tarball for obsolete files, and request release approval only after every completion criterion passes.

## Risks

- [ ] Preserve invocation validation, process-group termination, UTF-8 bounds, terminal sanitization, cancellation races, stale-session guards, and atomic build publication while deleting similarly named retained helpers; verify each preserved behavior with a focused regression test.
- [ ] Preserve downgrade guidance without shipping obsolete executable code; verify historical documentation is clearly labeled and cannot be mistaken for active behavior.

## Rollback / Recovery

- [ ] Keep deletion commits mechanically separable so Git can restore an incorrectly removed safety helper without reverting the bounded public contract; verify each commit has one deletion or migration intent.

## Completion Checklist

- [ ] `packages/pi-subagents/src` contains only code reachable from or directly supporting the bounded package contract, as verified by import inventory and manual review.
- [ ] Active package tests contain no retained public-surface expectations, and every preserved safety behavior has bounded-runtime coverage.
- [ ] Package dependencies, published files, documentation, build output, and tarball contain no obsolete retained runtime or child bridge.
- [ ] All required checks and smokes pass with no unresolved lifecycle, compatibility, packaging, or documentation finding.
