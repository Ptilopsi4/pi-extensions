# Pi Subagents v3 tools

## `subagent-start`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agent` | `string` | Yes | Configured subagent name. |
| `task` | `string` | Yes | Self-contained task, up to 50 KiB of UTF-8 text. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default timeout. |

Starts a normal background job and returns its job ID immediately.

Throws without launching a child when the session broker is unavailable.

## `subagent-inspect`

No parameters.

## `subagent-cancel`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID returned by `subagent-start` or `subagent-consult`. |

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

## `subagent-consult`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agent` | `string` | Yes | Configured subagent name. |
| `task` | `string` | Yes | Self-contained research or review question, up to 50 KiB of UTF-8 text. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default timeout. |

Starts a read-only background job and returns its job ID immediately.

The job shares the eight-active-job session capacity with normal background jobs.

Throws without launching a child when the session broker is unavailable.

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
