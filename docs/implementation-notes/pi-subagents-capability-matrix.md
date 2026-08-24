# pi-subagents capability matrix

This matrix records the maintained capability boundaries of `@narumitw/pi-subagents`.
The package README owns public schemas and usage.
Source and focused tests are the executable authority.

| Capability | Status and boundary | Evidence |
| --- | --- | --- |
| Blocking orchestration | `subagent` implements single, parallel, chain, fan-in, panel, and explicit dependency workflows; the complete request is preflighted before launch | `src/execution.ts`, `src/panel-execution.ts`, blocking execution and workflow tests |
| Detached addressable agents | `subagent_spawn` returns an opaque id and canonical task path without waiting for completion | `src/stateful-registration.ts`, registry and stateful registration tests |
| Follow-up and retained lifecycle | `subagent_send` starts follow-up work; `subagent_await` blocks for one current turn without interrupting on wait timeout or cancellation; `subagent_manage` supports only interrupt and close; `subagent_mailbox` owns queue-only send and acknowledged read | `src/stateful-tool-params.ts`, registry and lifecycle tests |
| Metadata-only inspection | `subagent_inspect` is registered in every workflow and never launches children, changes lifecycle state, or reads or acknowledges mailbox content | `src/inspect.ts`, `test/inspect.test.ts` |
| Synchronous read-only consultation | `subagent_consult` runs one ephemeral child with extensions disabled and only the effective subset of `read`, `grep`, `find`, and `ls` | `src/consult.ts`, `src/consult-policy.ts`, `test/consult.test.ts` |
| Workflow-dependent tool surface | `all` registers eight tools including the blocking retained-agent `subagent_await` join; `async-only` registers detached lifecycle plus inspection; `blocking-only` registers blocking delegation, consultation, and inspection; `disabled` registers inspection only | `src/subagents-extension.ts`, settings UI and registration tests |
| Transport selection | Stateful execution supports `subprocess`, `in-process`, `rpc`, and `auto`; subprocess remains the compatibility default and selection never falls back after acceptance | `src/create-stateful-transport.ts`, transport tests |
| Automatic transport | Read-only built-in tools select in-process, write-capable built-ins select RPC, and extension or custom tools select fresh subprocess execution | `src/auto-transport.ts`, automatic transport tests |
| In-process SDK boundary | In-process children use public session-service and model-resolution APIs, disable child extensions, and reject unsupported tools without widening or fallback | `src/in-process-transport.ts`, in-process transport tests |
| Persistent RPC transport | One retained agent lazily owns at most one exact-loaded Pi RPC child; `agent_settled` is the completion boundary and accepted work is never replayed automatically | `src/rpc-transport.ts`, [`pi-subagents-rpc-v1.md`](pi-subagents-rpc-v1.md) |
| Detached completion delivery | `next-turn` is the default non-waking delivery; opt-in `auto-resume` batches settled completions and requests at most one synthesis turn when the root is idle and has no pending input | `src/completion-delivery.ts`, completion-delivery tests |
| Deterministic timeout and cleanup | Work, idle, turn, and tool budgets use bounded abort and process or session cleanup; explicit parent interruption never starts timeout finalization | runner, transport, timeout, and cleanup tests |
| Bounded protocol and output | Model-facing content and safe projections are bounded to 50 KiB or 2,000 lines | `src/protocol.ts`, `src/limits.ts`, rendering and inspection tests |
| Partial structured outcomes | Blocking, detached, and consultation paths preserve bounded post-launch evidence and usage; structured-v2 keeps claims, artifacts, verification, limitations, and unresolved dependencies | result-contract, runner, consultation, and orchestration tests |
| Enforced delegation contracts | Optional `pi-subagents:delegation:v2` contracts validate declared capabilities, dependencies, evidence, side-effect policy, and supported enforcement without claiming unsupported path, network, or secret guarantees | `src/delegation-contract.ts`, contract and workflow tests |
| Recursion guard | `PI_SUBAGENT_DEPTH` and `PI_SUBAGENT_MAX_DEPTH` bound nested delegation | `src/execution.ts`, runtime policy and runner tests |
| Hierarchical ownership | Parent, root, depth, children, and authenticated task paths are persisted; subtree interrupt and close run child-first | `src/registry.ts`, registry and orchestration tests |
| Bounded mailbox and peer delivery | Mailboxes support acknowledgement and deduplication; inspection exposes only counts; nested peer delivery uses session-scoped authenticated channels | registry, peer transport, mailbox, and inspection tests |
| Shared and isolated workspaces | Shared-workspace agents may write concurrently by default; deprecated `allowConcurrentWrites` is a no-op; opt-in clean-Git worktrees provide disposable repository isolation | `src/stateful-registration.ts`, `src/workspace.ts`, workspace tests |
| Separate active and retained capacity | FIFO active-turn scheduling and retained-agent limits are independent and hierarchy depth and child counts are bounded separately | `src/registry.ts`, capacity and fairness tests |
| Parent context selection | Context supports none, all, summary, recent N user turns, and selected entry ids; projection is text-only, sanitized, and bounded | `src/context.ts`, context protocol tests |
| Target trust resolution | Current workspace uses session trust; external targets use the nearest saved `ProjectTrustStore` decision, with a nearer denial winning | `src/cwd-policy.ts`, `test/cwd-policy.test.ts` |
| Consultation target policy | Consultation defaults to any existing target and removes inherited target and project resources when effective trust is absent | `src/consult.ts`, consultation cwd and trust tests |
| General delegation target policy | Delegation defaults to trusted targets; blocking and detached requests are preflighted and every transport receives the same resolved trust decision | execution, stateful, cwd-policy, and transport tests |
| Durable logical history | Versioned private state restores inert; retained transports seed bounded sanitized context and logical history once after explicit follow-up | `src/persistence.ts`, persistence and orchestration tests |
| Automatic side-effect resume | Restored records never restart work; semantic resource skew requires explicit revalidation before a follow-up | persistence, semantic snapshot, and lifecycle tests |
| Stable tool schema | Registered tool membership does not change across retained-agent state transitions; workflow changes require reload | registration and settings UI tests |
| Native transcript switching | Unsupported because Pi exposes no supported child transcript or session switch handle | public SDK boundary review |
| Approval, sandbox, and header inheritance | Unsupported as a general guarantee and reported explicitly in result policy metadata | result policy and transport tests |
| Filesystem isolation | Optional disposable worktree only; cwd and trust policies are not OS sandboxes and do not restrict absolute paths, processes, network, or credentials | `src/workspace.ts`, README security boundary |
| Extension-owned autonomous planning | Removed; topology belongs to the main agent or a caller-authored workflow request | built-in catalog, execution, and registration tests |

## Read-only boundary

`subagent_inspect` is side-effect-free at the extension capability boundary.
It uses pure settings and metadata snapshots, applies project-trust gates before project discovery, and omits prompts, history, context content, mailbox content, credential-bearing model fields, and unsafe paths.

`subagent_consult` is synchronous and non-retained.
Missing agent tool configuration selects the read-only default set, an explicit empty list selects no tools, and any explicit list is intersected with the supported read-only built-ins.
Extensions, sessions, lifecycle tools, shell execution, and file mutation tools are disabled.
Pre-launch failures throw.
Once a child starts, bounded partial evidence and nested usage are retained and the finalized Pi tool result is marked as an error when consultation fails.

These are executor and resource-loading guarantees, not filesystem, network, process, or confidentiality sandboxes.
A consultation can read an accessible absolute path when explicitly asked and calls the configured model over the network.

## Runtime ownership boundary

The logical registry owns ids, hierarchy, capacity, mailboxes, completion delivery, persistence, semantic revalidation, and workspace cleanup.
Each retained turn owns one transport session or process according to its fixed effective transport.
Close, expiry, replacement, reload, and shutdown abort work and release transport and disposable-workspace ownership.

Pi core still owns provider execution, active-turn admission, message ordering, retries, compaction, interactive transcript selection, and global scheduling.
The extension does not claim inherited approval or sandbox policy, provider-header hooks, extension state, or a core-owned child-session tree.
