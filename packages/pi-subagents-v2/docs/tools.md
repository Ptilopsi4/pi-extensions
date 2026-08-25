# Pi Subagents v2 tools

## `subagent-v2-start`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agent` | `string` | Yes | Configured subagent name. |
| `task` | `string` | Yes | Self-contained task, up to 50 KiB of UTF-8 text. |
| `timeoutMs` | `integer` | No | `1`–`3,600,000`; defaults to the agent definition or `60,000`. |

## `subagent-v2-inspect`

No parameters.

## `subagent-v2-cancel`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID returned by `subagent-v2-start`. |

## `subagent-v2-wait`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID to wait for. |
| `timeoutMs` | `integer` | No | `1`–`300,000`; defaults to `30,000` and does not cancel the job. |

## `subagent-v2-consult`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `agent` | `string` | Yes | Configured subagent name. |
| `task` | `string` | Yes | Self-contained research or review question, up to 50 KiB of UTF-8 text. |
| `timeoutMs` | `integer` | No | `1`–`3,600,000`; defaults to the agent definition or `60,000`. |
