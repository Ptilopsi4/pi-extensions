# pi-subagents RPC v1

`pi-subagents:v1` is the extension-owned transport and metadata contract layered over Pi's built-in RPC JSONL protocol.

It does not add commands to Pi RPC or alter Pi command and event payloads.

## Envelope

Extension-owned progress, run inspection, and completion metadata may include these bounded fields:

```json
{
  "protocol": "pi-subagents:v1",
  "agentId": "sa_…",
  "transport": "rpc",
  "phase": "starting | ready | accepted | running | finalizing | retrying | compacting | settled | failed | interrupted",
  "timing": {},
  "provider": "…",
  "model": "…",
  "thinkingLevel": "medium",
  "usage": {}
}
```

Fields are additive and optional within v1.

A breaking lifecycle or envelope change requires another protocol identifier.

Raw prompts, chain-of-thought, credentials, headers, environment values, full stderr, and raw tool arguments never enter the envelope.

## Usage accounting

Pi 0.84.2 RPC `message_update.usage` values are cumulative for the current assistant message.

RPC v1 keeps the latest validated update as one replaceable in-flight snapshot instead of adding successive updates together.

A valid `message_end.message.usage` is authoritative for the finalized assistant message.

When final usage has no valid token or total-cost field, RPC v1 commits the latest valid in-flight snapshot instead.

A new assistant `message_start` commits usage from an interrupted prior attempt before tracking the new cumulative stream.

Timeout finalization commits the interrupted work snapshot before clearing captured output and starting the bounded summary attempt.

Progress and terminal outcomes expose the safe sum of committed usage plus the current in-flight snapshot.

Only non-negative finite values no larger than `Number.MAX_SAFE_INTEGER` enter telemetry, and `totalTokens` is derived from valid components only when no valid reported total exists.

The `turns` field continues to count finalized assistant messages only, so interrupted attempts and tool-result messages do not increment it.

Usage progress contains only normalized token counts, total cost, and finalized-turn count, and never adds raw RPC events, prompts, content, reasoning, credentials, headers, or environment values to the envelope.

## Lifecycle

One retained `agentId` lazily owns at most one RPC child.

The child starts through the exact loaded Pi package with `--mode rpc --no-session --no-extensions`.

A correlated `get_state` response is the readiness handshake.

The task timeout begins only after readiness.

Optional idle, assistant-turn, and tool-call budgets begin with prompt execution and observe only completed assistant messages or tool results as meaningful progress.

The transport subscribes before sending `prompt`.

A successful prompt response means accepted, not completed.

`agent_end` is a low-level run boundary and cannot complete a retained turn.

`agent_settled` is the authoritative completion boundary after retries, compaction, and queued continuations settle.

Abort and timeout send the Pi RPC `abort` command and wait for settlement within a bounded grace period.

After a work, idle, assistant-turn, or tool-call budget stop settles, the transport creates a bounded redacted checkpoint and sends one bounded finalization prompt that requests only a summary of already gathered evidence and explicitly forbids further tool use.

Pi RPC does not currently replace an existing child session's active tool set for one turn, so the finalization deadline and abort path remain authoritative if the model disregards that instruction.

The finalization turn has a separate model-work deadline of at most 45 seconds, followed only by bounded abort and process-cleanup grace, and never replays the timed-out task.

Explicit parent interruption does not start finalization.

A child that does not settle after work or finalization abort is terminated and cannot be reused.

An accepted or ambiguously accepted task is never replayed automatically.

Process exit marks the turn failed or interrupted with bounded partial evidence.

Budget-stopped outcomes keep exit `124` and add a `pi-subagents:termination:v1` report with the stop reason, selected limit, deterministic `pi-subagents:checkpoint:v1`, side-effect warning, and finalization status.

Release, expiry, close, session replacement, reload, and shutdown abort owned work and terminate the process group until captured streams close.

Extension UI requests fail closed in v1.

## Resources and tools

RPC v1 supports Pi built-in tools only.

Child extensions stay disabled to prevent recursive `pi-subagents` loading and duplicate extension side effects.

Custom or extension tools fail before RPC child creation with a subprocess recommendation.

The selected cwd, project-trust decision, role prompt, model, thinking level, context, mailbox input, execution budgets, recursion depth, and output bounds retain their existing owners.

`subagent_spawn.timeoutMs`, `idleTimeoutMs`, `maxTurns`, and `maxToolCalls` are retained as agent defaults, while the same fields on `subagent_send` override only one follow-up turn.

RPC session-file persistence stays disabled because `AgentPersistence` owns sanitized logical recovery records.

A restored record starts no process until an explicit follow-up arrives.

Its first new RPC turn seeds bounded sanitized parent context and logical history exactly once.

## Automatic selection

`stateful.transport: "auto"` selects exactly one transport before child creation.

Read-only built-in tool sets select `in-process` for the lowest startup overhead.

The current built-in `explorer` default uses only `read`, `grep`, `find`, and `ls`, so it remains eligible for this route.

Write-capable built-in tool sets select `rpc` for a persistent separate process.

Extension or custom tools select the existing fresh `subprocess` path.

The selection remains fixed for the retained agent's current runtime lifetime.

A restored inert record is preflighted again on its first explicit follow-up.

No startup or post-acceptance failure triggers automatic fallback.

## Execution defaults

Fast, Balanced, and Deep execution profiles were removed.

The built-in `explorer` defaults to `low` thinking for bounded read-only exploration.

The built-in `worker` inherits model and thinking unless a caller, frontmatter, or per-agent setting selects a value.

Execution defaults do not change tools, transport, completion delivery, parent context, or explicit tool-call limits.

## Measurement

Run `just benchmark-subagents` for serial offline startup and retained state-command measurements.

The benchmark makes no provider request and therefore measures transport overhead rather than model quality or latency.

A provider-backed smoke is optional and must stop after one clear external quota, credential, or entitlement failure.

A seven-sample isolated-agent run on 2026-08-09 recorded 27.728 ms median deterministic fresh subprocess turn overhead with 0.782 ms MAD, 0.073 ms first retained RPC turn with 0.006 ms MAD, 0.037 ms retained RPC follow-up with 0.004 ms MAD, 445.631 ms real Pi RPC readiness with 9.765 ms MAD, 0.893 ms retained real Pi RPC `get_state` with 0.036 ms MAD, 3.759 ms in-process session creation with 0.198 ms MAD, and 0.001 ms retained in-process state access with 0.000 ms MAD.

The deterministic turn measurements use a fake Pi while the readiness and SDK measurements use an isolated real Pi installation without credentials.

The measurement supports retained transports as startup-overhead improvements without claiming provider-turn latency or quality.
