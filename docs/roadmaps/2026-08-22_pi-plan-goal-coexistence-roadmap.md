# Pi Plan and Goal Coexistence Roadmap

- **Status:** Phases 1–3 are implemented and merged; release publication and the Phase 4 product decision remain pending.
- **Last verified:** 2026-08-22.
- **Audience:** Maintainers and users of `pi-plan-mode`, `pi-goal`, and `pi-workflow`.

## Vision

Maintain two focused products: `pi-plan-mode` for collaborative planning and `pi-goal` for autonomous execution.

Let independently installed workflow extensions avoid overlapping work through one anonymous, session-scoped cooperative mutex over `pi.events`.

Retire the duplicated `pi-workflow` product only after coexistence is proven and a separate deprecation decision approves the migration.

## Objectives

- **Safe coexistence** — At most one participating agent workflow is active in one Pi session.
- **Anonymous coordination** — The protocol never identifies or requires a particular extension.
- **Independent products** — Plan and Goal remain installable and functional by themselves.
- **Minimal architecture** — No workflow engine, coordinator package, shared runtime singleton, or distributed workflow state machine is introduced.
- **No failed-start side effects** — A rejected workflow start changes no state, tools, prompt, queue, or persistent entry.
- **Evidence before deprecation** — `pi-workflow` remains active until supported Plan and Goal versions pass coexistence and migration gates.

## Current State

- `pi-plan-mode`, `pi-goal`, and `pi-workflow` remain stable extensions.
- Workflow Mutex Protocol v1 is implemented independently by Plan and Goal on `main` without extension-to-extension imports or dependencies.
- [PR #895](https://github.com/narumiruna/pi-extensions/pull/895), [PR #897](https://github.com/narumiruna/pi-extensions/pull/897), [PR #899](https://github.com/narumiruna/pi-extensions/pull/899), and [PR #900](https://github.com/narumiruna/pi-extensions/pull/900) are merged.
- Pi `0.84.2` is the characterized runtime for synchronous event delivery, shared event-bus behavior, session identity, and stale-listener cleanup.
- Deterministic source and generated-entry tests verify both load orders, both acquisition orders, restore collisions, release and reacquisition, lifecycle cleanup, and standalone behavior.
- Merged Changesets record the first protocol-aware release intent as Plan `0.52.0` and Goal `0.53.0`.
- The npm registry still serves Plan `0.51.1` and Goal `0.52.3`, so the documented coexistence floors are not yet available to registry installers.
- Pi still exposes one process-wide active-tool array, and `setActiveTools()` still replaces the complete array, so the mutex remains a cooperative boundary rather than tool-policy composition.
- `pi-workflow` still provides atomic `/workflow` Plan-to-Goal behavior that the focused products do not replace.
- No release publication, tag, npm deprecation, repository archival, or `pi-workflow` product decision has been approved by this roadmap.

## Current Flow

```mermaid
flowchart TD
    A["A participating workflow wants to start"] --> B["Finish asynchronous preflight"]
    B --> C["Attempt to enter the session workflow mutex"]
    C --> D{"Is the mutex busy?"}
    D -->|"Yes"| E["Reject without changing state or tools"]
    D -->|"No"| F["Synchronously record local ownership"]
    F --> G["Apply the workflow's prompt and tool policy"]
    G --> H["Hold ownership while work can run or resume"]
    H --> I["Exit the mutex-holding state"]
    I --> J["Release ownership for another participant"]
```

## Workflow Mutex Contract

The [Workflow Mutex Protocol v1](../api/workflow-mutex-v1.md) channel is `workflow:mutex:v1`.

An attempt contains only:

```ts
interface WorkflowMutexAttempt {
	session: object;
	group: string;
	busy: boolean;
}
```

Plan and Goal use the `agent-workflow` group.

Every participant follows these rules:

- A listener checks only its own state and sets `busy = true` when it holds the matching session and group.
- A listener never reports its identity, state schema, tools, command, or lifecycle operations.
- The listener is synchronous and performs no asynchronous work.
- A requester completes every `await` before emitting the attempt.
- A successful requester commits local ownership immediately, with no `await` between the result and the commit.
- Leaving the mutex-holding state releases local ownership.
- No listener leaves `busy` as `false`, so every extension remains functional when installed alone.

This is an advisory mutex among participating extensions, not a Pi-enforced lock or general tool-policy composition API.

## Roadmap

### Phase 1: Establish the bounded protocol

- [x] Repository guidance permits documented, versioned, extension-neutral protocols that preserve standalone behavior.
- [x] [Workflow Mutex Protocol v1](../api/workflow-mutex-v1.md) defines the channel, schema, synchronous critical section, session scoping, mutex groups, ownership states, malformed-input behavior, and version policy.
- [x] The v1 contract explicitly prohibits participant identity, workflow control, state transfer, start or cancel RPC, plan handoff, and completion forwarding.
- [x] [`test/workflow-mutex-runtime.test.ts`](../../test/workflow-mutex-runtime.test.ts) characterizes Pi `0.84.2` listener start, shared delivery, session identity, and stale-listener cleanup; the protocol explicitly excludes uncharacterized runtimes without claiming product conformance.
- [x] The v1 version policy states that pre-protocol Plan or Goal releases cannot provide guaranteed coexistence with a protocol-aware peer.

**Outcome:** Any workflow extension can implement the same small mutex without knowing which other extensions are installed.

**Evidence:** [PR #895](https://github.com/narumiruna/pi-extensions/pull/895) merged the runtime characterization and bounded protocol updates.

### Phase 2: Make Plan and Goal participate

- [x] Every transition from inactive to a Plan mutex-holding state performs final admission after all asynchronous preflight and before any state, persistence, prompt, or tool mutation.
- [x] Every Goal activation path, including direct start, resume, retry recovery, and restored automatic continuation, respects one documented mutex-ownership rule; queue activation is not applicable because the focused Goal keeps legacy queued state inert.
- [x] Plan reports the mutex as busy while planning, ready, or revising, and releases it after implementation handoff, save, export-and-exit, discard, or exit.
- [x] Goal reports the mutex as busy for every state that can execute or resume automatically and releases it only after its existing terminal, stop, clear, or non-resumable transition.
- [x] An inactive Goal path that would widen active tools performs the same final busy check and defers its tool change while another workflow holds the group.
- [x] Restored active state holds the mutex before it can schedule work, and an unsupported legacy collision falls back to the existing restrictive-wins pause behavior without starting autonomous work.
- [x] A rejected start is observable in every supported command mode and preserves the exact prior state and active tools.
- [x] Loading either package alone preserves its current commands, tools, settings, persistence, and runtime behavior.

**Outcome:** Supported Plan and Goal versions coexist without becoming active at the same time and without importing or identifying one another.

**Evidence:** [PR #897](https://github.com/narumiruna/pi-extensions/pull/897) and [PR #899](https://github.com/narumiruna/pi-extensions/pull/899) merged the independent Plan and Goal implementations.

### Phase 3: Prove lifecycle and tool safety

- [x] Co-installation tests cover both extension load orders and both acquisition orders.
- [x] Tests cover session restore, inert legacy queue state, continuation, retry, Plan ready and revision states, cancellation, replacement, reload, shutdown, and stale callbacks; focused Goal queue activation is not applicable.
- [x] Tests prove that a busy result never invokes `setActiveTools()`, Goal visibility changes cannot widen an active Plan tool set, and Plan restores the exact pre-Plan set when it exits.
- [x] The current restrictive-wins Goal fail-safe remains as defense in depth for unsupported or non-participating tool policies.
- [x] Package documentation states the minimum counterpart versions for guaranteed coexistence and distinguishes standalone support from mixed-version guarantees.
- [x] Both repository gates, focused package tests, package dry runs, and isolated Pi loading smokes pass before release readiness is claimed.

**Outcome:** Coexistence is supported by deterministic lifecycle evidence rather than event timing assumptions alone.

**Evidence:** [PR #900](https://github.com/narumiruna/pi-extensions/pull/900) and the [release-readiness record](../implementation-notes/2026-08-22_plan-goal-coexistence-release-readiness.md) document the final coexistence matrix and verification gates.

### Phase 4: Decide and execute pi-workflow deprecation

- [ ] Maintainers explicitly approve deprecation after reviewing coexistence evidence, real usage, migration cost, and the loss of the atomic `/workflow` Plan-to-Goal product.
- [ ] A migration guide maps focused Plan and Goal use cases and states which combined `/workflow` behavior has no replacement.
- [ ] The deprecation plan defines its warning period, repository move, root entrypoint removal, archived tests, documentation, Changeset, and supported security or compatibility fixes.
- [ ] npm deprecation or any externally visible release action receives separate explicit approval.
- [ ] `pi-workflow` moves under `deprecated/` only after the approved warning and migration conditions are satisfied.

**Outcome:** The repository maintains the two focused extensions and preserves `pi-workflow` only as an archived reference after an evidence-backed migration.

## Success Measures

| Indicator | Required result |
| --- | --- |
| Active participating agent workflows per session | At most one |
| Participant identities in the mutex request | Zero |
| State or active-tool changes after a rejected attempt | Zero |
| Extension-to-extension imports or package dependencies | Zero |
| Standalone Plan and Goal behavior lost | Zero unapproved changes |
| Automatic Goal work started while Plan holds the group | Zero |
| Plan started while Goal holds the group | Zero |
| New workflow-engine or coordinator packages | Zero |
| `pi-workflow` deprecation before explicit approval | Never |

## Risks and Dependencies

| Risk | Response |
| --- | --- |
| `pi.events.emit()` has no awaited request-response contract | Keep every listener synchronous, characterize the installed runtime, and stop if Pi changes this behavior. |
| An `await` appears between admission and state commit | Centralize the critical section and test concurrent starts from both orders. |
| An older counterpart does not participate | Guarantee coexistence only for documented version floors and retain the current fail-safe behavior. |
| The protocol-aware version floors are not published yet | Keep release intent distinct from registry availability and do not claim installable coexistence until both versions are verified after publication. |
| A non-participating extension changes tools or starts work | Describe the mutex as cooperative and keep existing tool-loss guards; do not claim ecosystem-wide enforcement. |
| An anonymous busy result gives limited recovery guidance | Report that another workflow is active without guessing its owner or offering cross-extension control. |
| Goal has many automatic re-entry paths | Define mutex-holding Goal states once and audit every activation and continuation boundary against them. |
| The protocol grows into workflow RPC | Keep the schema boolean and anonymous, and require a separate proposal for every additional capability. |
| Deprecation removes atomic Plan-to-Goal behavior | Treat that loss as an explicit product decision, not an automatic consequence of coexistence. |

## Non-Goals

- Create `pi-workflow-engine`, a workflow-mutex package, or a coordinator extension.
- Make Plan import Goal, Goal import Plan, or either detect the other's commands, tools, settings, events, package, or version.
- Transfer a Plan into Goal or recreate `/workflow` as a distributed event protocol.
- Identify the mutex holder or allow one extension to start, stop, resume, or cancel another.
- Replace Pi's active-tool array with a general policy engine inside this repository.
- Guarantee exclusion against extensions that do not participate in the protocol.
- Deprecate, move, publish, or npm-deprecate `pi-workflow` without the Phase 4 approvals.

## Assumptions and Unknowns

- The cooperative mutex is the implemented Plan and Goal coexistence boundary for the characterized Pi `0.84.2` runtime.
- Both focused extensions remain stable products with their existing public commands and persisted state.
- Registry-installed coexistence remains unsupported until Plan `0.52.0` and Goal `0.53.0` are both published and verified.
- Mixed-version coexistence below either protocol-aware floor remains unsupported rather than silently claimed safe.
- It remains unknown whether enough users depend on atomic `/workflow` behavior to retain the combined product.
- No delivery date, publication, npm deprecation, or package removal is committed.

## Decisions and Changes

- **2026-08-03 — Earlier direction:** A shared `pi-workflow-engine` and three adapters were proposed.
- **2026-08-22 — Select focused products:** Prefer maintaining `pi-plan-mode` and `pi-goal` over extracting a workflow engine.
- **2026-08-22 — Select an anonymous cooperative mutex:** Coordinate only session and mutex-group occupancy through a versioned extension-neutral `pi.events` protocol.
- **2026-08-22 — Keep the protocol minimal:** Do not expose identity or add workflow control, state synchronization, or Plan-to-Goal handoff.
- **2026-08-22 — Reject side-thread planning:** Keep the existing inline Plan architecture and its optional fresh implementation handoff.
- **2026-08-22 — Defer deprecation:** Keep `pi-workflow` active until coexistence is proven and a separate explicit decision approves its migration.
- **2026-08-22 — Merge coexistence implementation:** Merge runtime characterization, independent Plan and Goal mutex participation, and deterministic coexistence evidence through PRs #895, #897, #899, and #900.
- **2026-08-22 — Separate readiness from release:** Record Plan `0.52.0` and Goal `0.53.0` as Changeset release intent without treating merged code as published registry availability.
