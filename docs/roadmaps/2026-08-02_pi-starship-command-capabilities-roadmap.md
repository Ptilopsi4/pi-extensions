# pi-starship Command Capabilities Roadmap

## Vision

Make `/starship` a trustworthy Pi-native surface for understanding, inspecting, and safely changing
the footer. Follow the useful intent of upstream Starship commands—especially `explain`, `module`,
`print-config`, `toggle`, and `bug-report`—without cloning shell-only commands or weakening Pi's
render, lifecycle, privacy, and settings boundaries.

**Current roadmap status:** Phases 1–4 are delivered on `main` and available from the published package.
Phase 5 has verified implementation in the current change but remains unchecked until merge evidence is recorded.
Phases 6–8 remain planned and have no complete implementation.

## Objectives

- **Explain the current footer** — Success after Phase 2: every non-empty module in the rendered
  footer is represented exactly once with a catalog-owned name and description, using the same
  immutable snapshot and no new render-time I/O.
- **Make all supported modules discoverable** — Success after Phase 3: every catalog module appears
  once with a non-color state, current preview when available, and an accurate reason when it is not
  showing.
- **Make configuration state transparent** — Success after Phase 5: users can distinguish overview, the exact loaded settings text, and effective public configuration.
  Every read-only path creates zero files, deleting the settings document can be previewed as a valid transition to built-in defaults, and every failed or cancelled reload preserves the last valid effective footer.
- **Keep mutations truthful and recoverable** — Success after Phase 6: no action conflates module
  `disabled` state with root-format reachability, and every approved mutation retains preview,
  confirmation, atomic publication, rollback, and unknown-field protection.
- **Improve support without collecting telemetry** — Success after Phase 7: users can review a bounded, sanitized diagnostic report locally without an automatic network request.
- **Keep performance claims truthful** — Success after Phase 8: an evidence-backed decision either delivers accurately labelled asynchronous collector health measurements or rejects the view as non-actionable.
  Adoption targets remain TBD because the repository has no telemetry or grounded usage baseline.

## Current State

- `@narumitw/pi-starship` renders Starship-style TOML natively and does not invoke the Starship binary
  or load `~/.config/starship.toml`.
- The built-in footer uses an explicit nine-module root. Module reachability controls whether cached
  filesystem, Git, command, timer, or network work starts; footer rendering itself is pure.
- PR #516, PR #517, and PR #518 provide the trustworthy management baseline, footer explanation,
  and searchable module browser with lifecycle and settings regression coverage.
- PR #629 adds complete Pi-native preset documents for every Starship 1.26 preset style plus Minimal,
  followed by an in-memory live-preview picker and the existing transactional apply workflow.
- `/starship` now has seven top-level actions: Customize footer, Presets, Explain footer, Modules,
  Configuration, Help, and Restore built-in.
- The renderer's grouped output feeds a catalog that owns module names, descriptions, variables,
  defaults, options, and ordering. One pure inspection model combines those entries with effective
  config, root reachability, and the current immutable runtime snapshot for Explain and Modules.
- Configuration now separates Overview, Effective configuration, Settings document, and Reload from disk on one nested level.
  The effective projection is catalog-ordered public TOML, the loaded UTF-8 document stays separate and terminal-safe at the display boundary, and reload previews a final revalidated disk snapshot without writing files.
- `/starship settings`, `/starship status`, and `/starship help` remain the only direct routes.
  Print and JSON modes intentionally emit no ad hoc command output; RPC uses notifications rather
  than custom terminal UI.
- There is no structured module mutation UI, diagnostic-report exporter, or collector duration
  instrumentation.
- Checked-in upstream Starship at the repository-pinned revision defines `explain` as a breakdown of
  currently visible modules, `module` as one-module rendering/listing, `print-config` as defaults
  merged into computed config, `toggle` as a config mutation, and `timings` as module execution cost.
  Only the user goals—not shell-specific implementation details—transfer to Pi.

## Guiding Principles

- **Adapt, do not imitate:** preserve upstream command intent only when it maps to a real Pi footer
  goal.
- **Explain before mutating:** establish read-only output, module state, and configuration semantics
  before adding structured settings actions.
- **One source of truth:** derive descriptions and state from the module catalog, effective config,
  rendered result, and immutable runtime snapshot rather than duplicating module logic in commands.
- **Truthful states:** distinguish Showing, Empty, Disabled, Not in format, and—only when collector
  evidence exists—Unavailable in text; never describe `disabled = false` alone as visible or enabled
  in the footer.
- **Pure presentation:** explanation, previews, and TUI rendering perform no filesystem, subprocess,
  environment, timer, or network work.
- **Safe settings:** missing-file reads stay side-effect free; invalid documents remain protected;
  writes remain explicit, serialized, atomic, rollback-capable, and unknown-field aware.
- **Shallow navigation:** keep no more than seven top-level goals and add depth only for coherent
  Configuration or Help & support capabilities; do not restore an undifferentiated Advanced menu.
- **Private support:** reports use an allowlist, remain local until explicit user action, and never
  include credentials, message content, complete paths, remote URLs, or raw configuration by default.

## Roadmap

### Phase 1: Land the trustworthy management baseline

- [x] The state-aware, four-action `/starship` workflow is merged on `main` with its adaptive preview,
  strict routing, destructive-restore disclosure, side-effect-free missing-file behavior, and
  deterministic lifecycle/settings checks intact. Evidence: PR #517 merged as `6a39955`; CI and
  CodeQL completed successfully.

**Outcome:** The source baseline on `main` makes customization and recovery dependable enough to host
additional read-only capabilities without reopening foundational menu, preview, or persistence
problems. npm publication was outside this phase and occurred later.

### Phase 2: Explain what is showing

- [x] Every registered module exposes a concise catalog-owned description suitable for command UI and
  documentation without changing its render behavior. Evidence: PR #518 merged as `a1834b9`; catalog
  type coverage and focused duplicate/non-empty description tests pass for all registered modules.
- [x] **Explain footer** presents each currently rendered non-empty module exactly once with rendered
  value, module name, description, and available snapshot state; it has explicit empty/unavailable
  states and starts no collection work. Evidence: PR #518's responsive TUI, runtime collector-spy,
  lifecycle, CI, and CodeQL checks passed.

**Outcome:** Users can answer “what is this footer showing, and why?” from the same data that produced
the footer. This establishes the shared explanation model needed by module browsing and support.

### Phase 3: Make module state discoverable

- [x] **Modules** provides a bounded searchable list in which every catalog module has one textual
  state: Showing, Empty, Disabled, Not in format, or Unavailable only when the current footer cannot
  provide an inspection snapshot. Evidence: PR #518's catalog/state/search/resize/keybinding tests
  passed.
- [x] Module detail exposes its current preview when available, format variables, relevant style and
  display fields, root reference and reachability, and every reason the runtime can determine for
  absent output without writing settings. Evidence: PR #518's detail, no-write, disposal,
  replacement, shutdown, CI, and CodeQL checks passed.

**Outcome:** Users can inspect supported and hidden capabilities without reading source or assuming
that absence means disabled. The state model provides the prerequisite for honest module actions.

### Phase 4: Add safe Pi-native presets

- [x] A bundled catalog provides complete Pi-native documents for every Starship 1.26 preset style
  plus Minimal without invoking Starship, downloading files, or copying upstream module selections.
  Evidence: PR #629 commits `46f59ba` and `37ef7dc`; catalog and configuration tests cover every
  preset.
- [x] **Presets** supports bounded browsing, in-memory live footer preview, customization before
  apply, explicit replacement confirmation, atomic publication, rollback, and cleanup on Back,
  cancellation, disposal, session replacement, and shutdown.
  Evidence: PR #629 commit `fe4da29`; command UX and lifecycle tests cover preview and failure paths.

**Outcome:** Users can safely start from recognizable visual styles without shell integration,
remote data, hidden writes during browsing, or weaker recovery behavior.

### Phase 5: Separate written and effective configuration

- [ ] **Configuration** becomes one coherent section containing Overview, Effective configuration, Settings document, and Reload from disk while the top-level menu remains at seven or fewer goals.
- [ ] Effective configuration deterministically projects every recognized public TOML field from normalized effective state in stable catalog order and excludes comments, unknown fields, ASTs, and private runtime selectors.
- [ ] Settings document presents the exact loaded UTF-8 text through a terminal-safe read-only view, sanitizes only at the display boundary, and explains the healthy state in which no settings document exists.
- [ ] Reload from disk validates and previews the current external state, applies only after confirmation in a valid current generation, and creates no file.
  A missing document is a valid previewable transition to built-in defaults, while read or parse failure, cancellation, replacement, shutdown, or apply failure preserves the prior effective footer.

**Outcome:** Users can distinguish what they wrote from what pi-starship is using and can safely apply external edits or deliberate file removal without reloading the whole Pi session.

### Phase 6: Decide whether module changes can be safe

- [ ] A documented go/no-go module-action contract decides separately how `disabled` and root-format reachability change, including what happens to `$all`, duplicate references, comments, document layout, unknown fields, custom root expressions, and modules whose collectors have lifecycle cost.
  The decision approves only actions supported by a verified lossless TOML mutation path or records that module browsing remains read-only.
- [ ] Every approved action is exposed from module detail with accurate resulting state, adaptive preview, explicit confirmation, serialized atomic publication, runtime apply, rollback, cancellation, and stale-session protection.
  If no action is approved, the phase closes with the documented no-go evidence instead of weakening document preservation.

**Outcome:** pi-starship either offers module actions that produce the visible result they promise without damaging the settings document or retains an explicitly read-only module browser.

### Phase 7: Make support evidence safe and actionable

- [ ] **Help & support** can produce a local preview of a bounded diagnostic report containing only allowlisted version, configuration-state, sanitized diagnostic, module-state, and collector-health fields.
- [ ] Sharing, opening documentation, or opening an issue always requires a separate explicit user action, and report generation makes no automatic network request.

**Outcome:** Users can diagnose and report problems with useful local evidence without hidden telemetry or accidental disclosure.

### Phase 8: Decide whether collector performance evidence is actionable

- [ ] A demand and measurement review decides whether bounded collector duration, age, and failure instrumentation would produce actionable support evidence without adding render-time work.
- [ ] The resulting decision either delivers accurately labelled asynchronous collector health measurements or records why the view is rejected.
  Delivered measurements are never labelled as upstream-style module timings.

**Outcome:** Performance information is either trustworthy and useful or deliberately absent rather than misleading.

## Proposed Information Architecture

```text
/starship
├─ Customize footer
├─ Presets
├─ Explain footer
├─ Modules
├─ Configuration
│  ├─ Overview
│  ├─ Effective configuration
│  ├─ Settings document
│  └─ Reload from disk
├─ Help & support
│  ├─ Quick help
│  ├─ Diagnostic report
│  └─ Documentation
└─ Restore built-in…
```

`Explain footer` owns the current full preview and visible-module breakdown. A separate top-level
Prompt preview is not planned because Pi already displays the footer continuously.

## Upstream Command Adaptation

| Upstream Starship command | pi-starship direction | Roadmap position |
| --- | --- | --- |
| `config` | Keep transactional Customize; add safe external reload | Existing / Phase 5 |
| `explain` | Explain currently rendered Pi modules | Phase 2 |
| `module` | Search, inspect, and preview one Pi module | Phase 3 |
| `print-config` | Show a read-only public effective-config projection | Phase 5 |
| `toggle` | Separate disabled state from root-format reachability | Phase 6 |
| `bug-report` | Preview a sanitized local support report | Phase 7 |
| `timings` | Decide whether asynchronous Pi collector measurements are actionable | Phase 8 gate |
| `prompt` | Integrate current preview into Explain footer | Phase 2 |
| `preset` | Browse and transactionally apply bundled Pi-native adaptations | Phase 4 |
| `completions`, `init`, `session`, `statusline` | Exclude shell/provider lifecycle commands | Non-goal |

## Success Metrics

| Indicator | Baseline | Target / invariant | Measurement source |
| --- | --- | --- | --- |
| Visible modules represented by Explain | No Explain surface | Every non-empty rendered module exactly once | Render/explain parity tests |
| Catalog modules represented in Modules | No module browser | Every registered module exactly once with a textual state | Catalog-driven UI tests |
| I/O started by footer/explanation rendering | 0 | 0 | Source audit and collector-spy tests |
| Files created by read-only command paths | 0 | 0 | Missing-directory/filesystem tests |
| Files changed by preset browsing or cancellation | 0 | 0 | Preset UX and lifecycle tests |
| Public effective-config fields | No projection | Every recognized public TOML field in stable catalog order; no AST/private runtime data | Serialization contract tests |
| Missing-document reload | Not available | Previewable built-in transition with 0 files created | Settings/lifecycle tests |
| Invalid/cancelled reload changes | Not available | 0 file bytes and 0 effective-state changes | Settings/lifecycle tests |
| Sensitive or raw content in diagnostic report | No report | 0 excluded fields; 0 automatic network requests | Allowlist/redaction tests |
| Adoption and task-completion rate | Unknown; no telemetry | TBD only if privacy-compatible evidence exists | No current measurement source |

## Risks and Dependencies

| Risk or dependency | Impact | Mitigation / decision |
| --- | --- | --- |
| Catalog descriptions or state semantics drift from rendering | Explain and Modules could become inconsistent with the footer | Keep metadata catalog-owned and retain render/inspection parity plus exhaustive catalog tests. |
| Per-module chunks do not alone explain root reachability or empty values | A browser could mislabel modules | Keep the shared inspection model derived from effective config, root variables, and the same rendered result. |
| Effective config contains ASTs or private selectors internally | Output could expose invalid/non-public schema | Serialize through an explicit public projection; keep the exact loaded UTF-8 settings text as a separate read-only view. |
| `disabled` and explicit root format are independent | A copied `toggle` action could promise visibility without producing it | Gate Phase 6 on a documented two-axis action contract and preview the resulting footer. |
| The current TOML parser does not provide lossless document mutation | Structured actions could erase comments, layout, or unknown fields | Require a verified lossless mutation path for every approved Phase 6 action; otherwise keep Modules read-only. |
| Collectors have asynchronous cost while rendering is pure | Upstream `timings` semantics would be misleading | Use the Phase 8 demand and measurement gate to instrument collector health separately or reject the feature. |
| Diagnostic context can contain paths, remotes, config, or terminal controls | Support output could leak data or inject terminal content | Use bounded allowlisted fields, sanitize at the display boundary, and preview before sharing. |
| Applying a complete preset replaces custom settings, unknown fields, and comments | Users could lose document-specific customization | Preview the resulting footer, disclose complete replacement, require separate confirmation, and retain rollback on failure. |
| Zero-major pi-tui-kit ranges intentionally do not follow workspace minors | Consumers can miss newer shared lifecycle and keybinding behavior | Raise each consumer's compatibility floor only through a manually reviewed dependency change and verify its resolved package. |
| No usage telemetry for command adoption | Prioritization and task-completion value remain uncertain | Keep adoption targets explicit unknowns and use privacy-compatible user feedback for future prioritization. |

## Decisions and Changes

- **2026-08-02 — Defer release (superseded):** Phase 1 originally completed when the verified command
  baseline merged on `main`, without implying package publication.
- **2026-08-02 — Keep inspector compatibility local:** pi-starship initially retained its declared
  pi-tui-kit compatibility floor, so Explain and Modules shipped through one extension-owned
  adaptive inspector rather than relying on newer monorepo-only APIs.
- **2026-08-02 — Raise the helper floor explicitly:** after Phase 2–3 merged, a separate manually
  reviewed change raises pi-starship's pi-tui-kit floor to the shared API-v5 release. The inspector
  remains extension-owned because the kit still has no searchable read-only browse/detail screen;
  consumer ranges must not be synchronized automatically.
- **2026-08-08 — Deliver presets and release:** PR #629 adds the full bundled preset catalog and live
  preview workflow. The subsequent release publishes the current command surface, removing the prior
  source-versus-registry availability gap.
- **2026-08-21 — Clarify the remaining gates:** Phase 5 now treats deliberate settings-file removal as a previewable transition to built-in defaults and describes the raw view as exact loaded UTF-8 text rather than byte-preserving storage.
  Phase 6 requires verified lossless TOML mutation or an explicit no-go decision, and collector performance evidence moves to its own Phase 8 gate so safe local diagnostics do not depend on speculative instrumentation.

## Non-Goals

- Authorize a future package version bump, npm publication, Git tag, or GitHub release.
- Clone the complete Starship CLI or promise full Starship module/config compatibility.
- Add shell completions, shell initialization, random session keys, provider statusline generation, or
  ad hoc print/JSON output.
- Invoke the Starship executable, read `~/.config/starship.toml`, run arbitrary custom commands, or
  expose unrestricted environment variables.
- Download presets remotely, invoke Starship's preset command, or promise identical upstream module
  selections rather than Pi-native visual adaptations.
- Add module timing labels without collector instrumentation, or add telemetry to establish adoption.
- Change formatter/style semantics, the built-in nine-module root, module defaults, palette behavior,
  settings location, or backup/migration policy as part of these command capabilities.
- Automatically create a GitHub issue or transmit diagnostics without a separate informed action.

## Assumptions and Unknowns

- This roadmap is for maintainers and contributors; no delivery dates, owners, capacity commitments,
  or release horizon were supplied.
- Milestone completion tracks verified capabilities merged on `main`; published availability is
  reported only when independently verified.
- Explainability and discovery are assumed to be more valuable and lower risk than immediate module
  mutation because they build on existing renderer/catalog data and do not write settings.
- Demand for structured toggles, collector performance diagnostics, and issue creation is unknown.
  Their scope must remain gated rather than inferred from upstream Starship's CLI; as of 2026-08-21, the repository has no open starship issue establishing those capabilities as urgent.
- New direct routes such as `/starship explain` or `/starship module` are not assumed. Menu-first TUI
  delivery should precede any RPC/non-TUI protocol decision with a concrete automation use case.
