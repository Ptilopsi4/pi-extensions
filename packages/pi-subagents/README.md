# 🧑‍🤝‍🧑 pi-subagents — Bounded Background Jobs for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-subagents)](https://www.npmjs.com/package/@narumitw/pi-subagents) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Delegate self-contained work to fresh background Pi subprocesses while the main agent keeps ownership of planning, coordination, verification, and the final answer.

Each job exists only in the current session and has no retained conversation, mailbox, or access to the parent transcript.

## ✨ Features

- Starts one isolated Pi subprocess per accepted job and returns an opaque current-session `jobId` immediately.
- Registers four fixed tools for spawn, await, cancellation, and privacy-bounded inspection.
- Defaults children to the read-only `read`, `grep`, `find`, and `ls` tools.
- Supports explicit write-capable tool selection or an explicit empty tool set.
- Inherits the main session's model, provider, thinking level, working directory, and project-trust decision.
- Bounds active jobs to eight and retained terminal summaries to thirty-two.
- Delivers each terminal completion at most once without waking an idle main agent.
- Cancels owned jobs and releases UI resources on session replacement, reload, and shutdown.
- Reads and writes no `pi-subagents` settings or retained-state files.

## 📦 Install

```bash
pi install npm:@narumitw/pi-subagents
```

Try the extension without installing it permanently:

```bash
pi -e npm:@narumitw/pi-subagents
```

Extensions run with the same operating-system permissions as Pi, and selected child tools can read or modify anything those permissions allow.

Build and try this package locally from the repository root:

```bash
npm --workspace @narumitw/pi-subagents run build
pi -e ./packages/pi-subagents
```

The published package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.

## 🚀 Quick start

Start one read-only background job with `subagent_spawn`:

```json
{
  "task": "Inspect the authentication implementation and tests. Do not edit files. Return concise findings with exact paths and open questions."
}
```

Continue useful non-overlapping main-agent work instead of polling or duplicating the delegated task.

Join the job when its result becomes necessary:

```json
{
  "jobId": "job_01234567-89ab-cdef-0123-456789abcdef"
}
```

Use a finite wait without cancelling the child:

```json
{
  "jobId": "job_01234567-89ab-cdef-0123-456789abcdef",
  "timeout": 30
}
```

## 🛠️ Tools

The extension registers exactly these tools in this order:

| Tool | Purpose |
| --- | --- |
| `subagent_spawn` | Start one fresh bounded job and return immediately. |
| `subagent_await` | Wait for one job without cancelling it on caller timeout. |
| `subagent_cancel` | Idempotently cancel one active job and await process cleanup. |
| `subagent_inspect` | Read privacy-bounded current-session metadata. |

See [`docs/tools.md`](./docs/tools.md) for exact schemas, states, and result behavior.

### Tool selection

Omitting `tools` selects `read`, `grep`, `find`, and `ls`.

An explicit empty array starts Pi with `--no-builtin-tools`.

An explicit non-empty array may contain `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`.

Duplicates are removed in first-seen order.

Extension tools and unknown tool names are rejected before job admission.

### Job lifecycle

A job starts as `queued` or `running` and reaches exactly one terminal state: `completed`, `partial`, `failed`, `timed_out`, or `cancelled`.

The first terminal outcome wins when completion, timeout, cancellation, or shutdown race.

A `subagent_await` timeout or caller cancellation ends only that await operation.

The same active job can be awaited again later.

Job IDs and all summaries expire on session replacement, reload, or shutdown.

### Child boundary

Every job receives a self-contained task and no parent conversation history.

The child disables session persistence, unrelated extensions, skills, and prompt templates.

The child runs in the main session's current working directory with its current trust decision.

The child inherits the selected provider, model, and effective thinking level.

Providers registered only by a parent extension and process-local runtime API keys cannot be inherited by a child that disables extensions.

Nested delegation is rejected, and the child environment increments `PI_SUBAGENT_DEPTH` defensively.

## 💬 Commands

- `/subagents` reports bounded current-session status in TUI and RPC modes.
- `/subagents status` reports the same privacy-bounded status.
- `/subagents help` summarizes the four tools and isolation boundary.

The removed `/subagents settings` route is not accepted.

Commands produce no extension-owned output in print or JSON mode.

## 🔒 Security and privacy

The extension is a coordination boundary, not an operating-system sandbox.

A task prompt cannot reduce permissions granted by the selected tools or the Pi process.

Inspection and status omit task text, full output, prompts, selected tools, credentials, environment variables, and legacy persisted content.

Widget labels and model-visible completion content strip terminal control and Unicode bidirectional formatting characters before layout.

Raw bounded child output remains available in `subagent_await` result details for programmatic use.

Completion delivery uses `deliverAs: "steer"` with `triggerTurn: false`, so it does not request a new main-agent turn.

Legacy `pi-subagents.json` and retained-state files are left untouched for downgrade recovery.

## 🚧 Limitations

- Jobs cannot ask the main agent questions before completion.
- Jobs cannot be continued after completion.
- Jobs do not retain history, identities, hierarchy, mailboxes, or state across sessions.
- Jobs cannot receive parent context, custom agent catalogs, extension tools, external working directories, or package-managed worktrees.
- The runtime has one subprocess transport and no automatic transport selection.
- The main agent must decompose work, avoid conflicting writers, perform fan-in, run deterministic checks, and decide what evidence is sufficient.
- Disconnected retained-runtime source remains temporarily in the package for a separate deletion pass and is unreachable from the registered entrypoint.

See [`docs/bounded-runtime-migration.md`](./docs/bounded-runtime-migration.md) for the breaking migration from retained agents.

## 🗂️ Package layout

```text
packages/pi-subagents/
├── dist/                         # Generated build-backed Pi entrypoint
├── docs/                         # Contract, migration, diagrams, and direction notes
├── scripts/build-runtime.mjs     # Validated atomic runtime builder
├── src/
│   ├── bounded-subagents.ts      # Active extension composition and lifecycle
│   ├── job-process.ts            # Isolated Pi subprocess runner
│   ├── job-runtime.ts            # Current-session bounded job state
│   ├── job-tools.ts              # Four fixed model-facing tools
│   ├── job-types.ts              # Closed contract types and limits
│   ├── job-widget.ts             # TUI-only active-job widget
│   ├── pi-invocation.ts          # Validated Pi executable resolution
│   ├── process-control.ts        # Process-group termination
│   ├── safe-text.ts              # Display sanitization and bounds
│   └── index.ts                  # Thin extension entrypoint
└── test/                         # Active Vitest coverage
```

## 🔎 Keywords

Pi extension, bounded subagents, background jobs, isolated subprocesses, parallel repository work, model tools.

## 📄 License

[MIT](./LICENSE)
