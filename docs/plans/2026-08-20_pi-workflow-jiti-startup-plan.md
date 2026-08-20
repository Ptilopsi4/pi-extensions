# pi-workflow Jiti startup plan

## Goal

Reduce `@narumitw/pi-workflow` extension startup latency by publishing a generated split `dist/index.ts` runtime that Pi loads through its existing Jiti loader, while preserving the authoritative source implementation, public behavior, lazy boundaries, lifecycle safety, and independent package installation.

## Context

`pi-workflow` currently declares `./src/index.ts`, and Pi 0.84.2 loads that entry through Jiti 2.7.0 with runtime module caching disabled and filesystem caching enabled.

The current source tree contains 53 TypeScript files and about 13,644 lines.

A planning-time Jiti trace found 39 unique `pi-workflow` source paths on the eager startup graph; the extension factory itself took about 1 ms, so module loading dominates the extension-specific cost.

The approved-plan measurements recorded a 394 ms warm import median and a 1,080 ms forced-rebuild import median.

The execution baseline on the implementation branch recorded a seven-run warm import median of 334 ms with 19 ms median absolute deviation and a 1,374.09 ms first-response median with 23.98 ms median absolute deviation.

Two forced-rebuild sets remained noisier; the retained three-run comparison baseline recorded a 961 ms import median with 156 ms median absolute deviation and a 2,133.32 ms first-response median with 123.58 ms median absolute deviation.

The execution Jiti trace recorded 39 unique eager `pi-workflow` paths, 38 transpiles, a 354 ms module import, and a 2 ms factory.

The benchmark command is `node scripts/benchmark-extension-startup.mjs --entry packages/pi-workflow/src/index.ts --runs <count>`; execution evidence is in `/tmp/pi-workflow-jiti-source-warm.json`, `/tmp/pi-workflow-jiti-source-forced-2.json`, and `/tmp/pi-workflow-jiti-source-trace.txt`.

Earlier work already made Workflow manager UI, Goal UI/settings, Plan interactive UI, Plan export, saved-plan preflight, and fresh-session handoff modules retryably lazy with stale-session checks.

The generated runtime must preserve those boundaries instead of folding cold behavior into startup.

The repository previously generated Jiti-loaded TypeScript bundles for `pi-starship` and `pi-statusline`, then rolled them back because their `src/index.ts` files forwarded to ignored `dist/` output and clean Pi-managed Git checkouts did not build it.

The current convention avoids that failure mode: package manifests may declare `dist/index.ts`, every package retains an authoritative `src/index.ts`, and the private root manifest continues loading stable extensions from source without generated output.

`pi-workflow` is experimental and is intentionally absent from the private root manifest.

## Architecture

Keep `packages/pi-workflow/src/` as the authoritative implementation and source-level test surface.

Add a package-owned build that bundles `src/index.ts` into deterministic split ESM artifacts under ignored `packages/pi-workflow/dist/`, emitting JavaScript syntax with `.ts` extensions so Pi routes the generated entry and chunks through Jiti.

Use Pi's existing Jiti loader rather than creating a second Jiti instance or adding Jiti as a package runtime dependency.

Preserve dynamic imports as split chunks so current first-use loading, retry, cancellation, session-generation, and session-manager ownership checks remain effective.

Externalize every Node built-in, package dependency, and Pi peer dependency so the bundle does not embed `@earendil-works/*`, `typebox`, `@narumitw/pi-tui-kit`, or duplicate runtime state.

Keep `src/index.ts` as a thin forwarder to the source implementation, but declare exactly `"pi": { "extensions": ["./dist/index.ts"] }` in the package manifest.

Publish both `src` and generated `dist` so the npm artifact contains reviewable authoritative source as well as the optimized runtime.

Generate and validate `dist` before pack, and require local package-directory loading to run the package build first through `just try workflow` or an equivalent explicit command.

Build into a package-local staging directory, validate before publication, replace only the owned `dist` directory, recover the prior valid output if final publication fails, and clean stale chunks without permitting an arbitrary deletion target.

## Tech Stack

Use a pinned package-owned `esbuild` dev dependency with `bundle`, `splitting`, `format: "esm"`, `platform: "node"`, `target: "es2022"`, `packages: "external"`, metadata output, and `.js` to `.ts` output-extension mapping.

Use Pi 0.84.2 and its Jiti 2.7.0 loader for real entrypoint, checkout, and packed-package smokes.

Use the existing offline RPC startup benchmark and `PI_TIMING=1` for timing evidence, plus `JITI_DEBUG=1` and `JITI_REBUILD_FS_CACHE=1` for eager-graph and forced-transform evidence.

Use Vitest tests under `packages/pi-workflow/test/*.test.ts`; keep build execution separate from tests so `npm run check` and `npm test` remain distinct gates.

## Non-Goals

Do not add a nested runtime Jiti dependency or replace Pi's extension loader.

Do not change commands, tools, schemas, settings, persistence formats, event channels, prompts, menus, status keys, or Plan-to-Goal behavior.

Do not move required registration or session restoration behind first use merely to improve timing output.

Do not bundle third-party packages, Pi peers, or another extension package.

Do not commit generated `dist` files, publish a package, create a tag, or dispatch a release workflow.

Do not optimize another extension in this objective.

## Assumptions

“Use Jiti” means generating `.ts` runtime artifacts for Pi's existing Jiti loader, not invoking Jiti from inside the `pi-workflow` extension factory.

The performance result is accepted only when extension import time improves materially and first-response time does not regress; moving equivalent work to `session_start` is not an improvement.

The source and generated benchmark arms will run on the same revision, machine, Pi version, Node runtime, and settled system conditions.

## Risks

A generated native JavaScript entry can bypass Pi's Jiti aliases and resolve a second Pi runtime; generated `.ts` artifacts, external packages, and Jiti traces must prove one host Pi runtime is used.

Bundling can collapse dynamic imports and evaluate cold UI or handoff modules eagerly; esbuild metadata, generated-file inspection, Jiti traces, and existing lazy-loader tests must guard the boundary.

A stale or partial `dist` can pass source tests but fail after publication; deterministic clean builds, staging, stale-chunk tests, declared-entry runtime tests, pack inspection, and extracted-package smokes must validate the artifact itself.

Changing the manifest to an ignored generated entry can break unbuilt local package loading; package scripts, README instructions, `just try`, and clean-build smokes must make the prerequisite explicit and reliable.

Source maps may not be applied automatically after Jiti retransforms generated `.ts`; ship and validate maps, and record whether automatic or manual source resolution is the supported diagnostic path.

Performance samples can be distorted by Jiti cache population or machine contention; reject non-stationary runs, retain raw JSON, compare medians and median absolute deviations, and rerun both arms under matched conditions.

The current boundary validator still rejects `dist/index.ts`; it must be updated with controlled fixtures before the package manifest changes.

## Rollback / Recovery

No settings, session, or persistence migration is involved.

If build safety, runtime identity, lazy-boundary parity, packaging, diagnostics, or performance gates fail, restore `pi.extensions` to `./src/index.ts`, remove bundle-only scripts and the package-owned build dependency, regenerate the lockfile, and keep all authoritative source behavior unchanged.

The general convention and validator support for optional `dist/index.ts` entries may remain if their tests pass independently of `pi-workflow` adoption.

## Plan

- [x] Re-capture matched source baselines before code changes with seven warm measured runs, three `JITI_REBUILD_FS_CACHE=1` runs, and one `JITI_DEBUG=1` trace; evidence: warm import/response medians were 334 ms/1,374.09 ms, retained forced medians were 961 ms/2,133.32 ms, and the trace recorded 39 eager package paths in `/tmp/pi-workflow-jiti-source-*.{json,txt}`.
- [x] Add pinned `esbuild` build tooling only to `@narumitw/pi-workflow` and regenerate `package-lock.json` through root `npm install`; evidence: `npm ls esbuild --all` resolves package-owned `esbuild@0.28.1`, the manifest/lock classify it as dev-only, root `allowScripts` permits that exact version, and no Jiti runtime dependency was added.
- [x] Add failing package tests for the planned runtime builder before implementing it; evidence: `npx vitest run packages/pi-workflow/test/build-runtime.test.ts` failed 6/6 because `scripts/build-runtime.mjs` did not exist, after the tests covered output guards, deterministic/stale output, failure preservation, generated files/maps/specifiers, externals, and eager-boundary rejection.
- [x] Implement `packages/pi-workflow/scripts/build-runtime.mjs` with staged split `.ts` output, metadata validation, guarded publication, and recovery of the previous valid `dist`; evidence: 7/7 builder tests pass, two clean builds produced byte-identical hashes for 19 runtime files plus 19 maps, validation/publication failures restored previous output, output guards reject symlink escapes, and no staging/backup directory remained.
- [x] Define and enforce the generated eager boundary from current production lazy imports, including Workflow menu/handoff, Goal menu/settings UI, Plan interactive UI/export/preflight/fresh implementation, and eager `@narumitw/pi-tui-kit`; evidence: controlled tests rejected all eight first-use roots, eager Kit, and bundled package inputs, while two real split-build metadata graphs passed with no `node_modules` input.
- [x] Add controlled repository validator tests, then update `scripts/check-extension-boundaries.mjs` to accept exactly one `./src/index.ts` or build-backed `./dist/index.ts` manifest entry while still requiring the thin in-source `src/index.ts` forwarder, lifecycle metadata, `files` alignment, and dist build/prepack metadata; evidence: the red fixture failed on dist, then 3/3 validator tests passed source/dist and rejection cases, and `npm run check:boundaries` accepted all 26 active extensions.
- [x] Update `packages/pi-workflow/package.json` to build and prepack the runtime, publish `src` plus `dist`, and declare `./dist/index.ts`; evidence: an unbuilt package-directory benchmark failed with no declared timing, `npm --workspace @narumitw/pi-workflow run build` created `dist/index.ts`, the same package-directory RPC benchmark loaded that path, boundaries passed, and `src/index.ts` remains unchanged.
- [x] Add declared-entry integration coverage that loads the generated entry through Pi/Jiti and verifies factory registration, `/workflow`, `/plan`, and `/goal` discovery, required tools/hooks, missing-settings behavior, experimental warning, session start, reload, session replacement, and shutdown; evidence: `workflow-runtime-smoke.mjs` now loads `dist/index.ts`, asserts all commands/tools/core handlers, and passed its full generated lifecycle suite, while source registration tests retain missing-settings and warning assertions.
- [x] Run the existing lazy-loading, command, settings, persistence, handoff, cancellation, queue, and runtime smoke suites against the authoritative source, and add only the minimum generated-entry parity cases needed for chunk first use; evidence: rebuilt Kit plus 44 focused files passed 595/595 tests, the generated runtime smoke passed all Plan/Goal scenarios, and existing loader rejection/stale-session tests remain green.
- [x] Inspect checkout and isolated extracted-package `JITI_DEBUG=1` traces; evidence: checkout loaded 11 generated eager paths and the extracted production install loaded 13 trace paths, both loaded zero source paths, eager Kit paths, or package-local Pi runtimes; the artifact has 19 runtime files/maps, and `SourceMap` validation maps generated Workflow registration to `src/workflow.ts` as the supported manual diagnostic path.
- [x] Compare source and generated entries with seven warm runs and three forced-Jiti-rebuild runs per arm under matched conditions; evidence: stationary warm medians improved from 410 ms/2,010.19 ms import/response to 110 ms/1,734.19 ms (73.2% import), stationary forced medians improved from 1,190 ms/2,729.68 ms to 532 ms/1,893.14 ms (55.3% import), both deltas exceeded five source MADs, and 10 additional alternating forced pairs all reduced import with a -248.9 ms median paired response delta despite system-load outliers.
- [x] Update `packages/pi-workflow/README.md` with the Jiti-loaded package architecture, generated `dist` layout, build-aware local checkout command, and authoritative-source statement, and add a patch Changeset for `@narumitw/pi-workflow`; evidence: README badges and standard sections remain, `.changeset/faster-workflow-jiti.md` adds a patch, and Changesets status includes it alongside the untouched pending `quick-workflow-actions` changeset.
- [x] Run a clean `just pack workflow`, inspect the dry-run and real tarball for complete `src`, generated entry/chunks/maps, README/license, no build-only tooling, and no stale files, then install or extract it into an isolated production-style package root and verify offline Pi RPC command discovery plus representative missing/invalid-settings and shutdown smokes; evidence: dry/real packs contained 94 intended package files (38 dist, 53 source, package/docs/license, no scripts), production install loaded all three commands, malformed settings emitted safe warnings plus the experimental notice, and both RPC processes shut down cleanly.
- [ ] Run focused `pi-workflow` tests and `npm --workspace @narumitw/pi-workflow run test:runtime`, then run `npm run check` and `npm test` separately; focused tests passed 595/595 after rebuilding Kit, generated runtime smoke passed, and `npm run check` passed; two full `npm test` attempts did not complete because unrelated pi-worktree, pi-sync, pi-subagents, and pi-statusline tests failed or timed out, including one command-scoped retry with commit signing disabled, while no pi-workflow failure appeared.
- [ ] Audit the final diff against `docs/extension-conventions.md`, the archived generated-runtime rollback, package boundaries, lifecycle awaits, cancellation/disposal/replacement/shutdown, package contents, benchmark methodology, documentation, and release rules; verify no settings protocol or public behavior changed, remove temporary tracked artifacts, report all deviations/unverified platforms, and do not publish without separate approval.

## Completion Checklist

- [ ] The package declares `./dist/index.ts`, retains an authoritative thin `src/index.ts`, and a clean build produces deterministic guarded `.ts` runtime artifacts without source backreferences or bundled packages; verify with manifest inspection, builder tests, metadata validation, and `npm run check:boundaries`.
- [ ] Checkout, generated entry, and isolated packed-package paths load through Pi's Jiti runtime with one host Pi instance and no missing or stale chunk; verify with Jiti traces, offline RPC smokes, and tarball inspection.
- [ ] Existing eager registration and session restoration remain ready at startup while all current cold modules stay lazy; verify command/tool/hook discovery, metadata/Jiti eager graphs, and first-use loader tests.
- [ ] Loader errors remain observable and retryable, and cancellation, component disposal, session replacement, reload, and shutdown prevent stale generated-chunk continuations from causing side effects; verify focused lifecycle and runtime tests.
- [ ] Warm import median improves by at least 60%, forced-rebuild import median improves by at least 20%, both improvements clear the noise gate, and neither first-response median regresses; verify retained raw benchmark JSON and the recorded comparison.
- [ ] The README, package layout, local build workflow, patch Changeset, and rollback instructions accurately describe the shipped architecture; verify documentation review, Changesets status, and clean-checkout commands.
- [ ] Focused tests, runtime smoke, `npm run check`, `npm test`, package dry run, real tarball inspection, extracted-package Pi smokes, and the final semantic audit all pass with no unaccepted deviation or unreported unverified path.
