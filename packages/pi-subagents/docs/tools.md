# Pi Subagents tools

`pi-subagents` exposes four fixed current-session bounded-job tools.

All timeout values use seconds and accept finite values greater than zero through `2,147,483.647`.

A job can remain active without a timeout when `timeout` is omitted.

## `subagent_spawn`

Starts one fresh Pi subprocess and returns an opaque current-session job ID immediately.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `task` | `string` | Yes | Self-contained task between 1 byte and 50 KiB of UTF-8 text; NUL is rejected. |
| `tools` | `string[]` | No | Defaults to `read`, `grep`, `find`, and `ls`; an empty list gives the child no tools. |
| `thinkingLevel` | `string` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; defaults to the main agent's effective level. |
| `timeout` | `number` | No | Execution deadline in seconds; no default. |

The accepted tool names are `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`.

Duplicate tools collapse in first-seen order.

Unknown names, extension tool names, unknown fields, nested delegation, unavailable model inheritance, invalid timeouts, and capacity exhaustion reject before child launch.

The task is passed without parent conversation history.

The child disables session persistence, unrelated extensions, skills, and prompt templates.

A non-empty selection uses Pi's `--tools` allowlist.

An explicit empty selection uses `--no-builtin-tools` and never relies on empty comma-list behavior.

The result contains `jobId`, initial state `queued`, and the optional execution timeout.

## `subagent_await`

Waits for one current-session job to become terminal.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Opaque ID returned by `subagent_spawn`. |
| `timeout` | `number` | No | Maximum wait in seconds; no default. |

A terminal job returns immediately.

A wait timeout returns `timedOut: true` with the job's current state.

A wait timeout or caller cancellation releases only the waiter and never cancels the job.

A terminal result returns `timedOut: false` plus bounded `result`, `error`, and `limitations` fields when present.

Unknown and pruned IDs reject.

## `subagent_cancel`

Idempotently cancels one current-session job.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Opaque ID returned by `subagent_spawn`. |

Cancellation commits `cancelled` only when no terminal outcome has already won.

It aborts queued or running work and waits for owned child cleanup.

Repeated cancellation returns the same terminal state.

Cancelling an already terminal job does not replace its result.

Unknown and pruned IDs reject.

## `subagent_inspect`

Returns one privacy-bounded current-session snapshot and accepts no parameters.

Each summary can contain only:

- `jobId`;
- `state`;
- `createdAt`;
- optional `startedAt`;
- optional `finishedAt`; and
- optional execution `timeout`.

The result also reports how many older terminal summaries were omitted.

Inspection never exposes task text, child output, prompts, selected tools, credentials, environment variables, or legacy persisted content.

Inspection never launches, waits for, cancels, or otherwise changes a job.

## States and retention

The legal states are `queued`, `running`, `completed`, `partial`, `failed`, `timed_out`, and `cancelled`.

Only `queued` and `running` are non-terminal.

Terminalization is first-writer-wins.

The runtime admits at most eight non-terminal jobs.

It retains the thirty-two newest terminal summaries until session replacement, reload, or shutdown.

Pruned and prior-session IDs are invalid.

## Completion delivery

Each terminal job attempts completion delivery at most once after committing its terminal state.

The custom message type is `pi-subagent-completion`.

Model-visible content is bounded and sanitized before delivery.

Delivery uses `{ deliverAs: "steer", triggerTurn: false }`.

A delivery failure does not erase the terminal result or prevent later `subagent_await` access.

Cancellation and stale-session cleanup cannot replace a prior terminal result or cause duplicate delivery.
