# Pi Subagents tools

`pi-subagents` exposes six retained-agent tools when delegation is enabled.

When `stateful.enabled` is `false`, only `subagent_inspect` is registered after reload.

Model-facing tool content is bounded to 50 KiB or 2,000 lines.

## `subagent_spawn`

Starts reusable background work and returns an opaque `agentId` plus canonical `taskPath` immediately.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agent` | `string` | Yes | Agent name from the active catalog. |
| `task` | `string` | Yes | Self-contained task, 1 through 50 KiB. |
| `taskName` | `string` | No | Canonical path segment, 1 through 128 lowercase letters, digits, or underscores. |
| `thinkingLevel` | `string` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; retained for follow-ups. |
| `timeoutMs` | `integer` | No | Work deadline in milliseconds; 1 through 2,147,483,647; retained for follow-ups. |
| `idleTimeoutMs` | `integer` | No | Idle deadline in milliseconds; 1 through 2,147,483,647; retained for follow-ups. |
| `maxTurns` | `integer` | No | Maximum unfinished assistant turns; 1 through 1,000,000; retained for follow-ups. |
| `maxToolCalls` | `integer` | No | Maximum tool calls; 1 through 1,000,000; retained for follow-ups. |
| `cwd` | `string` | No | Launch directory, subject to the configured delegation cwd policy. |
| `agentScope` | `string` | No | `user`, `project`, or `both`; defaults to `user` and is retained. |
| `confirmProjectAgents` | `boolean` | No | Prompt before running project-local agents; defaults to `true`. |
| `context` | `string \| number` | No | `none`, `all`, `summary`, or a positive recent-user-turn count; defaults to `none`. |
| `contextEntryIds` | `string[]` | No | Exact session entry IDs; supplying IDs without `context` implies `all`. |
| `parentId` | `string` | No | Parent agent ID or canonical task path for nested ownership. |
| `workspaceMode` | `string` | No | `shared` or `worktree`; defaults to `shared`. |
| `idempotencyKey` | `string` | No | 1 through 256 characters; an exact accepted retry returns the existing retained agent. |
| `resultFormat` | `string` | No | `text`, `structured-v1`, or `structured-v2`; defaults to `text`. |
| `completionRequirement` | `string` | No | `background` or `required`; defaults to `background`. |
| `contract` | `object` | No | Advanced `pi-subagents:delegation:v2` contract; omit for ordinary delegation. |
| `allowConcurrentWrites` | `boolean` | No | Deprecated compatibility no-op; shared-workspace concurrency is already allowed. |

An omitted `taskName` receives a deterministic privacy-safe path segment.

The reserved segment `root` is rejected, as are dots, slashes, empty values, and names longer than 128 characters.

Project-local agents require explicit `agentScope: "project"` or `"both"`, a trusted project, and confirmation by default.

A worktree spawn requires a clean Git repository and cannot use a project-local agent definition.

`completionRequirement: "required"` tracks the exact run until completion becomes visible or terminal, but it is not a hard pre-display final-answer barrier.

Completion delivery follows the configured `next-turn` or `auto-resume` policy.

Do not poll after spawning; continue useful non-overlapping parent work and consume the delivered completion.

Throws before acceptance for invalid policy, capacity, trust, agent, contract, idempotency, or workspace requests.

## `subagent_send`

Starts a new background follow-up turn on one retained agent.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agentId` | `string` | Yes | Retained agent ID or canonical task path. |
| `task` | `string` | Yes | Follow-up task, 1 through 50 KiB. |
| `timeoutMs` | `integer` | No | One-turn work deadline; 1 through 2,147,483,647; otherwise uses the retained default. |
| `idleTimeoutMs` | `integer` | No | One-turn idle deadline; 1 through 2,147,483,647; otherwise uses the retained default. |
| `maxTurns` | `integer` | No | One-turn assistant-turn limit; 1 through 1,000,000; otherwise uses the retained default. |
| `maxToolCalls` | `integer` | No | One-turn tool-call limit; 1 through 1,000,000; otherwise uses the retained default. |
| `completionRequirement` | `string` | No | `background` or `required`; defaults to `background` for this turn. |
| `revalidate` | `boolean` | No | Set to `true` after reviewing reported semantic resource changes. |
| `allowConcurrentWrites` | `boolean` | No | Deprecated compatibility no-op. |

This tool cannot change the retained thinking level or result format.

Use `subagent_mailbox` when a message must not start a turn.

Throws when the retained record is unavailable, busy, closed, stale without revalidation, or no longer allowed by current policy.

## `subagent_await`

Intentionally joins one retained turn.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agentId` | `string` | Yes | Retained agent ID or canonical task path. |
| `timeoutMs` | `integer` | No | Wait deadline in milliseconds; 1 through 2,147,483,647; defaults to 30,000. |

Blocks the main Pi agent until the retained turn settles or the wait deadline expires.

A timeout or caller cancellation stops only the wait and never interrupts or closes the child.

Automatic at-least-once completion delivery remains active, so the same completion may arrive later.

Use this tool only when the result is required before the next action and useful overlapping parent work is complete.

## `subagent_manage`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `action` | `string` | Yes | `interrupt` or `close`. |
| `agentId` | `string` | Yes | Retained agent ID or canonical task path. |
| `subtree` | `boolean` | No | Apply child-first to the target and all descendants; defaults to `false`. |

`interrupt` aborts active work but keeps the agent reusable.

`close` releases the retained record and its owned resources, including a disposable worktree when present.

Use `subagent_inspect` for list and detail operations.

## `subagent_mailbox`

### Send

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `action` | `string` | Yes | `send`. |
| `agentId` | `string` | Yes | Recipient agent ID or canonical task path. |
| `message` | `string` | Yes | Non-empty queue-only message, up to 16,384 characters. |
| `senderId` | `string` | No | Sender agent ID or canonical task path. |
| `deduplicationKey` | `string` | No | Idempotency key, up to 256 characters. |

Sending queues a durable message and never starts an idle agent turn.

### Read

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `action` | `string` | Yes | `read`. |
| `agentId` | `string` | Yes | Mailbox owner agent ID or canonical task path. |
| `acknowledge` | `boolean` | No | Mark returned messages as acknowledged; defaults to `true`. |
| `limit` | `number` | No | Maximum returned messages, 1 through 20; defaults to 20. |

The action-specific schema rejects fields belonging to the other action.

Use `subagent_inspect` for metadata-only unread counts that do not acknowledge messages.

## `subagent_inspect`

Always registered, including when retained delegation is disabled.

| Action | Parameters | Result |
| --- | --- | --- |
| `list_agents` | Optional `agentScope` and `limit` | Bounded agent metadata and omission counts. |
| `get_agent` | Required `agent`; optional `agentScope` | One resolved definition, source, capabilities, and tools without its system prompt. |
| `list_runs` | Optional `includeClosed` and `limit` | Metadata-only retained-run summaries. |
| `get_run` | Required `agentId` | Bounded retained-run policy, lifecycle, context, result, timing, usage, and mailbox metadata. |
| `list_models` | Optional `limit` | Session-scoped or already-loaded available model metadata. |
| `preview_context` | Optional `context` and `contextEntryIds` | Context mode, selected user turns, source count, UTF-8 bytes, and truncation without context text. |
| `status` | No additional fields | Effective runtime, limits, delivery, recording, target policy, and setting sources. |
| `diagnose` | No additional fields | Structured `pass`, `warning`, and `fail` checks. |

`agentScope` accepts `user`, `project`, or `both` and defaults to `user`.

Project scopes require an already trusted project.

`list_agents` defaults to 32 items.

`list_runs` and `list_models` default to 50 items.

Every list limit must be an integer from 1 through 100.

`includeClosed` defaults to `false`.

`preview_context.context` accepts `none`, `all`, `summary`, or a positive recent-user-turn count and defaults to `none`.

Supplying `contextEntryIds` without `context` implies `all`.

The flat action schema rejects parameters that do not belong to the selected action.

Inspection never launches children, changes lifecycle state, sends or acknowledges messages, changes settings, or modifies files.

Diagnostic failures are returned as report data rather than tool errors.

## Retained-child tools

Retained child sessions receive two package-owned peer tools in addition to their selected work tools.

### `subagent_peer_send`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `target` | `string` | Yes | `/root`, an absolute canonical task path, or a relative peer path; 1 through 2,048 characters. |
| `message` | `string` | Yes | Queue-only message, 1 through 16,384 characters. |
| `deduplicationKey` | `string` | No | Idempotency key, 1 through 256 characters. |

The runtime binds the authenticated sender identity, so the child cannot provide a sender field.

Sending never starts an idle recipient turn.

### `subagent_peer_list`

No parameters.

Returns bounded identity and lifecycle metadata for `/root` and retained peers in the current session.

## Removed synchronous routes

The former blocking execution and synchronous consultation tools are not registered.

Use one retained spawn per independent task and keep orchestration in the main agent.

Use `explorer` for read-only configured tools, but do not treat that as the former consultation route's stricter resource-loading contract.
