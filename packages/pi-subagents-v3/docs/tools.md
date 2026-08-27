# Pi Subagents v3 tools

## `subagent-spawn`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `task` | `string` | Yes | Self-contained task, up to 50 KiB of UTF-8 text. |
| `tools` | `string[]` | No | Up to 64 names from `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`; defaults to `read`, `grep`, `find`, and `ls`. |
| `thinkingLevel` | `string` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; defaults to the main agent's effective thinking level. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default timeout. |

Starts a task-specialized background job with the selected tool capabilities and returns its job ID immediately.

The runtime always adds `subagent-ask` and `subagent-wait` to the selected tools.

The child inherits the main agent's effective provider and model at spawn time.

Providers registered by a parent extension throw before the job is queued because children disable unrelated extensions.

A process-local runtime API key, including a parent-only `--api-key` value, also throws before queuing.

Use Pi's stored credentials or environment credentials that the child process can read.

Unavailable or extension-only tool names throw before the job is queued.

Throws without launching a child when the session broker is unavailable.

## `subagent-inspect`

No parameters.

## `subagent-cancel`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID returned by `subagent-spawn`. |

## `subagent-wait`

### Main agent

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID to wait for. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default and does not cancel the job. |

Returns `{ jobId, state, timedOut: false, interrupted: true, reason: "subagent_message" }` without cancelling the job when any unanswered child question needs a main-agent response.

### Background subagent

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `requestId` | `string` | Yes | Request ID returned by `subagent-ask`. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default and does not cancel the request. |

Returns the main agent's response as plain text.

A timeout or caller cancellation throws and stops only that wait, so the child may wait for the same request again.

## `subagent-ask`

Available only to background subagents.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `message` | `string` | Yes | Self-contained question for the main agent, up to 50 KiB of UTF-8 text. |

Returns a request ID immediately.

Each job may have up to four unanswered or answered-but-not-consumed requests.

## `subagent-reply`

Available only to the main agent.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `requestId` | `string` | Yes | Pending request ID received from a background subagent. |
| `message` | `string` | Yes | Plain-text response, up to 50 KiB of UTF-8 text and 2,000 lines. |

The first accepted response wins.

Returns an acknowledgement without replacing an earlier response.
