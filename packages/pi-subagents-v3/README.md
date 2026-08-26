# 🧩 Pi Subagents v3 — Bounded Jobs with Main-Agent Messaging

[![npm](https://img.shields.io/npm/v/@narumitw/pi-subagents-v3)](https://www.npmjs.com/package/@narumitw/pi-subagents-v3) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> Pi Subagents v3 is experimental.
> Its tools, job lifecycle, and completion format may change between releases.

Pi Subagents v3 starts bounded background Pi jobs and lets each child ask the main agent necessary questions through an authenticated loopback broker.

A bundled `subagents-v3` skill owns delegation strategy, parallel-work guidance, timeout selection, question handling, result review, and writer safety.

## ✨ Features

- Starts one isolated Pi child process per normal or read-only background job.
- Gives every child fixed `subagent-ask` and `subagent-wait` communication tools.
- Lets the main agent answer a pending child question with `subagent-reply`.
- Interrupts a parent job wait when a question needs a main-agent response without cancelling the job.
- Publishes one guarded asynchronous completion and releases child resources at terminal state.
- Exposes bounded agent and job metadata without leaking task text, output, prompts, or broker credentials.
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

Pi extensions and writable child agents execute with your user permissions.

Review source and agent definitions before installing or invoking them.

## 🚀 Quick start

Ask Pi to use the bundled `subagents-v3` skill when deciding whether to delegate.

Start independent work with `subagent-start`, or start enforced read-only work with `subagent-consult`.

Both tools return a `jobId` immediately.

Continue useful main-agent work until a completion arrives or the result is required.

If `subagent-wait` reports `reason: "subagent_message"`, answer the visible question with `subagent-reply`, then wait for the job again when needed.

## 🛠️ Tools

The main Pi session exposes six fixed tools:

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `subagent-start` | `agent`, `task`, optional `timeout` | Start one normal background job and return its `jobId`. |
| `subagent-inspect` | none | List bounded available-agent and retained-job metadata. |
| `subagent-cancel` | `jobId` | Idempotently cancel one queued or running job. |
| `subagent-wait` | `jobId`, optional `timeout` | Wait for a job or return early for a pending child question. |
| `subagent-consult` | `agent`, `task`, optional `timeout` | Start one enforced read-only background job and return its `jobId`. |
| `subagent-reply` | `requestId`, `message` | Answer one pending child question without replacing an accepted reply. |

Every background child exposes these communication tools in addition to its allowed work tools:

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

`subagent-inspect` never returns complete task text, child output, prompts, context, credentials, environment variables, questions, replies, or secrets.

See [`docs/tools.md`](./docs/tools.md) for the concise schema reference.

## 🤖 Agent definitions

The extension includes `explorer` and `worker` agents.

It also discovers user definitions from `<getAgentDir()>/agents/*.md` and trusted-project definitions from the nearest `.pi/agents/*.md` directory.

Trusted project definitions override same-name user or built-in definitions, and user definitions override same-name built-ins.

A minimal definition is:

```markdown
---
name: reviewer
description: Review code correctness and risks.
tools: read, grep, find, ls
thinkingLevel: low
---

Review the bounded task and cite exact evidence.
```

Optional `model`, `thinkingLevel`, and `tools` frontmatter customize child execution.

Communication tools remain available even when an agent explicitly configures an empty tool list.

Project definitions are ignored until Pi reports the project as trusted.

## 🔄 Messaging, lifecycle, and retention

The session starts one TCP broker on `127.0.0.1` with an operating-system-assigned ephemeral port.

Each job receives one cryptographically random token bound to its job identity, agent, execution mode, and session generation.

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

Normal background jobs use the selected agent's tools and run in the current working directory.

Writable agents can modify the shared working tree and run commands with the Pi process environment and user permissions.

A read-only consultation disables unrelated extensions, shell and write tools, prompt templates, skills, and session persistence in its child.

Read-only tool enforcement is not a filesystem sandbox because the allowed read tools can inspect files available to the user account.

The broker accepts only loopback TCP connections with an active per-job token.

A child question is visible model context, but its envelope explicitly identifies it as untrusted subagent content rather than user authorization.

A child question cannot grant permission for writes, shell commands, credential access, or other privileged actions.

Terminal controls and bidirectional controls are stripped before untrusted child text is displayed.

Tasks, questions, repository context, and inspected file content may be sent to the selected model provider.

Parallel writers require disjoint ownership or workspace isolation outside this extension.

## 🚧 Limitations

The extension does not provide peer-to-peer child messaging, retained conversations, user-directed follow-up work, mailboxes, Agent Teams, chains, fan-in aggregators, panels, workflow DAGs, dynamic scheduling, verification orchestration, nested subagents, or extension-owned semantic memory.

Child questions are bounded request-response coordination, not a retained conversational session.

The main agent must verify worker claims against the actual diff and deterministic checks.

Questions trigger a main-agent turn, but asynchronous job completions do not wake an otherwise idle model turn automatically.

Jobs, broker requests, and retained results do not survive extension reload, session replacement, or process exit.

## 🗂️ Package layout

```text
packages/pi-subagents-v3/
├── docs/                        # Concise tools and parameters reference
├── src/                         # Extension, broker, child bridge, and subprocess runtime
├── skills/subagents-v3/        # Delegation and messaging operating manual
├── test/                        # Protocol, lifecycle, process, and policy tests
├── package.json                 # Pi extension and skill declarations
└── README.md                    # User guide and safety boundaries
```

## 🔎 Keywords

Pi, subagents, agents, delegation, background jobs, read-only consultation, main-agent messaging, cancellation, bounded execution.

## 📄 License

[MIT](./LICENSE)
