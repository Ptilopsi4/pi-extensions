# Coding-Agent Subagents: Evidence Catalog

> **Historical research input:** This catalog records research available through 2026-08-10 and does not define current `pi-subagents` behavior.
> See the [research synthesis](coding-agent-subagents-research.md) for design conclusions and the [current direction](../../packages/pi-subagents/docs/implementation-notes/pi-subagents-current-direction.md) for maintained product behavior.

## Purpose and method

This document gives each retained paper one canonical evidence entry.

It consolidates the earlier arXiv survey, engineering notes, evidence audit, architecture deep dive, and AlphaXiv orchestration, collaboration, and verification reviews.

AlphaXiv discovery and PDF queries were used for the original searches, while venue and DOI claims were checked against official publication pages where available.

Recent 2026 papers are often preprints and should be treated as preliminary until replicated.

No factual result below was independently reproduced as part of this review.

## Evidence labels

- **Direct evidence** means a method, result, or limitation reported by the paper.
- **Paper-author claim** means the authors' interpretation of their measurements.
- **Audit inference** means a conclusion drawn from protocol comparison or external-validity review.
- **Confidence** applies only to the narrow subagent claim described here, not to the paper's overall quality.

Task tags distinguish repository maintenance, repository generation, function-level code, tool workflows, general reasoning, simulation, and security probes.

## Baseline fairness

A strong comparison should control:

- model version and reasoning setting;
- issue text, hints, repository state, tests, and external information;
- harness, prompt, tools, patch extraction, and stopping behavior;
- total calls, input and output tokens, dollars, wall-clock time, retries, and samples;
- evaluator, task pairing, seeds, and confidence intervals.

A same-model comparison is not automatically a matched-budget or matched-harness comparison.

A multi-agent system that consumes several generations should also be compared with equal-budget best-of-N or self-consistency.

No explicit repository-scale parent-subagent study in this catalog controls every dimension above.

## Repository coding and delegation

### AgentCoder

- **Source:** [AgentCoder: Multi-Agent Code Generation with Effective Testing and Self-optimisation](https://arxiv.org/abs/2312.13010), arXiv v3 dated 2024-05-24.
- **Task:** Function-level HumanEval and MBPP code generation.
- **Mechanism:** A programmer, independent test designer, and test executor iterate until tests pass or the budget ends.
- **Direct evidence:** With GPT-4, the paper reports 96.3% pass@1 on HumanEval and 91.8% on MBPP, while the independent tests report roughly 90% accuracy and more than 91% line coverage.
- **Caveat:** The tasks do not establish repository-scale integration or parallel speedups.
- **Confidence:** Medium for independent test generation and low for repository delegation.

### MAGIS

- **Source:** [MAGIS: LLM-Based Multi-Agent Framework for GitHub Issue Resolution](https://arxiv.org/abs/2403.17927), arXiv v2 dated 2024-06-27.
- **Task:** An early 25% SWE-bench subset.
- **Mechanism:** Repository localization, manager decomposition, developer agents, and QA review form a hierarchy.
- **Direct evidence:** MAGIS reports 13.94% resolution versus 1.74% for direct GPT-4, with 97.39% patch applicability.
- **Baseline caveat:** The full system receives oracle modified files and pull-request hints and is not matched for calls, tokens, cost, latency, or QA iterations.
- **Audit inference:** The result supports engineered repository workflow but does not isolate a causal benefit from agent count.
- **Confidence:** Low for delegation advantage.

### MASAI

- **Source:** [MASAI: Modular Architecture for Software-engineering AI Agents](https://arxiv.org/abs/2406.11638), dated 2024-06-17.
- **Task:** 300 SWE-bench Lite issues from 11 Python repositories.
- **Mechanism:** Five fixed subagents generate a test template, reproduce the issue, localize edits, produce five patches, and rank them.
- **Direct evidence:** MASAI reports 28.33% resolution, 75.0% file localization, 95.33% patch application, and $1.96 average cost.
- **Direct evidence:** Random candidate selection reaches 22.28%, model ranking without the generated test reaches 23.33%, and reproduction-test ranking reaches 28.33%.
- **Caveat:** The pipeline lacks a same-model equal-budget single-agent or best-of-five control.
- **Confidence:** Medium for test-guided modularity and low for dynamic delegation.

### Co-Coder

- **Source:** [When Parallelism Pays Off: Cohesion-Aware Task Partitioning for Multi-Agent Coding](https://arxiv.org/abs/2606.00953), dated 2026-05-31.
- **Task:** 28 from-scratch Python repository-generation tasks over three runs per repository.
- **Mechanism:** A weighted dependency graph isolates hubs, groups strongly coupled files, schedules ready groups, and routes test failures to the owning group.
- **Direct evidence:** DevEval improves from 56.8% to 68.1%, 800 to 442 seconds, and $0.25 to $0.18 relative to sequential OpenHands.
- **Direct evidence:** CodeProjectEval improves from 20.1% to 34.1%, 2,756 to 1,315 seconds, and $1.03 to $0.67.
- **Direct evidence:** Naive file parallelism costs 44% to 60% more than sequential execution for small quality gains, while nearly complete coupling collapses the schedule toward sequential work.
- **Caveat:** The projects average 3.1 or 11.9 files and are generated from scratch rather than repaired as mature repositories.
- **Confidence:** High for bounded cohesion-aware generation and medium-low for general repository maintenance.

### Effective Strategies for Asynchronous SWE Agents

- **Source:** [Effective Strategies for Asynchronous SWE Agents](https://arxiv.org/abs/2603.21489).
- **Task:** Commit0 and PaperBench repository work.
- **Mechanism:** A manager builds a dependency graph, groups strongly dependent work, dispatches ready nodes under a concurrency limit, and integrates through one main branch.
- **Direct evidence:** The paper reports gains up to 14.7 points on Commit0 and 25.6 points on PaperBench over its single-agent baseline.
- **Direct evidence:** Performance improves from two to four workers and then declines at eight as integration overhead grows.
- **Direct evidence:** Worktrees beat instruction-only soft isolation, while manager review beats worker self-verification at higher time cost.
- **Caveat:** Integration and verification remain sequential bottlenecks, so parallel implementation does not guarantee lower wall-clock time.
- **Confidence:** Medium for dependency-aware scheduling and worktree isolation.

### Recursive Agent Harnesses

- **Source:** [Recursive Agent Harnesses](https://arxiv.org/abs/2606.13643), dated 2026-06-11.
- **Task:** 199 synthetic long-context Oolong tasks rather than repository repair.
- **Mechanism:** A parent launches complete tool-bearing harnesses with fresh contexts, isolated workspaces, structured JSON results, and bounded recursive spawning.
- **Direct evidence:** GPT-5 RAH reports 81.36% versus a published Codex-style baseline of 71.75% and a recursive-language-model baseline of 64.38%.
- **Baseline caveat:** The Codex baseline was imported rather than rerun, and the reported interval bootstraps only RAH outcomes against a fixed baseline estimate.
- **Caveat:** Exact cost and latency were not instrumented, and context isolation, recursion depth, grouping, and spawn policy were not separately ablated.
- **Confidence:** Medium for long-context delegation and low for repository coding.

### SWARMRESEARCH

- **Source:** [SWARMRESEARCH: Orchestrating Coding Agents for Open-Ended Discovery](https://arxiv.org/abs/2607.02807), dated 2026-07-02.
- **Task:** 15 open-ended mathematics, systems, and optimization tasks plus five controlled scaling tasks.
- **Mechanism:** A Shepherd selects parent branches and explorer or optimizer agents while controlling breadth and depth.
- **Direct evidence:** The system matches or exceeds EvoX and CORAL on 13 of 15 tasks and beats the best tested fixed scaling strategy on four of five controlled tasks.
- **Baseline caveat:** Main comparisons use one stochastic run, different model and budget conditions, and non-converged search.
- **Reporting caveat:** The speculative-decoding result reaches 4.58 times vanilla throughput at 60.6% accuracy after roughly 11 hours of analysis plus 11 hours of generation, so it is not matched-time dominance over the approximately 12-hour compared runs.
- **Confidence:** Low to medium for open-ended branch exploration.

### CodeDelegator

- **Source:** [CodeDelegator](https://arxiv.org/abs/2601.14914), dated 2026-01-21.
- **Task:** tau2-bench and MCPMark tool workflows rather than repository coding.
- **Mechanism:** A persistent delegator creates fresh ephemeral coder agents with isolated execution contexts and structured artifacts.
- **Direct evidence:** With DeepSeekV3.2, CodeDelegator reports gains over ReAct on retail, airline, and aggregate MCPMark, but loses on PostgreSQL workflows.
- **Baseline caveat:** Interaction allowances differ substantially and total token, cost, and wall-clock use are not reported.
- **Confidence:** Medium for isolated sequential delegation architecture and low for coding advantage.

### From-Scratch Multi-Agent Coding Coordination Study

- **Source:** [An Empirical Study of Coordination Mode as the First-Class Citizen in From-Scratch Multi-Agent Coding](https://arxiv.org/abs/2607.27877), dated 2026-07-30.
- **Task:** Ten full-stack capstone-style repository specifications across ten four-agent topologies.
- **Mechanism:** Isolated resumable agents, status synchronization, targeted messages, shared repositories, deployment, and deterministic repair feedback.
- **Direct evidence:** Coordination topology shifts functional scores by more than 30 points and can double wall-clock time under fixed tasks and models.
- **Caveat:** The projects and deployment infrastructure do not represent mature repository maintenance.
- **Confidence:** Medium for topology sensitivity and low for a universal topology ranking.

### Claw-SWE-Bench

- **Source:** [Claw-SWE-Bench](https://arxiv.org/abs/2606.12344), dated 2026-06-10.
- **Task:** 350 issue-resolution tasks across eight languages and 43 repositories.
- **Mechanism:** A fixed outer protocol separates model, harness, task, and cost effects.
- **Direct evidence:** With the same GLM 5.1 model, a bare direct-diff adapter scores 19.1% while a full repository-editing adapter scores 73.4%.
- **Audit inference:** Harness effects can exceed most claimed multi-agent gains, so cross-paper comparisons are not causal without matched tooling and patch extraction.
- **Caveat:** The study reports one run per cell.
- **Confidence:** High for harness-confound evidence.

## Routing, orchestration, and cost

### Single-Agent or Multi-Agent Systems? Why Not Both?

- **Source:** [Single-agent or Multi-agent Systems? Why Not Both?](https://arxiv.org/abs/2505.18286).
- **Task:** Fifteen tasks across seven application types and nine frameworks, including HumanEval, MBPP, and DS1000.
- **Mechanism:** A difficulty router chooses one path, while a cascade runs one agent first and escalates checker failures.
- **Direct evidence:** Single-agent and multi-agent systems agree on pass or fail in about 80% of evaluated cases while multi-agent token use is several to hundreds of times higher in reported settings.
- **Direct evidence:** The checker-gated cascade reaches 94.5% on HumanEval, 84.4% on MBPP, and 71.2% on DS1000, beating both compared paths in those experiments.
- **Caveat:** The cascade depends on a cheap accurate checker and does not directly transfer to open-ended tasks.
- **Confidence:** Medium for conditional routing and cascade design.

### The Illusion of Multi-Agent Advantage

- **Source:** [The Illusion of Multi-Agent Advantage](https://arxiv.org/abs/2606.13003), dated 2026-06-13.
- **Task:** Reasoning, browsing, and 168 SWE-bench Lite tasks across GPT-4o, GPT-5, and Gemini 2.5 Pro.
- **Mechanism:** Six automatic multi-agent frameworks are compared with direct chain-of-thought and five-sample self-consistency.
- **Direct evidence:** On SWE-bench Lite with GPT-5, self-consistency scores 57.09% at $286.40 while automatic systems score 27.23% to 55.97% at $83.50 to $998.20.
- **Direct evidence:** Similar negative automatic-system results appear for GPT-4o and Gemini 2.5 Pro.
- **Paper-author claim:** Role redundancy, functional collapse, and architecture bloat fail to convert additional inference into useful coordination.
- **Caveat:** The result does not rule out carefully hand-designed systems such as Co-Coder or MASAI.
- **Confidence:** High for negative evidence against automatic multi-agent defaults.

### ClawArena-Team

- **Source:** [ClawArena-Team: Benchmarking Subagent Orchestration and Dynamic Workflows](https://arxiv.org/abs/2606.31174), v2 dated 2026-07-02.
- **Task:** 41 multimodal and multi-directory scenarios, 258 rounds, and 72 staged updates.
- **Mechanism:** A text-only manager selects worker modalities, prompts, tools, paths, foreground or background execution, and session reuse from a fixed worker pool.
- **Direct evidence:** The best manager reaches a 60.0% Subagent-Management Score and 74.4% task completion.
- **Direct evidence:** No model exceeds 50% workspace-permission precision, and main-agent API cost varies by more than 100 times.
- **Baseline caveat:** Delegation is mandatory, workers are locally served, and there is no no-subagent matched-budget control.
- **Confidence:** Medium for management diagnostics and permission selection.

### TDAG

- **Source:** [TDAG: A Multi-Agent Framework based on Dynamic Task Decomposition and Agent Generation](https://arxiv.org/abs/2402.10178), published in *Neural Networks* 185 as article 107200.
- **Task:** ItineraryBench, WebShop, and TextCraft rather than repository coding.
- **Mechanism:** A main agent revises unexecuted subtasks after each result, generates task-specific agents, and stores successful methods as retrievable skills.
- **Direct evidence:** TDAG scores 49.08 on ItineraryBench versus 44.74 for ADAPT, while removing agent generation or dynamic decomposition lowers the score to 46.69 or 46.23.
- **Caveat:** The paper does not report tokens, API cost, or wall-clock latency and primarily executes tasks sequentially.
- **Confidence:** Medium-low for dynamic replanning and low for coding latency.

### MasRouter

- **Source:** [MasRouter: Learning to Route LLMs for Multi-Agent Systems](https://arxiv.org/abs/2502.11133), ACL 2025 long paper.
- **Task:** General reasoning, mathematics, and function-level coding.
- **Mechanism:** A trained cascaded controller chooses collaboration mode, roles, agent count, and models under correctness and cost penalties.
- **Direct evidence:** The paper reports up to 52.07% overhead reduction, HumanEval cost reduction from $0.363 to $0.185, and diminishing returns when the maximum grows from six to ten agents.
- **Caveat:** Candidate pools are predefined, training needs computable utility, and repository integration is not evaluated.
- **Confidence:** Medium for cost-aware routing and low for repository routing.

### DynTaskMAS

- **Source:** [DynTaskMAS: A Dynamic Task Graph-driven Framework for Asynchronous and Parallel LLM-based Multi-Agent Systems](https://arxiv.org/abs/2503.07675), ICAPS 2025.
- **Task:** Controlled travel planning on Llama-3.1-8B and four RTX 3090 GPUs.
- **Mechanism:** A dynamic DAG, ready-node scheduler, semantic context manager, and adaptive workflow manager track load and latency.
- **Direct evidence:** Reported execution-time reductions range from 21.3% to 33.0%, while throughput scales 3.47 times from four to sixteen agents before contention reduces marginal benefit.
- **Caveat:** The paper does not evaluate repository correctness, remote API conditions, or mature coding workloads.
- **Confidence:** Medium for scheduler mechanics and low for coding quality.

### AgentPrune

- **Source:** [Cut the Crap: An Economical Communication Pipeline for LLM-based Multi-Agent Systems](https://arxiv.org/abs/2410.02506), ICLR 2025.
- **Task:** General reasoning, mathematics, and HumanEval.
- **Mechanism:** Policy-gradient graph masks and low-rank regularization prune spatial and temporal communication edges.
- **Direct evidence:** The paper reports token reductions of 28.1% to 72.8% and comparable-quality cost near $5.60 versus $43.70 for compared topologies.
- **Caveat:** Optimization itself costs model interactions, the method generally needs more than three agents, and the pruned topology is fixed after training.
- **Confidence:** Medium for communication redundancy and low for runtime coding policy.

### GPTSwarm

- **Source:** [GPTSwarm: Language Agents as Optimizable Graphs](https://arxiv.org/abs/2402.16823), ICML 2024 Oral.
- **Task:** MMLU, Mini Crosswords, and GAIA.
- **Mechanism:** Prompts, tools, and model calls form graph nodes while REINFORCE searches edge connectivity offline.
- **Direct evidence:** Some graph searches are cheaper than compared optimization, but Mini Crosswords consumes more than 50 million prompt tokens and $77.42.
- **Direct evidence:** GAIA latency rises from about 71 seconds for one Tree-of-Thought agent to 199 seconds for three and 415 seconds for seven.
- **Caveat:** Optimization is expensive and no universal topology transfers across tasks.
- **Confidence:** Medium for offline graph search and strong evidence that more agents do not imply lower latency.

## Context, state, integration, and completion

### OrchBench

- **Source:** [OrchBench: Evaluating Multi-Agent Orchestration Plans in Isolation via Deterministic Simulation](https://arxiv.org/abs/2607.25656), dated 2026-07-28.
- **Task:** 240 generated DAGs with limited Claude Code and MultiAgentBench validation.
- **Mechanism:** A simulator evaluates assignment, dependency transfers, compression, quality, critical path, and token efficiency without executing workers during benchmark scoring.
- **Direct evidence:** Simulated quality correlates with six real-execution model points at Pearson 0.816 with p=0.047, while simulated time and token use do not correlate reliably with real consumption.
- **Direct evidence:** The simulated multi-agent advantage falls from 0.302 at 16K context to 0.007 at 128K, and one selected handoff raises real score from 3.754 to 4.150 out of five on 20 tasks.
- **Caveat:** Task decomposition is supplied and resource effects are simulator-defined.
- **Confidence:** Medium-low for plan screening and low for real coding outcomes.

### OrchestraBench

- **Source:** [OrchestraBench: Evaluating Multi-Agent Orchestration Failure Modes, Recovery, and Decomposition Quality](https://arxiv.org/abs/2608.05263), dated 2026-08-05.
- **Task:** Synthetic arithmetic chains and 26 author-labelled routing cases.
- **Mechanism:** Controlled routing, delegation, tool, context, conflict, and premature-action faults are injected into staged workflows.
- **Direct evidence:** Tool faults recover at 1.00, ambiguous delegation at 0.30, and context pollution, conflicting state, and premature success at 0.00 in the main probe.
- **Direct evidence:** Mean latent-failure cascade radius grows from about 0.9 at depth three to 4.7 at depth seven.
- **Caveat:** The core chain is executed by one Claude agent rather than a literal concurrent multi-agent system.
- **Confidence:** Medium for failure-injection design and low for production subagent recovery rates.

### Semantic Snapshot Isolation

- **Source:** [Semantic Snapshot Isolation](https://arxiv.org/abs/2608.05412).
- **Task:** Controlled LangGraph and Qdrant semantic-resource concurrency.
- **Mechanism:** Prompt, model, index, tool, resource, and contract versions remain sticky across retries, resumes, children, and forks, and branch manifests are validated before merge.
- **Direct evidence:** The prototype blocks reproduced semantic read, compatibility, context, and merge skew with reported microsecond-scale resolution and merge validation.
- **Caveat:** It protects semantic resource versions rather than repository writes or external effects.
- **Confidence:** Medium for semantic version pinning.

### STORM

- **Source:** [STORM](https://arxiv.org/abs/2605.20563).
- **Task:** Commit0 and PaperBench parallel coding.
- **Mechanism:** A shared workspace records monotonic file versions and complete read sets and rejects writes when targets or dependencies changed.
- **Direct evidence:** On Commit0 with Claude Sonnet, STORM reports 82.5 macro and 46.2 weighted versus 66.4 and 20.7 for one agent and 63.8 and 24.6 for Git worktrees.
- **Direct evidence:** Worktrees still win when task decomposition aligns cleanly with file boundaries.
- **Caveat:** Coupling strata use proxy labels, and the shared state depends on complete mediation of reads and writes.
- **Confidence:** Medium for versioned shared-state benefits.

### CoAgent

- **Source:** [CoAgent](https://arxiv.org/abs/2606.15376).
- **Task:** Ten contended tool-effect pairs over 100 trials.
- **Mechanism:** Launch order, declared read/write footprints, inverse actions, order-filtered reads, invalidation notices, undo, and replay coordinate effects.
- **Direct evidence:** Serial execution reaches 98% correctness, naive parallelism 13%, two-phase locking 96%, optimistic control 93%, and CoAgent 93%.
- **Direct evidence:** CoAgent reaches 1.43 times serial speed at 1.15 times cost, while five failures arise from agents misjudging notification relevance.
- **Caveat:** Semantic relevance remains inside an unreliable model decision.
- **Confidence:** Medium for ordering mechanics.

### Claim Plane

- **Source:** [Claim Plane](https://arxiv.org/abs/2607.21909).
- **Task:** A preliminary six-pair, one-seed CooperBench study.
- **Mechanism:** A versioned change intent binds an exact base commit, operations, dependencies, preservation policy, tests, lease, fencing token, and immutable patch.
- **Direct evidence:** Static Claim Plane passes all six pairs by serializing all six, while dynamic Claim Plane passes four after integration and serializes three.
- **Caveat:** The authors state that the sample is too small for comparative performance claims and that enforcement can be bypassed outside the broker.
- **Confidence:** Medium for protocol design and low for performance.

### Proof-or-Stop

- **Source:** [Proof-or-Stop](https://arxiv.org/abs/2607.14890).
- **Task:** Engine scenarios, tamper classes, and a large protocol ablation grid.
- **Mechanism:** Completion receipts bind freshness, completeness, integrity, producer authorization, execution attestation, current material hashes, commands, arguments, exit status, and output digests.
- **Direct evidence:** The paper reports zero false completion states and zero false accepts across ten scenarios and 18 tamper classes.
- **Direct evidence:** In a 9,240-cell ablation, visible-pass and hidden-fail amplification falls from 31 cases for a naive loop and 14 for an advisory reviewer to two for the gated protocol.
- **Caveat:** These controlled protocol results require every relevant completion path to use the gate.
- **Confidence:** Medium-high for evidence-bound completion mechanics.

### SHEPHERD

- **Source:** [SHEPHERD](https://arxiv.org/abs/2605.10913).
- **Task:** Supervised agent execution and 479 CooperBench pairs.
- **Mechanism:** Typed tasks, effects, and scopes support atomic forks, discard, rollback, compensation, intervention, and immutable traces without inflating worker context.
- **Direct evidence:** With Claude Haiku workers, unsupervised cooperation scores 28.8%, solo execution 57.2%, Sonnet supervision 45.3%, and Opus supervision 54.7%.
- **Direct evidence:** Scope fork and revert for a 5.8 GB image take roughly 143 and 147 milliseconds in the reported environment.
- **Caveat:** Irreversible effects cannot be rolled back and guarantees depend on the sandbox backend.
- **Confidence:** Medium for supervision and reversible lifecycle control.

### Software Delegation Contracts

- **Source:** [Software Delegation Contracts: Measuring Reviewability in AI Coding-Agent Work](https://arxiv.org/abs/2606.17099), dated 2026-06-14.
- **Task:** 64 runs over ten small TypeScript tasks in an approximately 600-line repository.
- **Mechanism:** Contracts specify objectives, non-goals, authority, expected tests, evidence, and acceptance context.
- **Direct evidence:** Every condition passes hidden checks, while contracts improve evidence sufficiency by 0.83 on a five-point scale and improve 22 of 30 paired reviewability comparisons.
- **Direct evidence:** Contracts add 13% tokens, 38.3% wall-clock time, and 23.3% tool invocations.
- **Caveat:** Objective outcomes saturate and model reviewers replace human reviewers.
- **Confidence:** Medium for reviewability and low for correctness improvement.

## Collaboration, debate, and verification

### MAST

- **Source:** [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657), NeurIPS 2025 Datasets and Benchmarks Track.
- **Task:** 1,642 traces from seven systems across coding, mathematics, and general-agent work.
- **Mechanism:** Fourteen failure modes are grouped into system design, inter-agent misalignment, and task verification.
- **Direct evidence:** Pooled failure labels assign 44.2% to system design, 32.3% to inter-agent misalignment, and 23.5% to verification, with taxonomy-development agreement of kappa 0.88.
- **Direct evidence:** Reported failure rates range from 41.0% to 86.7%, and ChatDev authority or objective-verification interventions improve success in small from-scratch studies.
- **Caveat:** Only 30 traces cover SWE-bench Lite, and most large-scale labels come from an LLM annotator.
- **Confidence:** Medium for the general failure taxonomy and low for coding-specific rates.

### CooperBench

- **Source:** [CooperBench](https://arxiv.org/abs/2601.13295), dated 2026-01-26.
- **Task:** 652 paired-feature tasks across 12 repositories in Python, TypeScript, Go, and Rust.
- **Mechanism:** Two isolated agents work in separate containers and branches, may communicate through SQL-backed messages, and have their patches merged and tested.
- **Direct evidence:** GPT-5 scores 48% solo versus 28% with two agents, Claude Sonnet 4.5 scores 47% versus 26%, and MiniMax-M2 scores 36% versus 14%.
- **Direct evidence:** Communication reduces raw conflicts without significantly improving final success, and a 46-task subset falls from 68.6% with two agents to 46.5% with three and 30.0% with four.
- **Caveat:** Teams have more aggregate action capacity, so this is strong negative coordination evidence rather than an equal-budget parent-subagent test.
- **Confidence:** High for semantic coordination failure.

### Improving Multi-Agent Debate with Sparse Communication Topology

- **Source:** [Improving Multi-Agent Debate with Sparse Communication Topology](https://aclanthology.org/2024.findings-emnlp.427/), Findings of EMNLP 2024, with [arXiv:2406.11776](https://arxiv.org/abs/2406.11776).
- **Task:** Mathematics, multimodal reasoning, and preference labelling.
- **Mechanism:** Six-agent regular graphs restrict each agent to previous-round answers from selected neighbours before majority aggregation.
- **Direct evidence:** A sparse neighbour topology scores about two points higher than full connectivity on MATH, matches GSM8K, and cuts reasoning input tokens by more than 40%.
- **Caveat:** Static graphs, small samples, and non-coding tasks do not establish a production coding topology.
- **Confidence:** Medium for communication sparsity under debate workloads.

### ReConcile

- **Source:** [ReConcile: Round-Table Conference Improves Reasoning via Consensus among Diverse LLMs](https://aclanthology.org/2024.acl-long.381/), ACL 2024 long paper, with [arXiv:2309.13007](https://arxiv.org/abs/2309.13007).
- **Task:** Seven reasoning benchmarks.
- **Mechanism:** Heterogeneous models answer independently, exchange grouped explanations and recalibrated confidence, and stop at consensus or three rounds.
- **Direct evidence:** The maximum reported improvement is 11.4 points, with diversity across model families identified as the most important ablated component.
- **Caveat:** Samples are often small, models are older, confidence is self-reported, and human-written corrective examples assist the strongest configuration.
- **Confidence:** Medium for heterogeneous independent generation and low for coding consensus.

### Persuasion-Driven Adversarial Influence

- **Source:** [When collaboration fails: persuasion driven adversarial influence in multi agent large language model debate](https://www.nature.com/articles/s41598-026-42705-7), *Scientific Reports* 16.
- **Task:** Controlled synchronous text debates.
- **Mechanism:** One adversarial agent uses history, counterarguments, refinement, best-of-N selection, and RAG to package an incorrect answer persuasively.
- **Direct evidence:** The paper reports accuracy drops of 10% to 40% and more than 30% additional consensus on an incorrect answer.
- **Caveat:** The study demonstrates risk but not a complete defense and does not model coding tools or permission boundaries.
- **Confidence:** Medium for persuasion and correlated-error risk.

### Silence Is Not Consensus

- **Source:** [Silence is Not Consensus: Disrupting Agreement Bias via a Catfish Agent](https://arxiv.org/abs/2505.21503), 2025 preprint.
- **Task:** Medical question answering and visual question answering.
- **Mechanism:** A dissenting agent challenges premature agreement, missing justification, ignored alternatives, and contradictions with risk-adjusted intensity.
- **Direct evidence:** A MedQA ablation reduces intermediate silent agreement from 61.8% to 17.1% and raises accuracy from 36% to 50%.
- **Caveat:** The work is a preprint, increases inference cost, and includes cases where the moderator rejects valid dissent.
- **Confidence:** Low to medium for structured dissent.

### Selective Agreement, Not Sycophancy

- **Source:** [Selective agreement, not sycophancy: investigating opinion dynamics in LLM interactions](https://link.springer.com/article/10.1140/epjds/s13688-025-00579-1), *EPJ Data Science* 14.
- **Task:** A 140-agent opinion simulation over one topic.
- **Mechanism:** Agents receive persuasive messages and a classifier identifies several fallacy classes.
- **Direct evidence:** Roughly 75% to 78% of Llama discussants and 60% to 61% of Mistral discussants change after fallacious messages under the tested formulations.
- **Caveat:** Small models, one topic, classifier error, and synthetic opinion dynamics limit coding relevance.
- **Confidence:** Low for coding and medium-low for message-provenance risk.

### Large Language Models Cannot Self-Correct Reasoning Yet

- **Source:** [Large Language Models Cannot Self-Correct Reasoning Yet](https://openreview.net/forum?id=IkmD3fKBPQ), ICLR 2024, with [arXiv:2310.01798](https://arxiv.org/abs/2310.01798).
- **Task:** GSM8K, CommonSenseQA, and HotpotQA.
- **Mechanism:** Intrinsic reflection without external information is compared with externally guided correction and equal-response debate or sampling.
- **Direct evidence:** GPT-4 GSM8K accuracy falls from 95.5% to 89.0% after two intrinsic correction rounds, and equal-response debate does no better than self-consistency.
- **Caveat:** The evidence covers selected reasoning tasks and older models rather than all review workflows.
- **Confidence:** Medium for rejecting ungrounded self-review as verification.

### Red-Teaming Multi-Agent Communication

- **Source:** [Red-Teaming LLM Multi-Agent Systems via Communication Attacks](https://aclanthology.org/2025.findings-acl.349/), Findings of ACL 2025, with [arXiv:2502.14847](https://arxiv.org/abs/2502.14847).
- **Task:** AutoGen, CAMEL, HumanEval, MBPP, MMLU, and MetaGPT.
- **Mechanism:** An agent-in-the-middle intercepts and rewrites messages sent to one victim and refines attacks from prior attempts.
- **Direct evidence:** Attack success exceeds 40% in every reported framework, dataset, topology, and objective combination and exceeds 70% in most cases.
- **Caveat:** The attacker is assumed to intercept one communication channel, and the paper does not evaluate a complete authenticated capability-isolated defense.
- **Confidence:** Medium-high for treating handoffs as untrusted input.

### More Agents Is All You Need

- **Source:** [More Agents Is All You Need](https://openreview.net/forum?id=bgzUSZ8aeg), TMLR 2024, with [arXiv:2402.05120](https://arxiv.org/abs/2402.05120).
- **Task:** GSM8K, MATH, Chess, MMLU, HumanEval, and other reasoning tasks.
- **Mechanism:** Independent samples are aggregated by majority vote without role specialization or communication.
- **Direct evidence:** Accuracy usually rises with sample count on moderately difficult tasks, while HumanEval debate can introduce code-logic noise.
- **Caveat:** Token use grows approximately linearly and the method is ensembling rather than a stateful subagent architecture.
- **Confidence:** Medium for independent sampling and low for team coordination.

### Equal Thinking Token Budgets

- **Source:** [Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets](https://arxiv.org/abs/2604.02460), dated 2026-04-11.
- **Task:** FRAMES and MuSiQue across Qwen3, DeepSeek-R1-Distill-Llama, and Gemini 2.5.
- **Mechanism:** Sequential, subtask-parallel, role-parallel, debate, and ensemble systems are compared with one agent under nominal thinking-token budgets.
- **Direct evidence:** At 1,000 tokens, the cross-setting average is 0.418 for one agent versus 0.388 for the strongest multi-agent average, while at 2,000 it is 0.421 versus 0.403.
- **Caveat:** Actual provider token accounting often misses requested budgets and no coding tasks are included.
- **Confidence:** Medium for matched-budget methodology and low for coding outcomes.

### Paired Coordination Noise Floor

- **Source:** [How Much Coordination Gain Is Real?](https://arxiv.org/abs/2606.20695), dated 2026-06-15.
- **Task:** Two 100-task seeds on tau2-bench retail.
- **Mechanism:** Configuration-equivalent paired protocols estimate ordinary benchmark variation.
- **Direct evidence:** A positive 18-point single-seed contrast reverses to negative three points on the second seed, while the pooled gap is five points with a 95% interval from negative two to positive twelve.
- **Caveat:** The estimate is local to one model, domain, harness, and protocol.
- **Confidence:** Medium for replication and paired-analysis requirements.

## Authority and inheritance

### When Child Inherits

- **Source:** [When Child Inherits](https://arxiv.org/abs/2605.08460), dated 2026-05-08.
- **Task:** Security proofs of concept across OpenClaw, Agent Zero, and Hermes with a five-model sweep.
- **Mechanism:** The study exercises full parent-memory inheritance, excessive child tools, post-spawn state divergence, and unauthorized sibling termination.
- **Direct evidence:** The paper reports reproduction of core OpenClaw attacks across MiniMax, Llama, Qwen, DeepSeek, and GPT-5.2 Codex models.
- **Caveat:** The work provides no coding-quality or matched task-success comparison.
- **Confidence:** Medium for inheritance failure surfaces.

### SkillScope

- **Source:** [SkillScope](https://arxiv.org/abs/2605.05868).
- **Task:** 200 manually annotated and 68,312 valid real-world reusable agent skills.
- **Mechanism:** An instruction-and-action graph removes candidate actions by replay and conditions reachability on the task.
- **Direct evidence:** SkillScope reports 94.53% F1 for privilege needs and an 88.56% reduction in triggered over-privileged action-task instances while preserving evaluated legitimate tasks.
- **Caveat:** Reusable skills are not repository-editing subagents, and the benchmark does not define a coding-agent sandbox policy.
- **Confidence:** Medium for task-conditioned capability minimization.

## Evidence-quality summary

| Evidence area | Strongest positive evidence | Strongest contrary or limiting evidence | Practical conclusion |
| --- | --- | --- | --- |
| Repository parallelism | Co-Coder and asynchronous SWE-agent scheduling. | CooperBench and naive file parallelism. | Partition by cohesion and dependencies, not file count or agent count. |
| Dynamic delegation | RAH for long-context aggregation and SWARMRESEARCH for open-ended search. | Unmatched budgets, synthetic tasks, and automatic-MAS losses. | Delegate conditionally and do not generalize to repository repair. |
| Modular verification | MASAI, AgentCoder, manager review, and Proof-or-Stop. | Ungrounded self-correction and shared model blind spots. | Prefer fresh evidence and current-tree deterministic checks. |
| Communication | Sparse debate and ReConcile under selected reasoning tasks. | CooperBench, persuasion attacks, and communication attacks. | Start independently and exchange bounded typed evidence. |
| Routing and cost | Hybrid routing, MasRouter, and plan screening. | High router training cost, checker dependence, and simulator mismatch. | Start with interpretable admission rules and local evaluation. |
| State and integration | STORM, CoAgent, Claim Plane, and semantic snapshots. | Bypassable brokers and unsafe semantic judgments. | Combine workspace isolation with version checks and centralized integration. |
| Authority | ClawArena-Team diagnostics, SkillScope, and child-inheritance attacks. | Capability declarations do not create enforcement. | Bind minimal grants to task and lifecycle through a trusted broker. |
| Evaluation validity | Illusion of Multi-Agent Advantage, Claw-SWE-Bench, and paired noise-floor work. | Single runs and heterogeneous harnesses remain common. | Use paired repeated matched baselines and report all resource boundaries. |

## Search and coverage limitations

The original discovery searches were ranked rather than exhaustive.

AlphaXiv does not cover every peer-reviewed venue, product evaluation, unpublished negative result, or industry telemetry source.

Several papers changed titles, versions, tables, or venue status after initial arXiv publication.

This consolidation preserves primary links and material caveats but removes raw search payloads and repeated discovery-result lists.

Git history remains the record of the original query transcripts and longer paper-by-paper notes.

Reported dollar costs are not directly comparable across model providers, dates, cache policies, local workers, and accounting boundaries.

A low confidence grade here means weak support for the narrow coding-subagent claim rather than evidence that the paper's internal measurements are false.
