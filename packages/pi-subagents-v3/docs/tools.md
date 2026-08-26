# Pi Subagents v3 tools

## `subagent-v3-start`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agent` | `string` | Yes | Configured subagent name. |
| `task` | `string` | Yes | Self-contained task, up to 50 KiB of UTF-8 text. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default timeout. |

## `subagent-v3-inspect`

No parameters.

## `subagent-v3-cancel`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID returned by `subagent-v3-start` or `subagent-v3-consult`. |

## `subagent-v3-wait`

### Main agent

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID to wait for. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default and does not cancel the job. |

Returns early without cancelling the job when a subagent message needs a main-agent response.

### Background subagent

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `requestId` | `string` | Yes | Request ID returned by `subagent-v3-ask`. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default and does not cancel the request. |

Returns the main agent's response as plain text and throws when the wait times out or is cancelled.

## `subagent-v3-consult`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agent` | `string` | Yes | Configured subagent name. |
| `task` | `string` | Yes | Self-contained research or review question, up to 50 KiB of UTF-8 text. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default timeout. |

Starts a read-only background job and returns its job ID immediately.

## `subagent-v3-ask`

Available only to background subagents.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `message` | `string` | Yes | Self-contained question for the main agent, up to 50 KiB of UTF-8 text. |

Returns a request ID immediately.

Each job may have up to four outstanding requests.

## `subagent-v3-reply`

Available only to the main agent.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `requestId` | `string` | Yes | Pending request ID received from a background subagent. |
| `message` | `string` | Yes | Plain-text response, up to 50 KiB of UTF-8 text. |

Returns an acknowledgement without replacing an earlier response.
