# Coding-Agent Subagents: Research Synthesis

> **Historical research input:** This document synthesizes research available through 2026-08-10 and does not define current `pi-subagents` built-ins, tools, or routing.
> See the [current direction](../../packages/pi-subagents/docs/implementation-notes/pi-subagents-current-direction.md) for maintained product behavior.

## Purpose

This document is the canonical research synthesis for deciding when a coding agent should delegate, how delegated work should be isolated and integrated, and how results should be verified.

The companion [evidence catalog](coding-agent-subagents-evidence-catalog.md) records paper-level methods, measurements, baseline caveats, and primary sources.

The separate [least-privilege review](2026-08-10_llm-agent-least-privilege-and-runtime-enforcement.md) covers authorization and runtime enforcement beyond subagent-specific evidence.

## Evidence policy

- **Direct evidence** means a mechanism or measurement reported by a primary paper.
- **Paper-author interpretation** means the authors' explanation of their own measurements.
- **Synthesis** means a design conclusion inferred across papers rather than tested as one complete system.
- **Coverage gap** means the reviewed evidence is weak, indirect, or absent.

Results from different models, tasks, harnesses, budgets, and evaluators are not directly comparable.

A fair delegation comparison should match the model, task information, harness, tools, total inference budget, wall-clock ceiling, retries, stopping rules, and evaluator.

No reviewed repository-scale parent-subagent study matches all of those dimensions simultaneously.

## Executive conclusions

- **Synthesis:** Multi-agent execution should not be the default because strong single-agent and equal-sample baselines often match or beat automatic multi-agent systems at lower cost.
- **Synthesis:** Delegation helps most when work is weakly coupled, context exceeds one agent's effective window, specialist access is necessary, or an independent evidence source can cheaply reject weak work.
- **Synthesis:** Agent count is a poor optimization target because coordination quality, dependency structure, information transfer, and verification dominate nominal parallelism.
- **Synthesis:** Structured contracts and typed artifacts are safer coordination primitives than unrestricted peer conversation.
- **Synthesis:** Worktrees prevent accidental file interference but do not prevent stale premises or logically incompatible patches.
- **Synthesis:** One integration owner should validate base state, scope, dependencies, evidence, and current-tree behavior before accepting a worker result.
- **Synthesis:** Independent executable verification is more reliable than worker confidence, majority agreement, or ungrounded self-review.
- **Synthesis:** Capabilities should be task-bound, short-lived, and enforced outside the acting model wherever the runtime can mediate the effect.
- **Synthesis:** Cancellation, retry, and late-result handling are correctness concerns rather than optional operational polish.
- **Synthesis:** The smallest defensible experiment is a single-agent-first cascade with no more than two concurrent mutating workers, centralized integration, and a fresh-context verifier.

## Admission and routing

[Single-agent or Multi-agent Systems? Why Not Both?](coding-agent-subagents-evidence-catalog.md#single-agent-or-multi-agent-systems-why-not-both) found that single-agent and multi-agent systems produced the same pass-or-fail result in roughly 80% of evaluated cases while multi-agent token use was often much higher.

Its checker-gated cascade improved HumanEval, MBPP, and DS1000 accuracy over both compared paths, but that result depends on a cheap and trustworthy checker.

[The Illusion of Multi-Agent Advantage](coding-agent-subagents-evidence-catalog.md#the-illusion-of-multi-agent-advantage) found that automatic multi-agent systems generally failed to beat five-sample self-consistency and sometimes cost up to ten times more.

[Co-Coder](coding-agent-subagents-evidence-catalog.md#co-coder) is the strongest positive coding result in the reviewed set because its same-model comparison improved quality, observed cost, and latency together on bounded repository-generation tasks.

**Admission rule:** Keep the task in one agent unless the request exposes a concrete benefit hypothesis and a credible verification route.

Useful benefit hypotheses include:

- context relief for evidence that does not fit one effective window;
- independent work on weakly coupled components;
- specialist tools or modalities unavailable to the parent;
- independent reproduction, testing, or falsification;
- parallel exploration of genuinely different candidate approaches.

A single agent is favored when:

- the task fits comfortably in context;
- edits share dense interfaces or assumptions;
- the main agent would need the child result before doing anything else;
- correctness cannot be partitioned or checked independently;
- coordination artifacts would exceed the useful work;
- the expected gain is smaller than ordinary benchmark or harness variance.

## Decomposition and concurrency

[Effective Strategies for Asynchronous SWE Agents](coding-agent-subagents-evidence-catalog.md#effective-strategies-for-asynchronous-swe-agents) and [Co-Coder](coding-agent-subagents-evidence-catalog.md#co-coder) support dependency-aware scheduling over cohesive work units.

Both systems schedule only ready work and retain centralized integration or testing.

Their evidence also shows non-monotonic scaling because integration overhead grows and dense coupling removes useful parallelism.

[CooperBench](coding-agent-subagents-evidence-catalog.md#cooperbench) provides strong contrary evidence because success fell as interacting features were spread across more agents.

**Recommended decomposition protocol:**

1. Build or infer a dependency graph before dispatch.
2. Group strongly coupled files, interfaces, and assumptions under one owner.
3. Assign one owner to each mutating unit.
4. Release a node only when its named upstream artifacts are current.
5. Derive concurrency from ready weakly coupled work rather than treating the configured maximum as a target.
6. Start with at most two concurrent mutating workers until local evidence supports a wider team.
7. Replan downstream work when an upstream artifact, test, or premise changes.

Read-only repository research can usually share a pinned read-only snapshot.

Mutating work requires explicit workspace and ownership isolation.

## Context, handoffs, and communication

[Recursive Agent Harnesses](coding-agent-subagents-evidence-catalog.md#recursive-agent-harnesses) shows that isolated child contexts can help long-context aggregation, but its experiment does not isolate context design from the rest of the harness.

[OrchBench](coding-agent-subagents-evidence-catalog.md#orchbench) supports preserving dependency transfers under context pressure, although its main results come from deterministic simulation.

[Semantic Snapshot Isolation](coding-agent-subagents-evidence-catalog.md#semantic-snapshot-isolation) demonstrates that prompts, models, indexes, tools, resources, and contracts can be pinned across retries and branches.

[CooperBench](coding-agent-subagents-evidence-catalog.md#cooperbench) shows that ordinary natural-language communication can reduce textual conflicts without improving final correctness when messages are vague, late, or wrong.

The debate literature supports independent initial work, bounded structured exchange, preserved dissent, and evidence-based aggregation rather than unrestricted broadcast.

**Recommended task packet:**

- task ID and generation;
- objective and non-goals;
- exact base commit or snapshot;
- named dependency versions;
- allowed paths, tools, and external effects;
- required inputs and relevant repository slices;
- acceptance checks and evidence requirements;
- cost, time, turn, and tool budgets;
- cancellation lineage.

**Recommended result artifact:**

- terminal status;
- patch or artifact digest;
- files touched and reasons;
- assumptions and dependency versions;
- commands and checks run;
- raw evidence references;
- unresolved risks and requested follow-up;
- observed cost and timing.

Workers should communicate through typed artifacts and manager-mediated clarification by default.

Direct peer chat should be admitted only for a named coordination purpose that structured artifacts cannot satisfy.

## Workspace isolation, stale state, and integration

Worktrees and version validation solve different problems.

Worktrees isolate filesystem mutations, while version validation detects stale assumptions and incompatible integration.

[STORM](coding-agent-subagents-evidence-catalog.md#storm) reports that versioned shared state can outperform worktrees on coupled tasks when stale writes are actively rejected.

[CoAgent](coding-agent-subagents-evidence-catalog.md#coagent) demonstrates ordering, notification, undo, and replay for contended tool effects, but its failures show that semantic relevance should not depend only on an agent judgment.

[Claim Plane](coding-agent-subagents-evidence-catalog.md#claim-plane) binds change intent, base state, ownership, leases, tests, and patch identity before integration.

[Proof-or-Stop](coding-agent-subagents-evidence-catalog.md#proof-or-stop) binds completion evidence to the exact current material state.

**Recommended integration protocol:**

1. Give each mutating worker an isolated worktree rooted at an exact commit.
2. Record the worker's base commit and dependency or read-set versions.
3. Let only one integration controller update the canonical branch.
4. Integrate in dependency order using immutable patch or artifact identities.
5. Reject outputs whose base, dependencies, semantic manifest, scope, or evidence changed.
6. Quarantine stale results as replanning evidence instead of silently rebasing them.
7. Run acceptance checks against the assembled current tree rather than individual branches alone.

A clean merge is not proof of semantic compatibility.

## Independent verification and completion

[MASAI](coding-agent-subagents-evidence-catalog.md#masai) shows that independently generated reproduction tests improve candidate selection over model-only ranking.

[AgentCoder](coding-agent-subagents-evidence-catalog.md#agentcoder) separates implementation, test design, and execution so the tester does not simply restate the implementation path.

[Large Language Models Cannot Self-Correct Reasoning Yet](coding-agent-subagents-evidence-catalog.md#large-language-models-cannot-self-correct-reasoning-yet) shows that ungrounded reflection can change correct answers into incorrect ones.

[MAST](coding-agent-subagents-evidence-catalog.md#mast) identifies missing, incorrect, and premature verification as recurring multi-agent failures.

**Recommended verification protocol:**

- Give the verifier the original objective, acceptance criteria, integrated tree, and raw evidence.
- Do not give the verifier authority to accept persuasive worker narrative as proof.
- Run deterministic checks such as tests, typechecks, builds, static analysis, runtime reproduction, and artifact inspection.
- Verify high-level user requirements separately from compilation and formatting.
- Require evidence freshness, patch integrity, scope compliance, and current-tree outcomes.
- Let only the designated orchestrator or verifier publish the completion state.
- Bound reviewer and repair loops, and stop with abstention when required evidence cannot be obtained safely.

Consensus may trigger final verification but must not directly mark a task complete.

## Authority and security

[ClawArena-Team](coding-agent-subagents-evidence-catalog.md#clawarena-team) found workspace-permission precision below 50% for every evaluated manager, indicating routine over-granting.

[When Child Inherits](coding-agent-subagents-evidence-catalog.md#when-child-inherits) demonstrates risks from inherited parent context, excessive tools, stale asynchronous state, and sibling authority.

The communication-attack literature shows that subagent messages, repository text, logs, retrieved content, and citations can carry malicious or incorrect instructions.

The separate [least-privilege review](2026-08-10_llm-agent-least-privilege-and-runtime-enforcement.md) supports complete mediation, typed capabilities, external enforcement, credential isolation, safe policy evolution, and lifecycle revocation.

**Recommended authority model:**

- Treat model output and all observed content as untrusted data.
- Bind grants to the task, generation, exact resources, operations, arguments, destinations, and expiration.
- Keep credentials outside model context and inject them only after validating the concrete call.
- Allow automatic narrowing but require re-admission or approval for expansion.
- Revoke grants before signalling cancellation so late work cannot retain authority.
- Measure permission precision and unused grants rather than only forbidden operations.
- Use process, container, VM, or OS isolation when prompt-level policy cannot mediate the real effect.

A capability manifest describes expected fit but does not create or prove an enforcement boundary.

## Cancellation, retries, and lifecycle

[SHEPHERD](coding-agent-subagents-evidence-catalog.md#shepherd) demonstrates typed supervision, scope forks, discard, rollback, compensation, and immutable execution traces.

[OrchestraBench](coding-agent-subagents-evidence-catalog.md#orchestrabench) shows that blind retry can repair transient tool failure while reproducing latent semantic corruption.

[Proof-or-Stop](coding-agent-subagents-evidence-catalog.md#proof-or-stop) distinguishes bounded retry from successful completion and rejects stale receipts.

**Recommended lifecycle protocol:**

- Model cancellation as a tree rooted at the user request.
- Increment the task generation before signalling workers.
- Reject every result from a cancelled or replaced generation.
- Cancel subprocesses, timers, network requests, UI flows, and child agents owned by the task.
- Distinguish transient tool failure, missing input, stale premise, integration conflict, verifier failure, and budget exhaustion.
- Give each failure class a specific recovery action instead of replaying the same prompt.
- Preserve immutable task intent and trusted versions across retries without inheriting hidden mutable state or an unbounded failed transcript.
- Revalidate the session, generation, branch, artifact, and mutable state after every asynchronous boundary.

**Coverage gap:** Coding-agent studies rarely measure cancellation propagation latency, leaked processes, late-result acceptance, or compensation of irreversible external effects.

## Observability and replay

A subagent system cannot evaluate stale-state rejection, permission precision, cancellation, or evidence freshness from final patches alone.

The orchestrator should emit an append-only event stream for:

- admission and routing;
- dispatch and dependency release;
- context and semantic manifests;
- capability grants and expansions;
- tool effects;
- handoffs and artifact versions;
- stale rejection and invalidation;
- cancellation and retries;
- integration and verification;
- terminal outcome.

Each event should identify the task, parent, generation, base state, capability digest, monotonic time, and causal predecessors.

Replay should explain why work was admitted, what the worker knew, what it could affect, which evidence supported integration, and why the result was accepted or rejected.

## Minimal experimentally testable architecture

The following design is a falsifiable experiment rather than a required product topology.

- One router-orchestrator selects direct execution, verified direct execution, or delegated execution.
- No more than two mutating workers run concurrently.
- Every worker receives a fresh bounded context, an immutable task packet, an exact base state, and a scoped grant.
- Workers return typed results and cannot directly update the canonical branch.
- One integration controller checks scope, versions, patch identity, dependencies, and evidence.
- One fresh-context verifier checks the exact integrated state.
- Rework is limited to one bounded retry per task node.
- Cancellation invalidates the generation before worker notification.
- Recursive grandchildren are disabled so delegation and verification effects can be measured without depth confounding.

The lifecycle is:

`proposed → admitted → running → result_pending → integrating → verifying → accepted | rework | cancelled | stale | failed`

The architecture is supported only if it improves verified success or Pareto efficiency over strong simpler baselines.

## Evaluation methodology

Compare at least:

1. one strong single agent;
2. equal-budget best-of-N or self-consistency;
3. naive parallel workers;
4. fixed isolated workers;
5. the proposed routed architecture.

Hold constant where practical:

- model version and reasoning setting;
- issue text, hints, tests, and repository state;
- tool interface and harness;
- total token or dollar budget;
- wall-clock ceiling;
- retry and sample allowance;
- patch extraction and evaluator.

Stratify tasks by:

- independent edits;
- moderate coupling;
- dense coupling;
- context overflow;
- staged upstream changes;
- injected worker, tool, and verifier failures.

Report:

- hidden-test or acceptance success;
- verified success per dollar;
- wall-clock critical path;
- total and failed-worker cost;
- unnecessary delegation;
- handoff coverage and duplicate work;
- merge, stale-result, and rework rates;
- permission precision and out-of-scope attempts;
- evidence freshness and false completion;
- cancellation latency, leaked work, and accepted late results.

Use repeated seeds, paired task outcomes, and confidence intervals.

Reject the architecture for a task stratum when it does not beat the strongest simpler baseline or when its gain requires materially worse safety.

## Decision traceability

| Decision | Primary evidence | Status |
| --- | --- | --- |
| Default to one agent and delegate conditionally. | Hybrid routing and cascade results, automatic-MAS baseline audit, and equal-budget counterevidence. | Strong synthesis from mixed direct evidence. |
| Schedule dependency-ready cohesive units. | Effective asynchronous SWE agents and Co-Coder. | Direct mechanism and coding evidence. |
| Begin with at most two mutating workers. | Non-monotonic worker ablations and CooperBench scaling. | Conservative synthesis. |
| Use bounded contexts and explicit handoffs. | RAH, OrchBench, Semantic Snapshot Isolation, and Software Delegation Contracts. | Direct component evidence with integration inference. |
| Prefer typed manager-mediated artifacts over peer chat. | CooperBench, MASAI, sparse-debate studies, and communication attacks. | Strong risk evidence with inferred protocol. |
| Combine worktrees with version validation. | Asynchronous SWE agents, STORM, CoAgent, and Claim Plane. | Cross-system synthesis. |
| Centralize integration and reject stale outputs. | STORM, Claim Plane, CoAgent, and Proof-or-Stop. | Strong mechanism evidence. |
| Verify the exact integrated state independently. | MASAI, AgentCoder, manager-review ablations, and Proof-or-Stop. | Strong component evidence. |
| Bind authority to task and generation. | ClawArena-Team, SkillScope, child-inheritance attacks, and least-privilege research. | Strong risk premise with inferred coding policy. |
| Classify retries and invalidate cancelled generations. | SHEPHERD, OrchestraBench, and Proof-or-Stop. | Retry evidence is stronger than cancellation evidence. |
| Record causal state and evidence. | SHEPHERD, Claim Plane, Proof-or-Stop, and ClawArena-Team. | Direct mechanism evidence. |
| Evaluate against strong matched baselines. | Illusion of Multi-Agent Advantage, Claw-SWE-Bench, OrchBench, and paired noise-floor work. | Strong methodology evidence. |

## Open research questions

- Can a router predict delegation value accurately enough to beat a cheap single-agent-first cascade on repository maintenance?
- Which prospective signal best predicts coupling: file overlap, dependency density, interface sharing, edit locality, or semantic contract overlap?
- Where is the optimal boundary between shared versioned state and isolated worktrees?
- When does direct peer communication add value beyond typed artifacts and manager-mediated clarification?
- How much parent context preserves architectural invariants without transferring obsolete assumptions?
- Can semantic snapshots cover repository state, changing tests, tool versions, and external resources together?
- How should cancellation latency, process leakage, irreversible effects, and adversarially late results be benchmarked?
- How much do narrower grants reduce coding success versus merely increasing expansion requests?
- Does model diversity improve verification beyond fresh context and independent evidence alone?
- Which orchestration simulator outputs remain predictive under real framework timing and token costs?

## Conclusion

The literature does not support unconditional subagent use, wide fixed teams, unrestricted peer chat, or worktrees as a complete concurrency solution.

It supports selective delegation over weakly coupled work, dependency-aware scheduling, compact explicit handoffs, version-aware integration, bounded authority, and independent evidence-based verification.

A subagent result should be treated as a scoped speculative claim until the current integrated state verifies it.
