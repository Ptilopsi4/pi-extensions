# pi-subagents capability matrix

This matrix records the maintained capability boundaries of `@narumitw/pi-subagents`.

The package README owns public schemas and usage, while source and focused tests are the executable authority.

| Capability | Status and boundary | Evidence |
| --- | --- | --- |
| Retained background spawn | `subagent_spawn` returns an opaque ID and canonical task path without waiting for completion. | `src/stateful-registration.ts`, registration and registry tests |
| Follow-up conversation | `subagent_send` starts another generation with bounded retained history after semantic and target revalidation. | stateful registration, semantic snapshot, and persistence tests |
| Intentional join | `subagent_await` waits for one retained turn; timeout and caller cancellation stop only the wait. | `test/stateful-await.test.ts` |
| Lifecycle management | `subagent_manage` interrupts reusable work or closes retained trees child-first. | stateful tool and registry lifecycle tests |
| Queue-only mailbox | `subagent_mailbox` sends without starting a turn and reads with optional acknowledgement. | stateful tool, mailbox, and hierarchy tests |
| Metadata-only inspection | `subagent_inspect` reads agents, retained runs, models, context previews, status, and diagnostics without mutation or mailbox acknowledgement. | `src/inspect.ts`, `test/inspect.test.ts` |
| Fixed tool surface | Enabled sessions register six retained tools in stable order; disabled sessions register inspection only. | registration, startup-import, settings, and cache-contract tests |
| Transport selection | Retained execution supports subprocess, in-process, RPC, and deterministic automatic selection without post-acceptance fallback. | transport tests |
| Completion delivery | `next-turn` is non-waking by default; opt-in `auto-resume` steers active work or requests one idle synthesis turn. | completion-delivery tests |
| Required completion tracking | Exact required run and generation state remains pending until visible or explicitly terminal. | completion-requirement and cache-contract tests |
| Durable retained state | Sanitized records restore inert and never restart interrupted work automatically. | persistence and session lifecycle tests |
| Semantic revalidation | Changed agent, trust, tool, contract, result, or resource semantics require explicit follow-up revalidation. | semantic snapshot and retained lifecycle tests |
| Hierarchical ownership | Parent, root, depth, children, and canonical task paths persist, and subtree cleanup runs child-first. | registry hierarchy and lifecycle tests |
| Shared and isolated workspaces | Shared writers may run concurrently with explicit ownership, while clean-Git disposable worktrees isolate repository writes. | workspace tests |
| Context selection | Spawn context supports none, all, summary, recent N user turns, and selected entry IDs with bounded sanitized projection. | context protocol and inspect tests |
| Target trust | Canonical launch targets follow current-session or nearest saved Pi trust and the configured delegation cwd policy. | cwd-policy and stateful trust tests |
| Bounded output | Model-facing content and safe projections remain bounded to 50 KiB or 2,000 lines. | limits, rendering, and inspection tests |
| Structured outcomes | Text, structured-v1, and structured-v2 retained results preserve bounded claims, artifacts, verification, limitations, and unresolved dependencies. | result-contract and retained execution tests |
| Delegation contracts | Optional v2 contracts validate capabilities, tools, authority metadata, evidence, budgets, and supported enforcement. | delegation-contract and execution-plan tests |
| Local usage recording | Opt-in recording stores only content-free retained lifecycle, outcome, usage, and timing metadata. | usage recording tests |
| Blocking execution | Removed; the main agent owns sequencing, parallel fan-out, fan-in, and deterministic verification. | registration tests and migration documentation |
| Synchronous consultation | Removed; read-only evidence uses `explorer` without claiming the former resource-isolation contract. | registration tests and migration documentation |
| Workflow and panel orchestration | Removed from the runtime. | source reachability audit and package tests |
| Native transcript switching | Unsupported because Pi exposes no supported child transcript or session switch handle. | public SDK boundary review |
| Filesystem isolation | Optional worktree only; cwd and trust policy are not OS sandboxes. | workspace tests and README security boundary |

## Read-only boundary

`subagent_inspect` is side-effect-free at the extension capability boundary.

It applies project trust before project discovery and omits prompts, history output, context content, mailbox content, credential-bearing model fields, and unsafe paths.

The built-in `explorer` has read-only configured tools, but those tools can read any accessible path explicitly requested by the model.

This is not a filesystem, network, process, or confidentiality sandbox.

## Runtime ownership boundary

The logical registry owns IDs, hierarchy, capacity, retained history, mailboxes, completion delivery, persistence, semantic revalidation, and workspace cleanup.

Each active turn owns one transport session or process according to its fixed effective transport.

Close, expiry, replacement, reload, and shutdown abort work and release transport and disposable-workspace ownership.

Pi core owns provider execution, message ordering, retries, compaction, global scheduling, and model interaction.

The extension does not claim inherited approval or sandbox policy, provider-header hooks, extension state, or a core-owned child-session tree.
