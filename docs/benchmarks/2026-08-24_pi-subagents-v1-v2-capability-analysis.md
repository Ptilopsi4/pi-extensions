# Pi Subagents v1/v2 Capability Benchmark Analysis

> **Historical benchmark report:** The measured v1 retained runtime and its runner have been removed, so this document is evidence only and is not runnable guidance.

## Decision summary

The final diagnostic run is a quality tie on the four common workloads.

Both `pi-subagents` and `pi-subagents-v2` completed 4 of 4 trials with full rubric evidence, exact orchestration-tool compliance, complete result visibility, and no timeout or protocol failure.

`pi-subagents-v2` had lower readiness and work latency in every paired task, but one repetition per task is insufficient for a causal or release decision.

`pi-subagents` remains substantially more capable for advanced orchestration, retained state, transport choice, verification contracts, and operational controls.

The result supports using v2 for deliberately minimal bounded jobs, not replacing or deprecating v1.

## Run configuration

- Protocol: `pi-extensions:subagent-capability-benchmark:v1`.
- Model: `openai-codex/gpt-5.6-sol` for every parent and child.
- Thinking level: `medium` for every parent and child.
- Repetitions: one paired repetition per workload.
- Trials: eight total across four matched pairs.
- Concurrency: one trial at a time.
- Retries: zero.
- Work deadline: 120 seconds after RPC readiness.
- Fixture: a fresh generated identical fixture for each paired arm.
- Evaluator: fixed evidence rubrics plus evaluator-owned `node --test` for mutation.

The redacted raw result is [`2026-08-24_pi-subagents-v1-v2-capability-result.json`](2026-08-24_pi-subagents-v1-v2-capability-result.json).

The protocol and interpretation rules are in [`pi-subagents-v1-v2-capability-protocol.md`](pi-subagents-v1-v2-capability-protocol.md).

## Common-workload results

| Metric | `pi-subagents` | `pi-subagents-v2` |
| --- | ---: | ---: |
| Successful trials | 4 / 4 | 4 / 4 |
| Mean evidence score | 1.000 | 1.000 |
| Tool compliance | 4 / 4 | 4 / 4 |
| Completion coverage | 4 / 4 | 4 / 4 |
| Median readiness | 659 ms | 249 ms |
| Median work latency | 28.476 s | 24.834 s |
| Timeouts | 0 | 0 |
| Protocol errors | 0 | 0 |

Every mutation trial passed an independent `node --test test/math.test.mjs` run after the parent completed.

No final answer appeared before its required wait or consultation result.

## Paired latency observations

| Workload | v1 work latency | v2 work latency | Observed v2 delta |
| --- | ---: | ---: | ---: |
| `single-research` | 21.012 s | 18.450 s | -12.2% |
| `parallel-research` | 21.335 s | 18.193 s | -14.7% |
| `consult-review` | 35.617 s | 31.217 s | -12.4% |
| `worker-fix` | 35.948 s | 31.336 s | -12.8% |

The v1 median readiness was 2.64 times the v2 median in this source-entrypoint run.

The readiness difference is consistent with v1 loading a much larger TypeScript feature graph, while v2 loads a small five-tool source runtime.

The work-latency pattern is directionally favorable to v2, but it may reflect stochastic provider generation, prompt-prefix size, provider load, or orchestration overhead.

The sample has no confidence interval and cannot distinguish those causes.

## Capability coverage

Both packages passed the tested common primitives:

- one bounded background explorer;
- two concurrent independent explorers;
- one synchronous read-only consultation;
- one bounded shared-workspace writer;
- intentional waiting without polling;
- parent synthesis and deterministic verification; and
- terminal result visibility without premature finalization.

Only v1 currently provides the following maintained capability groups:

- retained follow-up conversations and queue-only mailboxes;
- blocking chains, fan-in, panels, workflow DAGs, and managed verification;
- subprocess, in-process, RPC, and automatic transport selection;
- durable logical history and semantic revalidation;
- opt-in idle-parent wake for required completions;
- structured-v2 results, delegation contracts, capability grants, and exact-tree acceptance; and
- extension-owned settings, diagnostics, status, and local usage recording.

V2 intentionally omits those groups and uses one isolated subprocess per bounded job.

This is a product-scope difference rather than a failed benchmark assertion.

## Cost limitation

The recorded parent-visible costs were `0.508` for v1 and `0.173` for v2.

Those values are not comparable totals.

V1 propagates nested child usage into parent accounting, while v2 currently does not propagate child subprocess usage into parent session statistics.

No cost-efficiency conclusion is valid until the harness measures provider usage outside both extensions or v2 reports nested usage consistently.

## Harness audit

The first attempted live run exposed that Pi RPC acknowledges `prompt` before the agent settles.

The runner originally stopped after that acknowledgement, so the resulting zero-score records were discarded as harness failures.

The runner now waits for the required final-marker `message_end` after prompt acceptance.

The next run exposed a rubric false negative because the model correctly rendered `49152` as the TypeScript numeric literal `49_152`.

The scorer now normalizes separators between digits, and a regression test covers the case.

The final run reported here occurred after both harness corrections.

## Recommendation

Use `pi-subagents-v2` when the desired contract is exactly one bounded job or read-only consultation and the main agent owns all coordination, integration, and verification.

Use `pi-subagents` when work needs retained follow-ups, persistence, automatic wake-up, transport selection, workflow orchestration, structured acceptance, or operational settings and diagnostics.

Do not use this quick run to remove v1, change defaults, publish v2 as stable, or claim lower total cost.

A confirmatory comparison should preregister at least five repetitions, add broader repository tasks, capture total parent and child provider usage uniformly, and report paired uncertainty intervals.
