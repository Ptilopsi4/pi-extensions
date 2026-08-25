# pi-subagents current direction

This note is the entry point for current `@narumitw/pi-subagents` planning.

## Current product shape

`pi-subagents` is a delegation runtime, not an automatic planner.

The main agent decides whether to delegate and how to split work.

The built-in catalog is intentionally small:

| Built-in | Purpose | Default tools |
| --- | --- | --- |
| `explorer` | Bounded read-only repository exploration with cited paths and evidence. | `read`, `grep`, `find`, `ls` |
| `worker` | Write-capable parallel implementation, command execution, and fixes. | Pi default tools |

Removed built-ins and tools are not part of the active surface:

- `planner`;
- `reviewer`;
- `general`;
- `general-purpose`; and
- `subagent_auto`.

## Delegation rules

Use no subagent for simple, latency-sensitive, conversational, tightly coupled, or single-lane implementation work that the main agent can do directly.

Use `explorer` when a bounded read-only search can save main-context space or run independently.

Keep overall planning, immediate critical-path work, integration, final verification, and the final answer in the main agent.

A worker may directly implement a bounded slice with clear ownership when it can run independently beside useful non-overlapping main-agent work.

Use one async `worker` only when the main agent has named that local work to continue immediately and the worker result has a supported delivery and integration path.

If the main agent has no such local work, it should implement directly instead of spawning one worker.

Use two or more workers only for disjoint implementation slices whose parallel progress justifies coordination, and keep integration ownership in the main agent.

A single worker without concurrent main-agent work remains an explicit escape hatch for a user-requested specialist model, tool profile, or isolation boundary rather than the ordinary implementation path.

Use custom user or project agents for specialist review, verification, or shell-capable read-mostly work.

Custom project agents remain subject to existing trust and confirmation behavior.

Review should usually be handled by the main agent plus review skills and deterministic checks.

Use custom verifier agents only when independent child verification is explicitly worth the added cost and coordination.

## Tool-surface direction

`all` remains the compatibility default, while `async-only` remains an optional smaller tool surface.

`async-only` exposes `subagent_spawn`, `subagent_send`, `subagent_manage`, `subagent_mailbox`, and `subagent_inspect`.
`all` additionally exposes supported `subagent_await` and `subagent_consult` plus deprecated blocking `subagent` for compatibility.

`subagent_spawn` is preferred only when detached execution creates real parallelism rather than moving the main agent's only useful task into a child.

After spawning one worker, the main agent should immediately continue the named non-overlapping work instead of only announcing the spawn, waiting, polling, or ending the turn.

Final-answer-dependent detached work needs a supported synthesis path such as opt-in `auto-resume`; default `next-turn` delivery remains appropriate only when the current response does not depend on the result.

Blocking `subagent` is deprecated for new work but remains available with its existing schema and execution behavior for established callers and explicit requests whose chain, fan-in, panel, or workflow semantics lack a detached replacement.

No removal release or date is set until those compatibility modes have a separately approved replacement or migration.

`subagent_consult` remains a supported synchronous read-only exception.

`subagent_await` remains a supported intentional join after useful overlapping parent work is complete.

The four async lifecycle tools remain split because start, follow-up, lifecycle, and queue operations have distinct contracts.
`subagent_await` remains separate because waiting blocks the parent, its timeout never interrupts the child, and the async-only workflow must omit it.

Changing the default, removing deprecated `subagent`, or consolidating lifecycle tools needs a separate approved migration decision.

## Active follow-ups

None.

New implementation work should respond to demonstrated user needs rather than extending automatic or adaptive routing speculatively.

## Current reference notes

- Git history for the completed main-agent-led delegation guidance records the accepted delegation rubric and verification evidence.
- Git history for the completed async-first tool-surface work records the earlier tool-surface decision and implementation evidence.
- [`pi-subagents-capability-matrix.md`](pi-subagents-capability-matrix.md) records maintained capability, detached lifecycle, transport, trust, and runtime-ownership boundaries.
- [`pi-subagents-rpc-v1.md`](pi-subagents-rpc-v1.md) records the persistent RPC transport contract.

## Historical evidence

The consolidated [research synthesis](../../../../docs/research/coding-agent-subagents-research.md) records the architecture conclusions available at the research cutoff.

The companion [evidence catalog](../../../../docs/research/coding-agent-subagents-evidence-catalog.md) preserves paper-level results, caveats, and primary sources.

Superseded automation, proactivity, and old runtime notes were removed to keep the active docs small.

Git history remains the record of earlier research drafts and raw search transcripts.
