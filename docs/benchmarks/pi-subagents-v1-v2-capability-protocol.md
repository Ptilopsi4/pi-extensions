# Pi Subagents v1/v2 Capability Benchmark Protocol

This protocol is retired because its synchronous capability arms and runner were removed.

This file remains historical design evidence only.

## Purpose

This benchmark compares the stable `pi-subagents` runtime with the experimental `pi-subagents-v2` runtime.

It reports advanced capability coverage separately from performance on common delegation primitives.

It does not turn intentional v2 omissions into failed live tasks or turn a larger v1 feature surface into an automatic quality claim.

## Capability coverage

Both packages provide bounded background start, inspection, cancellation, waiting, read-only consultation, one guarded terminal completion, user and trusted-project agent discovery, subprocess execution, and session cleanup.

Only `pi-subagents` provides retained follow-up turns, mailboxes, blocking chains, fan-in, panels, workflow DAGs, managed verification, multiple transports, durable history, semantic revalidation, opt-in idle-parent wake, structured contracts, worktree workflows, settings, diagnostics, and local usage recording.

`pi-subagents-v2` intentionally limits itself to five tools and one subprocess per bounded job.

The runner embeds a source-backed matrix with evidence labels from package source, focused tests, maintained capability notes, and package limitations.

The matrix is descriptive and is not reduced to a weighted score because no user-value weights were supplied.

## Live workloads

The quick protocol runs one paired trial for each workload.

| Workload | Shared behavior under test | Deterministic acceptance |
| --- | --- | --- |
| `single-research` | Start one background explorer, continue bounded parent work, wait once, and synthesize three facts. | Three exact path, symbol, and value rubric items. |
| `parallel-research` | Start two independent explorers, continue bounded parent work, wait once per job, and synthesize four facts. | Four exact path, symbol, and value rubric items. |
| `consult-review` | Run one synchronous read-only consultation over planted security defects. | Three exact operation and defect rubric items. |
| `worker-fix` | Start one background writer, inspect independent parent context, wait once, and verify the shared fixture. | Three report rubric items plus an evaluator-owned `node --test` run. |

Every arm receives a fresh generated fixture with the same paired fixture identifier.

The fixture contains no repository instructions, skills, prompt templates, or project extensions.

## Matched controls

The protocol fixes the parent model, child model, thinking level, task information, generated repository state, child tool allow-list, parent resource policy, execution deadline, retry count, and evaluator.

The runner starts the work deadline only after the Pi RPC `get_state` readiness handshake succeeds.

Retries are disabled.

Arm order alternates by workload and repetition.

Trials run serially to avoid deliberate provider-load differences between arms.

The parent prompt differs only where each package requires its own tool names and job identifier vocabulary.

The tested extension's full registered tool surface remains visible because surface size is part of the product and Pi does not support benchmark-only tool removal.

Pi does not expose a sampling seed for this path, so paired trials are not seed-matched.

## Metrics

A trial succeeds only when all fixed evidence is present, required tool counts are exact, the required completion precedes the final marker, no premature final is observed, and the mutation fixture check passes when applicable.

The report keeps success rate, mean evidence score, tool compliance, completion coverage, readiness latency, work latency, terminal outcome, and parent-visible session cost separate.

Parent-visible session cost is not a total-cost comparison because `pi-subagents-v2` does not propagate child subprocess usage into the parent session statistics.

The report therefore sets `costComparable` to `false` and forbids an efficiency conclusion from those cost fields.

One repetition per workload is diagnostic and has no useful confidence interval.

Use at least five preregistered repetitions for a directional follow-up and more tasks for a release or default decision.

## Historical status

The active repository no longer contains this protocol's runner, recipe, synchronous capability arms, or historical `pi-subagents-v2` package.

The former commands are intentionally omitted so this archived protocol does not advertise a runnable workflow.

## Interpretation

A common-task win means that one arm completed more fixed tasks under this harness and sample.

It does not prove general model quality, lower total cost, safer authority, or superiority on capabilities absent from the common workload.

A capability-matrix difference means the runtime implements or intentionally omits a maintained feature.

It does not show that every user needs the feature or that the implementation is defect-free.
