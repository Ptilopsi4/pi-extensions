# pi-subagents capability matrix

This matrix records the active bounded-job boundaries of `@narumitw/pi-subagents`.

The README owns public usage, while source and focused tests are the executable authority.

| Capability | Status and boundary | Evidence |
| --- | --- | --- |
| Background spawn | `subagent_spawn` returns an opaque current-session job ID without waiting for completion. | `src/job-tools.ts`, registration tests |
| Intentional join | `subagent_await` waits for one job; timeout and caller cancellation stop only the wait. | `src/job-runtime.ts`, runtime tests |
| Cancellation | `subagent_cancel` is idempotent, first-writer-wins, and awaits owned child cleanup. | runtime and lifecycle tests |
| Metadata inspection | `subagent_inspect` exposes privacy-bounded current-session summaries without mutation. | registration privacy tests |
| Fixed tool surface | Source and generated entrypoints register four tools in stable order. | registration, cache-contract, and loader tests |
| Child execution | Every accepted job owns at most one fresh Pi subprocess. | process and runtime tests |
| Tool policy | The child receives only the approved core-tool allowlist, with explicit empty-list behavior. | schema and child-argument tests |
| Model inheritance | The child inherits the main provider, model, and effective thinking level when child-readable. | registration and child-argument tests |
| Trust and cwd | The child uses the current working directory and current project-trust decision. | registration and child-argument tests |
| Completion delivery | Terminal completion is bounded, sanitized, non-waking, and attempted at most once. | completion-delivery tests |
| Session cleanup | Replacement, reload, and shutdown cancel jobs and release tasks, processes, timers, subscriptions, and widgets. | lifecycle and widget tests |
| Prompt-cache stability | Ordered provider-visible tool definitions remain fixed across ordinary requests. | cache-contract test |
| Terminal safety | C0, C1, ANSI introducers, and Unicode bidirectional controls are removed at display boundaries. | safe-text and widget tests |
| Job durability | Unsupported; jobs and IDs expire with the current session. | lifecycle tests |
| Retained follow-up | Unsupported; start a new self-contained job. | migration guide |
| Mailbox and peer communication | Unsupported. | startup graph and migration guide |
| Child ask/reply | Deferred and unsupported in the active contract. | current-direction note |
| Multiple transports | Unsupported; the runtime uses one subprocess path. | startup graph and process tests |
| Custom agents and parent context | Unsupported; specialization belongs in the task. | schema and child-argument tests |
| Worktree management | Unsupported; prepare isolation outside the extension before spawning. | migration guide |
| Settings | Unsupported; legacy files are never read or changed. | isolated non-mutation test |
| Structured result contracts | Unsupported; the child returns bounded text and limitations. | tool reference |
| Workflow orchestration | Unsupported; the main agent owns sequencing and fan-in. | README |
| Operating-system isolation | Unsupported; Pi and child tools run with the user's process permissions. | README security boundary |

## Runtime ownership boundary

The in-memory runtime owns IDs, capacity, legal transitions, waiters, cancellation, summaries, and completion attempts.

Each active job owns one abort controller, terminal promise, and child task.

The process runner owns child arguments, JSON event decoding, output bounds, timeout, and process-group termination.

Pi core owns provider execution, parent message ordering, retries, compaction, global scheduling, and model interaction.

The extension does not claim inherited extension state, provider hooks, durable child sessions, or a core-owned agent tree.
