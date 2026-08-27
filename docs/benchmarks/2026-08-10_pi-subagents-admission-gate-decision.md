# Pi Subagents Admission Gate Decision

> **Historical benchmark decision:** This report evaluates the removed retained orchestration architecture and does not define an active workflow.

- **Decision:** Revise.
- **Recorded:** 2026-08-10.
- **Scope approval:** The explicit request to implement the delegation-intelligence roadmap authorizes only the revised opt-in scope below.
- **Production default:** Unchanged.

## Frozen question

The gate asks whether explicit task metadata can justify parent-owned work, one child, one child plus independent verification, or at most two mutating children without using task keywords or another model call.

The compared arms are strong single-agent, one-child, equal-budget best-of-N, naive parallel, fixed two-child, and admission-selected execution.

A truthful comparison must use the same declared model, repository state, task information, tools, context policy, evaluator, retry allowance, aggregate token or dollar ceiling, wall-clock ceiling, task sample, and paired seeds.

The primary outcomes are verified task success, verified success per dollar, wall-clock critical path, unnecessary delegation, handoff coverage, conflicts, rework, permission precision, stale acceptance, cancellation latency, leaked work, and accepted late results.

The minimum live sample, task strata, provider budget, and paired confidence method were not supplied and were not invented after observing results.

## Evidence

`admission-policy.test.ts` proves that the deterministic policy is audit-only, uses explicit metadata, selects the smallest justified architecture, and abstains on stale or insufficient evidence.

`admission-benchmark.test.ts` dry-runs the six-arm protocol and rejects model, evaluator, budget, width, retry, wall-clock, and recursion confounds.

The workflow scheduler caps concurrent mutating children at two and rejects recursive explicit workflows before allocation.

Generation, capability-grant, stale-result, integration-controller, artifact-version, semantic-snapshot, cancellation, crash-recovery, and orphan-cleanup tests provide deterministic safety evidence.

No paired live-provider repository benchmark was run, so this decision makes no quality, cost, token, latency, or admission-accuracy advantage claim.

## Revised Phase 5 consequence

The dependency scheduler and semantic isolation may operate only behind the caller-selected explicit `workflow` mode or retained follow-up revalidation.

Admission remains audit-only unless `workflow.honorAdmission` is explicitly true, and that opt-in can only decline work rather than silently widening authority or child count.

Legacy single, parallel, chain, fan-in, detached, transport, and settings defaults remain unchanged by omission.

The revised scope permits at most two concurrent mutating workflow tasks and no recursive workflow grandchildren.

No learned router, task-keyword heuristic, automatic production routing, default scheduling change, publication, tag, or release is authorized.

A future recommendation or default change still requires the paired repeated provider evaluation defined by the gate plan and separate approval.

## Limitations

The offline dry-run is protocol validation rather than representative quality evidence.

The integration controller validates metadata and evidence before an opted-in canonical integration decision, but this package still does not provide an operating-system sandbox or a general patch-application engine.

Non-Git retained targets cannot prove a stable repository generation and therefore require explicit revalidation before each follow-up.
