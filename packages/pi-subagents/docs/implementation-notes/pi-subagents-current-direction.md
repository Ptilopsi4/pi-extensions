# pi-subagents current direction

This note is the entry point for current `@narumitw/pi-subagents` planning.

## Current product shape

`pi-subagents` is a retained background-agent runtime, not an automatic planner or workflow engine.

The main agent decides whether to delegate, starts one agent per independent task, coordinates dependencies, integrates results, runs deterministic checks, and owns the final answer.

The built-in catalog remains intentionally small:

| Built-in | Purpose | Default tools |
| --- | --- | --- |
| `explorer` | Bounded read-only repository exploration with cited paths and evidence. | `read`, `grep`, `find`, `ls` |
| `worker` | Write-capable implementation, command execution, and fixes with clear ownership. | Pi default tools |

## Delegation rules

Use no subagent for simple, latency-sensitive, conversational, tightly coupled, or immediate critical-path work.

Use `explorer` when bounded evidence can run beside useful main-agent work or save parent context.

Use `worker` only for a disjoint implementation slice with explicit ownership and a supported integration path.

Start multiple agents only for independent tasks whose parallel progress justifies coordination.

Keep ordinary planning, sequencing, fan-in, review, verification, and final synthesis in the main agent.

## Tool surface

Enabled retained delegation exposes exactly:

- `subagent_spawn`;
- `subagent_send`;
- `subagent_await`;
- `subagent_manage`;
- `subagent_mailbox`; and
- `subagent_inspect`.

Disabled retained delegation exposes `subagent_inspect` only.

`subagent_await` is the supported intentional join after useful overlapping parent work is complete.

Its wait timeout and caller cancellation never interrupt or close the child.

The former blocking execution and synchronous consultation routes were removed in a breaking migration.

Read-only evidence now uses `explorer`, but its configured read-only tools do not reproduce the removed consultation route's stricter resource-loading contract.

Parallelism uses several independent spawns, and the main agent owns fan-in.

## Retained boundary

Retained agents keep identity, bounded logical history, follow-up generations, hierarchy, mailbox state, semantic snapshots, completion requirements, and target policy.

Restored agents remain inert until an explicit follow-up.

Subprocess, in-process, RPC, and automatic transports remain maintained.

`next-turn` remains the default non-waking completion delivery, while `auto-resume` is opt-in.

Shared-workspace writers require disjoint ownership, and disposable worktrees remain available for repository-write isolation.

## Active follow-ups

Evaluate retained features individually against demonstrated use before adding new orchestration layers.

Do not reintroduce chains, panels, workflow DAGs, managed verification, or synchronous child execution without a separately approved product decision and evidence that main-agent coordination is insufficient.

A future bounded-job simplification may remove retained conversations, mailboxes, or multiple transports, but this migration does not make that decision.

## Current reference notes

- [`pi-subagents-capability-matrix.md`](pi-subagents-capability-matrix.md) records maintained retained capability and ownership boundaries.
- [`pi-subagents-rpc-v1.md`](pi-subagents-rpc-v1.md) records the persistent RPC transport contract.
- [`../async-runtime-protocol.md`](../async-runtime-protocol.md) records completion delivery and unavailable hard-barrier guarantees.

Historical benchmark analyses and result files remain evidence for their recorded package surfaces and are not active workflow commands.
