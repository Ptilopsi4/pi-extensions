# Bounded runtime migration

This major migration replaces retained agents with current-session bounded jobs.

The package does not migrate or delete legacy files because leaving them untouched preserves downgrade recovery.

## Public migration table

| Previous route or field | New behavior or replacement |
| --- | --- |
| `subagent_spawn.agent` | Put the specialization and expected evidence directly in the self-contained `task`. |
| `subagent_spawn.taskName` | Removed; use the opaque returned `jobId`. |
| `subagent_spawn.timeoutMs` | Use `subagent_spawn.timeout` in seconds. |
| `subagent_spawn.idleTimeoutMs` | Removed; use one overall execution `timeout` when a deadline is required. |
| `subagent_spawn.maxTurns` | Removed; bound the task and optional execution timeout. |
| `subagent_spawn.maxToolCalls` | Removed; grant only the required `tools` and bound the task. |
| `subagent_spawn.cwd` | Removed; the child always uses the current main-session working directory. |
| `subagent_spawn.agentScope` | Removed with custom agent discovery. |
| `subagent_spawn.confirmProjectAgents` | Removed with project-local agent discovery. |
| `subagent_spawn.context` | Removed; write a self-contained task without parent conversation history. |
| `subagent_spawn.contextEntryIds` | Removed; include only necessary bounded facts in the task. |
| `subagent_spawn.parentId` | Removed; keep dependency and ownership coordination in the main agent. |
| `subagent_spawn.workspaceMode` | Removed; prepare any worktree or isolation outside this extension before spawning. |
| `subagent_spawn.idempotencyKey` | Removed; the main agent owns retry decisions and duplicate-side-effect avoidance. |
| `subagent_spawn.resultFormat` | Removed; request the desired text structure in the task and verify it in the main agent. |
| `subagent_spawn.completionRequirement` | Removed; use `subagent_await` when the result is required before the next action. |
| `subagent_spawn.contract` | Removed; express constraints in the task and enforce consequential acceptance in the main agent. |
| `subagent_spawn.allowConcurrentWrites` | Removed; grant write tools only with externally coordinated disjoint ownership. |
| `subagent_send` with `agentId`, `task`, `timeoutMs`, `idleTimeoutMs`, `maxTurns`, `maxToolCalls`, `completionRequirement`, `revalidate`, and `allowConcurrentWrites` | Removed; start a new self-contained `subagent_spawn` job because conversations are not retained. |
| `subagent_await.agentId` | Use `subagent_await.jobId`. |
| `subagent_await.timeoutMs` | Use `subagent_await.timeout` in seconds with no default. |
| `subagent_manage` with `action`, `agentId`, and `subtree` | Removed; use `subagent_cancel` for one current-session job and keep hierarchy in the main agent. |
| `subagent_mailbox` send with `action`, `agentId`, `message`, `senderId`, and `deduplicationKey` | Removed; coordinate through the main agent and start a new job when more work is needed. |
| `subagent_mailbox` read with `action`, `agentId`, `acknowledge`, and `limit` | Removed; no mailbox state exists. |
| `subagent_inspect.action` values `list_agents`, `get_agent`, `list_runs`, `get_run`, `list_models`, `preview_context`, `status`, and `diagnose` | Removed; parameterless inspection now returns current-session job summaries only. |
| `subagent_inspect.agent`, `agentId`, `agentScope`, `includeClosed`, `limit`, `context`, and `contextEntryIds` | Removed because catalogs, retained runs, model listings, and parent-context previews are unsupported. |
| Child `subagent_peer_send` with `target`, `message`, and `deduplicationKey` | Removed; children have no peer or parent communication channel. |
| Child `subagent_peer_list` | Removed; children have no retained peer hierarchy. |
| `/subagents settings` | Removed; the bounded runtime has no extension-owned settings. |
| Bare `/subagents` manager UI | Replaced by privacy-bounded current-session status. |
| `stateful.enabled`, `stateful.transport`, completion-delivery policy, detached limits, cwd policy, custom-agent overrides, and usage-recording settings | Ignored and left untouched; use the fixed bounded contract or downgrade to the previous major. |
| Retained `agentId` values and canonical task paths | Invalid in the bounded runtime; use only the current-session `jobId` returned by a new spawn. |
| Agent catalogs and built-in `explorer` or `worker` names | Removed; encode specialization in `task` and authority in `tools`. |
| Required-completion and structured delegation/result contracts | Removed; join explicitly and perform validation in the main agent. |
| Subprocess, in-process, RPC, and automatic transport settings | Removed; every job uses one fresh Pi subprocess. |

## Recommended replacement flow

1. Turn each independent retained turn into one self-contained `subagent_spawn` call.
2. Select the smallest core-tool set that can complete the task.
3. Continue useful non-overlapping work in the main agent.
4. Use `subagent_await` only when the exact result is required.
5. Use `subagent_cancel` when active work is no longer needed.
6. Keep all dependency ordering, writer ownership, fan-in, review, and final verification in the main agent.

## Recovery

Legacy `pi-subagents.json` and retained-state files are neither read nor changed.

Downgrading to the previous package major can therefore recover its prior file formats, subject to that version's normal compatibility rules.

Do not expect current-session bounded job IDs or results to survive reload or downgrade.
