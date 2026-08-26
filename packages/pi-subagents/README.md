# 🧑‍🤝‍🧑 pi-subagents — Retained Background Agents for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-subagents)](https://www.npmjs.com/package/@narumitw/pi-subagents) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Delegate bounded work to retained background agents while the main Pi agent continues useful work and owns integration, verification, and the final answer.

Use the built-in `explorer` for read-only repository evidence and `worker` for a clearly owned implementation slice.

## ✨ Features

- Starts retained background agents and returns immediately with an opaque `agentId` and canonical `taskPath`.
- Delivers bounded completion messages automatically and provides an intentional `subagent_await` join.
- Keeps completed agents available for follow-up turns through `subagent_send`.
- Supports queue-only mailbox messages, parent-child ownership, subtree interruption, and explicit close.
- Includes metadata-only inspection for agents, retained runs, models, context previews, runtime status, and diagnostics.
- Supports subprocess, in-process, RPC, and deterministic automatic transport selection.
- Applies trust-aware launch directories, optional disposable Git worktrees, bounded context, deadlines, turn limits, and tool-call limits.
- Persists sanitized retained state without automatically restarting interrupted work after reload.
- Detects changed semantic resources before a follow-up and requires explicit revalidation when needed.
- Optionally records content-free local lifecycle and timing events.
- Loads a generated split runtime while keeping transport, manager, and inspection implementations lazy.

## 📦 Install

```bash
pi install npm:@narumitw/pi-subagents
```

Try without installing permanently:

```bash
pi -e npm:@narumitw/pi-subagents
```

Build and try this package locally from the repository root:

```bash
npm --workspace @narumitw/pi-subagents run build
pi -e ./packages/pi-subagents
```

The published package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.

## 🚀 Quick start

Start one read-only background agent:

```json
{
  "agent": "explorer",
  "taskName": "auth_inventory",
  "task": "Inspect the authentication implementation and tests. Do not edit files. Return concise findings with exact paths and open questions."
}
```

`subagent_spawn` returns immediately.

Continue concrete non-overlapping main-agent work instead of polling or duplicating the delegated task.

When the result is required and useful overlapping work is complete, join it intentionally:

```json
{
  "agentId": "/root/auth_inventory",
  "timeoutMs": 30000
}
```

Use `subagent_send` for a later follow-up on the same retained conversation:

```json
{
  "agentId": "/root/auth_inventory",
  "task": "Recheck the updated implementation and report remaining risks."
}
```

## 🛠️ Tools

Enabled retained delegation registers exactly six tools:

| Tool | Purpose |
| --- | --- |
| `subagent_spawn` | Start one retained background agent and return immediately. |
| `subagent_send` | Start a follow-up turn on one retained agent. |
| `subagent_await` | Intentionally wait for one retained turn without cancelling it on wait timeout. |
| `subagent_manage` | Interrupt active work or close retained agents and release resources. |
| `subagent_mailbox` | Queue a message without starting a turn, or read unread messages. |
| `subagent_inspect` | Read bounded metadata, context previews, status, and diagnostics without changing state. |

When retained delegation is disabled, only `subagent_inspect` is registered.

See [`docs/tools.md`](./docs/tools.md) for the complete schema reference.

### Choose the lifecycle

| Need | Use |
| --- | --- |
| Simple, tightly coupled, or immediate critical-path work | Keep it in the main agent. |
| Bounded evidence that can run beside useful parent work | Spawn `explorer`. |
| Bounded implementation with disjoint ownership | Spawn `worker`. |
| Several independent tasks | Issue one spawn per task and keep coordination in the main agent. |
| A retained result is now required | Use `subagent_await` after useful overlap is complete. |
| Continue one agent's prior work | Use `subagent_send`. |
| Queue information without starting a turn | Use `subagent_mailbox`. |
| Stop current work but keep the agent reusable | Use `subagent_manage` with `interrupt`. |
| Release an agent and its owned resources | Use `subagent_manage` with `close`. |
| Inspect state without side effects | Use `subagent_inspect`. |

The main agent owns planning, fan-out, fan-in, sequencing, review, deterministic checks, integration, and the final answer.

### Completion delivery

`stateful.completionDelivery` controls terminal completion delivery.

- `next-turn` is the default and queues completion for the next parent turn without waking an idle root.
- `auto-resume` steers completion into active parent work or requests one synthesis turn when the root is idle and has no pending input.

Set `completionRequirement: "required"` on a spawn or follow-up whose exact result is needed for the final answer.

Required state is tracked until that exact completion becomes visible or reaches an explicit terminal state.

Current Pi versions do not provide an extension-owned hard barrier that can retract already displayed output.

`subagent_await` remains the explicit blocking join when the next action must not proceed without the retained result.

Its `timeoutMs` defaults to 30 seconds and limits only the wait.

A wait timeout or caller cancellation never interrupts or closes the child.

### Retained conversations

A retained agent keeps one logical identity, selected agent definition, cwd, thinking level, default budgets, bounded history, and follow-up generation state.

The default subprocess transport may start a fresh child process for each turn and seed it with bounded sanitized history.

In-process and RPC transports can retain a native child session while the runtime remains active.

Restored records are inert and never restart interrupted work automatically.

A follow-up rechecks the current agent definition, target trust, selected resources, contract, and execution plan.

If those semantics changed, `subagent_send` rejects until the caller reviews the differences and retries with `revalidate: true`.

### Context selection

`subagent_spawn.context` accepts:

- `none` for no parent conversation, which is the default.
- `all` for bounded user and assistant text from the active branch.
- `summary` for an earlier checkpoint plus recent messages.
- A positive number for the most recent N user turns and related assistant text.

`contextEntryIds` selects exact session entries.

Supplying IDs without `context` implies `all`, while explicit `context: "none"` still disables parent context.

Reasoning, tool results, transport messages, and non-text parts are excluded.

Use `subagent_inspect` with `action: "preview_context"` to inspect counts and truncation without returning context text.

### Result formats and advanced contracts

`resultFormat` accepts `text`, `structured-v1`, or `structured-v2`.

Use text for ordinary work.

Use structured formats only when a caller needs typed claims, artifacts, changes, verification, limitations, or unresolved dependencies.

The optional `pi-subagents:delegation:v2` contract remains available for retained work that requires explicit acceptance, authority, evidence, or admission metadata.

Omit the contract for ordinary delegation.

Capability and tool requests can be validated and narrowed.

Enforced path, network, and secret guarantees are unsupported and reject before launch.

## 💬 Commands

- `/subagents` opens the current-session manager in TUI mode and reports bounded status in RPC mode.
- `/subagents settings` opens the grouped settings hub.
- `/subagents status` shows current-session and configured diagnostics with their sources.
- `/subagents help` explains retained delegation, settings behavior, commands, and safety limits.

Print and JSON modes do not emit ad hoc command output.

## ⚙️ Settings

Settings are stored in `~/.pi/agent/pi-subagents.json`.

A missing file keeps defaults and creates nothing until an explicit save.

Use `/subagents settings` for **Folders and trust**, **Completion and privacy**, **Agent defaults**, and **Advanced runtime settings**.

Representative settings:

```json
{
  "stateful": {
    "enabled": true,
    "transport": "auto",
    "completionDelivery": "auto-resume",
    "maxAgents": 16,
    "maxActiveTurns": 4,
    "maxDepth": 3,
    "maxChildrenPerAgent": 8,
    "maxStoredAgents": 50
  },
  "cwdPolicy": {
    "delegation": "trusted-targets"
  },
  "usageRecording": {
    "enabled": false
  }
}
```

`stateful.enabled` defaults to `true`.

Set it to `false` and reload to expose inspection only.

The default transport is `subprocess`.

`auto` selects in-process for read-only built-in tools, RPC for write-capable built-in tools, and subprocess for extension or custom tools.

Transport changes require `/reload` or a Pi process restart.

Capacity changes apply on the next Pi session start or after `/reload`.

Completion, cwd policy, agent defaults, and usage recording apply to subsequent work as documented by their settings screens.

Settings saves preserve unknown fields and ignored legacy fields.

Malformed or invalid settings block writes instead of being overwritten.

Supported writers serialize updates and publish through a same-directory temporary file plus rename.

## 🔐 Working-directory trust policy

`cwdPolicy.delegation` accepts:

| Value | Behavior |
| --- | --- |
| `trusted-targets` | Allow the current workspace or an external folder covered by a saved trusted decision. |
| `current-workspace` | Reject canonical targets outside the current workspace. |
| `anywhere` | Allow any existing directory Pi can access. |

Paths resolve relative to the current workspace and are canonicalized before containment and trust checks.

The nearest saved Pi trust decision wins for an external target.

Use Pi `/trust` in the target folder, then restart Pi before expecting retained-runtime trust behavior to change.

These controls govern launch directories and protected project resources.

They are not filesystem, process, network, credential, or operating-system sandboxes.

### Workspace modes

`workspaceMode: "shared"` is the default.

Shared-workspace writers may run concurrently, so assign disjoint file or responsibility ownership.

`workspaceMode: "worktree"` creates a disposable Git worktree from a clean repository and removes it when the agent closes or the session shuts down.

Worktrees isolate repository writes but not processes, network access, secrets, credentials, absolute paths, or the rest of the filesystem.

## 🤖 Built-in and custom agents

The built-in catalog contains:

| Agent | Purpose | Default tools |
| --- | --- | --- |
| `explorer` | Read-only repository exploration with concise path evidence. | `read`, `grep`, `find`, `ls` |
| `worker` | Bounded implementation and command execution with clear ownership. | Pi default tools |

User agents load from `~/.pi/agent/agents`.

Trusted project agents load from `<workspace>/.pi/agents` only when the caller explicitly selects `agentScope: "project"` or `"both"`.

Project-local agents require project trust and confirmation by default.

Per-agent settings can override tools, model, thinking level, and timeout without replacing unrelated fields.

## 📊 Local usage recording

Local usage recording is disabled by default and creates no usage storage until explicitly enabled.

Records are private per-runtime JSONL files below `<pi-agent-directory>/pi-subagents-usage/`.

The recorder stores content-free lifecycle, surface, outcome, usage, and monotonic timing metadata.

It does not store prompts, tasks, responses, thinking, tool arguments or results, code, paths, commands, mailbox content, raw errors, provider identity, credentials, or Pi session identifiers.

Validated writer files older than the retention window are removed after recording starts.

Disabling recording stops new events immediately and leaves existing files to expire or be removed manually while Pi is stopped.

## 🔄 Migration from synchronous tools

The blocking `subagent` and synchronous `subagent_consult` routes were removed in this breaking release.

Use `subagent_spawn` with `explorer` for read-only evidence and call `subagent_await` only when that result is required before the next action.

An explorer spawn has read-only configured tools but does not reproduce the removed consultation route's stricter resource-loading contract.

Express parallel work as multiple independent spawns.

Keep sequencing and fan-in synthesis in the main agent.

Use main-agent review skills and deterministic checks instead of extension-owned panels or managed verification workflows.

Start a fresh conversation when a resumed transcript repeatedly requests a removed tool name.

Pin the previous package major when an established integration still requires a removed route.

Legacy `blocking`, `consult`, and `cwdPolicy.consultation` fields are ignored but preserved by unrelated settings writes for rollback compatibility.

Historical persisted blocking-workflow files are left untouched and are no longer exposed through `subagent_inspect`.

## 🔒 Security and privacy

Subagents run with the Pi process user's permissions.

Read-only tool selection is a capability restriction, not a filesystem or confidentiality sandbox.

Shell, PowerShell, edit, write, custom, and extension tools may mutate files or access the network according to their own behavior.

Project and user agent definitions are trusted code or instructions and should be reviewed before use.

Model IDs, paths, tasks, results, and mailbox text are treated as untrusted terminal input and sanitized at display boundaries.

Private-tagged text is removed before bounded context, history, or mailbox persistence.

For real isolation, run Pi in a container, VM, micro-VM, or OS sandbox with only required paths and credentials mounted.

## 🗂️ Package layout

```text
packages/pi-subagents/
├── docs/                    # Tool, protocol, diagram, and implementation references
├── scripts/                 # Generated split-runtime build
├── src/
│   ├── agents/              # Built-in definitions, discovery, catalog, and settings types
│   ├── execution/           # Retained runtime admission and depth policy
│   ├── settings/            # Validation and effective setting snapshots
│   ├── stateful-*.ts        # Retained tool registration, guidance, limits, and rendering
│   ├── registry*.ts         # Retained identity, history, mailbox, and lifecycle state
│   ├── *-transport.ts       # Subprocess, in-process, RPC, and automatic transports
│   ├── completion-*.ts      # Delivery, requirement tracking, routing, and rendering
│   ├── config-*.ts          # `/subagents` manager, settings, status, and help
│   ├── inspect*.ts          # Side-effect-free metadata inspection
│   └── index.ts             # Thin extension entrypoint
├── test/                    # Active retained-runtime and package tests
├── package.json             # Package metadata and generated entrypoint
└── README.md                # User guide and safety boundaries
```

## 🔎 Keywords

Pi, subagents, retained agents, background jobs, delegation, asynchronous execution, agent tools, automation.

## 📄 License

[MIT](./LICENSE)
