# 🧩 Pi Subagents v3 — Bounded Jobs with Main-Agent Messaging

[![npm](https://img.shields.io/npm/v/@narumitw/pi-subagents-v3)](https://www.npmjs.com/package/@narumitw/pi-subagents-v3) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> Pi Subagents v3 is experimental.
> Its tools, job lifecycle, and completion format may change between releases.

Pi Subagents v3 starts bounded background Pi jobs and lets each child ask the main agent necessary questions through an authenticated loopback broker.

A bundled `subagents` skill owns delegation strategy, least-privilege tool selection, parallel-work guidance, timeout selection, question handling, result review, and writer safety.

## ✨ Features

- Starts one isolated Pi child process per background job.
- Lets each task define the child's specialization and each tool list define its capabilities.
- Defaults child work tools to `read`, `grep`, `find`, and `ls`.
- Inherits the main agent's effective model and defaults to its thinking level.
- Gives every child fixed `subagent-ask` and `subagent-wait` communication tools.
- Lets the main agent answer a pending child question with `subagent-reply`.
- Interrupts a parent job wait when a question needs a main-agent response without cancelling the job.
- Publishes one guarded asynchronous completion and releases child resources at terminal state.
- Shows each active job's state, elapsed time, timeout, and selected work tools above the editor.
- Exposes bounded job metadata without leaking task text, output, prompts, selected tools, or broker credentials.
- Cancels active session-owned work and closes the loopback broker during replacement, reload, or shutdown.

## 📦 Install

Install persistently after the package is published:

```bash
pi install npm:@narumitw/pi-subagents-v3
```

Try from npm without installing permanently:

```bash
pi -e npm:@narumitw/pi-subagents-v3
```

Try the extension and bundled skill from a local checkout:

```bash
pi --no-extensions -e ./packages/pi-subagents-v3
```

The package uses its source entrypoint and does not require a build before local loading.

Pi extensions and children with `bash`, `powershell`, `edit`, or `write` execute with your user permissions.

Review the source before installing or invoking the extension.

## 🚀 Quick start

Ask Pi to use the bundled `subagents` skill when deciding whether to delegate.

Start one bounded background job with `subagent-spawn`.

The tool returns a `jobId` immediately.

Continue useful main-agent work until a completion arrives or the result is required.

If `subagent-wait` reports `reason: "subagent_message"`, answer the visible question with `subagent-reply`, then wait for the job again when needed.

In TUI mode, an above-editor widget shows one compact line for each queued or running job.

Each line includes the job ID, current state, elapsed execution time, configured timeout or `no timeout`, and selected work tools.

The fixed `subagent-ask` and child `subagent-wait` communication tools are omitted from the widget because every child receives them.

The widget disappears when no jobs remain active and is cleared during session replacement, reload, or shutdown.

## 🛠️ Tools

The main Pi session exposes five fixed tools:

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `subagent-spawn` | `task`, optional `tools`, `thinkingLevel`, `timeout` | Start one background job and return its `jobId`. |
| `subagent-inspect` | none | List bounded retained-job metadata. |
| `subagent-cancel` | `jobId` | Idempotently cancel one queued or running job. |
| `subagent-wait` | `jobId`, optional `timeout` | Wait for a job or return early for a pending child question. |
| `subagent-reply` | `requestId`, `message` | Answer one pending child question without replacing an accepted reply. |

Every background child exposes these communication tools in addition to its selected work tools:

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `subagent-ask` | `message` | Send one question to the main agent and return a `requestId`. |
| `subagent-wait` | `requestId`, optional `timeout` | Wait for the main agent's plain-text reply. |

Execution and wait timeouts use seconds, accept finite numbers greater than zero through 2,147,483.647, and have no default.

Omitting a job execution timeout lets the child run until it exits, is cancelled, the session shuts down, or the Pi process exits.

A wait timeout or caller cancellation stops only that wait and does not cancel its job or question request.

Tasks, questions, and replies are limited to 50 KiB of UTF-8 text.

Replies are also limited to 2,000 lines so successful child tool output stays within Pi's tool-result bound.

Each job may have up to four unanswered or not-yet-consumed question requests.

The terminal states are `completed`, `partial`, `failed`, `timed_out`, and `cancelled`.

`subagent-inspect` never returns complete task text, child output, prompts, selected tools, context, credentials, environment variables, questions, replies, or secrets.

See [`docs/tools.md`](./docs/tools.md) for the concise schema reference.

## ⚙️ Job configuration

The task defines the child's role, objective, scope, constraints, and expected result.

The optional `tools` list defines what the child can do.

Accepted names are `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`.

Unavailable or extension-only tool names are rejected before a job is queued.

Omitting `tools` selects `read`, `grep`, `find`, and `ls`.

Passing an empty list gives the child no work tools.

The runtime always adds `subagent-ask` and child `subagent-wait` and removes duplicate names.

Adding `edit` or `write` lets the child modify files.

Adding `bash` or `powershell` grants unrestricted command execution and can also modify the workspace.

The optional `thinkingLevel` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

Omitting `thinkingLevel` captures the main agent's effective level when `subagent-spawn` executes.

The child inherits the main agent's effective provider and model when `subagent-spawn` executes.

Spawn rejects providers registered by a parent extension because children disable unrelated extensions.

Spawn also rejects process-local runtime API keys such as a parent-only `--api-key` value.

Use stored or environment credentials that child processes can read.

The extension does not expose a per-job model override.

## 🔄 Messaging, lifecycle, and retention

The session starts one TCP broker on `127.0.0.1` with an operating-system-assigned ephemeral port.

Each job receives one cryptographically random token bound to its job identity and session generation.

The child bridge captures and deletes the broker environment variables before model tool execution.

Each tool call uses one bounded request-scoped connection, while a child response wait uses an abortable long poll.

The first accepted `subagent-reply` wins, and repeated replies acknowledge the existing answer without replacing it.

A child may retry `subagent-wait` after a wait timeout because the underlying request remains active.

A new job starts as `queued`, transitions to `running`, and reaches exactly one terminal state.

The runtime retains up to 32 recent terminal records for up to 24 hours within the current extension session.

Inspection reports older records removed by retention bounds through `omitted.jobs`.

Cancelling or terminalizing a job revokes its token and rejects pending child waits before stale output can replace the terminal state.

Session replacement and shutdown cancel active work, suppress stale completion delivery, revoke credentials, close sockets, and stop the broker.

## 🔒 Security and privacy

The selected work tools run in the current working directory.

The default list is read-only by capability because it contains no shell or file-mutation tool.

This default is not a filesystem sandbox because the allowed read tools can inspect files available to the user account.

Selecting `bash`, `powershell`, `edit`, or `write` permits workspace mutation with the Pi process environment and user permissions.

Every child disables session persistence, unrelated extensions, skills, and prompt templates.

Provider selection therefore supports Pi's child-visible built-in and configured providers, not providers registered only by a parent extension.

Credentials must be available independently to the child through Pi's stored credentials or its inherited environment.

The broker accepts only loopback TCP connections with an active per-job token.

A child question is visible model context, but its envelope explicitly identifies it as untrusted subagent content rather than user authorization.

A child question cannot grant permission for writes, shell commands, credential access, or other privileged actions.

Terminal controls and bidirectional controls are stripped before untrusted child text is displayed.

Tasks, repository context, questions, and inspected file content may be sent to the selected model provider.

Parallel writers require disjoint ownership or workspace isolation outside this extension.

## 🚧 Limitations

The extension does not load arbitrary extension tools or parent-registered model providers into child processes.

Process-local runtime API keys are not forwarded to children.

The extension does not provide custom agents, per-job models, custom system prompts, peer-to-peer child messaging, retained conversations, user-directed follow-up work, mailboxes, Agent Teams, chains, fan-in aggregators, panels, workflow DAGs, dynamic scheduling, verification orchestration, nested subagents, or extension-owned semantic memory.

Child questions are bounded request-response coordination, not a retained conversational session.

The main agent must verify child claims against the actual diff and deterministic checks.

Questions trigger a main-agent turn, but asynchronous job completions do not wake an otherwise idle model turn automatically.

Jobs, broker requests, and retained results do not survive extension reload, session replacement, or process exit.

## 🗂️ Package layout

```text
packages/pi-subagents-v3/
├── docs/                        # Concise tools and design references
├── src/                         # Extension, broker, child bridge, and subprocess runtime
├── skills/subagents/           # Delegation and messaging operating manual
├── test/                        # Protocol, lifecycle, process, and policy tests
├── package.json                 # Pi extension and skill declarations
└── README.md                    # User guide and safety boundaries
```

## 🔎 Keywords

Pi, subagents, delegation, background jobs, least privilege, main-agent messaging, cancellation, bounded execution.

## 📄 License

[MIT](./LICENSE)
