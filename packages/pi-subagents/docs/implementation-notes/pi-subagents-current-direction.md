# pi-subagents current direction

This note is the entry point for current `@narumitw/pi-subagents` planning.

## Current product shape

`pi-subagents` is a thin bounded-job adapter, not a retained-agent runtime, automatic planner, or workflow engine.

The main agent decides whether to delegate, provides a self-contained task, coordinates independent work, integrates results, runs deterministic checks, and owns the final answer.

Each accepted job starts one fresh Pi subprocess and exists only in the current session.

## Delegation rules

Use no subagent for simple, latency-sensitive, conversational, tightly coupled, or immediate critical-path work.

Use a default read-only job when bounded evidence can run beside useful main-agent work or save parent context.

Select write-capable tools only for a disjoint implementation slice with explicit workspace ownership and a supported integration path.

Start multiple jobs only for independent tasks whose parallel progress justifies coordination.

Keep ordinary planning, sequencing, fan-in, review, verification, and final synthesis in the main agent.

## Tool surface

The extension exposes exactly:

- `subagent_spawn`;
- `subagent_await`;
- `subagent_cancel`; and
- `subagent_inspect`.

`subagent_await` is the intentional join after useful overlapping parent work is complete.

Its timeout and caller cancellation never cancel the child.

The runtime exposes no follow-up, mailbox, hierarchy, settings, or management surface beyond cancellation.

## Runtime boundary

The job map is in-memory and scoped to one session manager.

The runtime supports one fresh-subprocess transport.

The child disables session persistence, unrelated extensions, skills, and prompt templates.

The child receives no parent conversation or communication channel.

The extension keeps no custom agent catalog and accepts only an explicit self-contained task plus a closed core-tool allowlist.

Completion delivery is non-waking and attempted at most once after terminal state commits.

## Deferred decisions

Child ask/reply remains deferred until demonstrated bounded-job use requires a clarification channel.

If added, it should use one bounded per-child IPC channel and must not restore retained conversations, mailboxes, or a generic transport layer.

Durability, lanes, forks, recovery, queues, tool replay, and long-lived conversation ownership belong in Pi's future public Harness surface rather than this extension.

The retained implementation, tests, dependencies, and executable benchmarks have been deleted from this package.

Source-entrypoint migration and removal of the build-backed runtime remain separate performance work.

## References

- [`../tools.md`](../tools.md) defines the active public schemas.
- [`../async-runtime-protocol.md`](../async-runtime-protocol.md) defines lifecycle and completion ownership.
- [`../bounded-runtime-migration.md`](../bounded-runtime-migration.md) defines the breaking migration.
- [`../simplification-priorities.md`](../simplification-priorities.md) records the adopted prioritization decision.

Historical benchmark analyses remain evidence for the package surfaces they measured and are not active workflow guidance.
