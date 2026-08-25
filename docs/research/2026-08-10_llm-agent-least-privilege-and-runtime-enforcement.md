# LLM-Agent Least Privilege and Runtime Enforcement

> **Historical research input:** Role names and automation described here summarize external systems and do not define current `pi-subagents` built-ins or routing; see the [current direction](../../packages/pi-subagents/docs/implementation-notes/pi-subagents-current-direction.md).

## Executive findings

- **Synthesis:** Current LLMs should propose actions and policies, but a separate trusted mechanism should decide whether an authenticated principal authorized the exact operation, resource, arguments, destination, and lifetime.
- **Direct evidence:** AuthBench finds that coding models can omit required permissions while simultaneously exposing sensitive resources, and ToolPrivBench finds that agents may choose broader tools even after appropriate narrower tools were already available.
- **Direct evidence:** AgentDojo and Agent Security Bench show that prompts, tool output, memory, demonstrations, and tool registration are distinct channels through which attacker-controlled data can redirect tool use.
- **Direct evidence:** AgentSpec, Progent, MiniScope, and IsolateGPT demonstrate complementary enforcement points: semantic rules, argument-level privilege policies, scope-backed capabilities, and process or communication isolation.
- **Direct evidence:** R-Judge and ProbGuard show that risk monitoring can identify unsafe trajectories, but both have false-positive, model, timing, or sampling limitations that make monitoring unsuitable as the source of authority.
- **Direct evidence:** ToolEmu shows that harmful behavior also arises without an attacker when a benign request is underspecified and the agent assumes authority that was never clearly granted.
- **Synthesis:** A useful coding-agent security architecture therefore needs capability minimization, complete mediation, isolated execution, safe policy evolution, action-bound confirmation, lifecycle revocation, and independent monitoring.
- **Synthesis:** Headline attack, safety, utility, exposure, and task-success percentages in this corpus have different tasks, denominators, agent models, and success definitions, so they must not be compared as if they measured one common outcome.

## Evidence labels and method

This note synthesizes twelve papers from three full-text research panels and retains the versions, table values, source anchors, and reporting caveats established by those reviews.

**Direct evidence** identifies a design statement, theorem, dataset count, or measurement reported in a primary full-text source.

**Author claim** identifies the paper authors’ interpretation of their evidence.

**Synthesis** identifies a cross-paper inference or a coding-agent design implication.

The latest primary version available on 2026-08-11 is used unless a venue camera-ready paper is the canonical publication.

Older titles are preserved where they identify the requested paper, while renamed current versions are explicitly distinguished.

Derived percentage-point differences and ratios are labeled as synthesis or described as calculations from the cited raw table.

No pooled ranking is calculated across benchmarks because their attack eligibility, tool semantics, task success, safety labels, and intervention policies differ.

## Compact corpus comparison

| Paper | Primary contribution | Authority or safety granularity | Enforcement or measurement point | Main evidence caveat |
|---|---|---|---|---|
| AgentSpec | Runtime policy DSL | Events, state, predicates, actions | Before action, state change, or completion | Protection is limited to specified rules and instrumented hooks |
| Progent | Adaptive privilege policy | Tool names and typed arguments | Every tool call and policy update | Initial policy and approved expansions can still be wrong |
| MiniScope | Least-cost service scopes | OAuth scopes and API methods | Before execution and at every MCP call | Least privilege is relative to coarse scope mappings and a cost model |
| Pro2Guard / ProbGuard | Probabilistic future-risk monitor | Abstract states and temporal properties | Before predicted unsafe reachability | Experimental trace counts do not meet its displayed PAC certification bounds |
| Do Coding Agents Understand Least-Privilege Authorization? | AuthBench policy-generation benchmark | Filesystem read, write, and execute paths | Before downstream execution | Its traced gold policy represents one workflow and omits non-filesystem authority |
| When Lower Privileges Suffice | ToolPrivBench selection benchmark | Ordered tool privilege classes | During tool choice and after transient failure | Tools are simulated, substitutable, and follow a fixed failure pattern |
| LLM Agents Should Employ Security Principles | AgentSandbox position architecture | Context, parameters, messages, and task compartments | Every data exchange and reintegration | The proposed sandbox does not establish OS-level containment |
| IsolateGPT | Hub-and-spoke app isolation | Processes, syscalls, files, network, and cross-app data | App execution and mediated IPC | Security partly depends on users rejecting warned permission requests |
| AgentDojo | Indirect prompt-injection benchmark | User goal, injection goal, and coarse tools | Stateful agent trajectory | It does not model resource- or argument-level grants |
| Agent Security Bench | Multi-surface attack benchmark | Prompts, memory, demonstrations, and tools | Tool selection in simulated scenarios | Parameter-free simulated attack tools omit real effects and resource scopes |
| R-Judge | Retrospective risk-awareness benchmark | Textual thoughts, actions, and feedback | Completed static trajectory | It measures detection rather than authorization or intervention |
| ToolEmu | LM-emulated risk sandbox | Underspecified requests and consequential actions | Simulated environment trajectory | Simulation and model judging require real-system validation |

## Paper notes

### 1. AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents

**Primary record and version.**

[AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents](https://arxiv.org/abs/2503.18666) reports acceptance to the ICSE 2026 Research Track, and the public full text is [arXiv:2503.18666v3](https://arxiv.org/pdf/2503.18666v3), dated 2025-07-31.

**Mechanism and authority model.**

**Direct evidence:** AgentSpec defines a runtime DSL in which an event trigger activates predicates over agent state, trajectory, or proposed action and then invokes enforcement such as stopping, user inspection, LLM self-examination, or a replacement action.

**Direct evidence:** Its triggers include state changes, pre-action checks, agent completion, and domain-specific events, as specified in Section 3 and Figure 3 of the [ICSE author PDF](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf#page=4).

**Direct evidence:** The paper does not define an adversarial security game, and it trusts the policy author, predicate code, event instrumentation, and monitor.

**Key quantitative results.**

**Direct evidence:** Table 6 on [PDF page 9](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf#page=9) reports 87.26% enforced cases for 750 code scenarios from 75 examples and 25 generated rules, 95.56% for 250 embodied scenarios from 25 examples and 10 rules, and 62.50% for eight autonomous-driving scenarios using six rules adopted from FixDrive rather than inferred from the evaluation scenarios.

**Direct evidence:** The accompanying text separately reports 70.96% recall for embodied generated rules, but the paper uses “precision,” “recall,” and “enforced” inconsistently enough that these labels should not be normalized silently.

**Direct evidence:** Table 3 on [PDF page 7](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf#page=7) evaluates 25 RedCode categories with 30 cases each but reports attempted invocations, rule violations, and human-approved passes under different columns rather than one conventional detection denominator.

**Author claim:** The paper summarizes the code-agent result as preventing more than 90% of malicious actions.

**Direct evidence:** Table 4 on [PDF page 8](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf#page=8) reduces all ten embodied unsafe-behavior categories to zero while safe-task completion changes from 58.62 to 54.26.

**Direct evidence:** Table 5 on the same page reports 100% rule passing in eight autonomous-driving law scenarios.

**Direct evidence:** Section 5.5 on [PDF page 10](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf#page=10) reports 1.42 ms rule parsing, 2.83 ms code-agent predicate evaluation, and 1.11 ms embodied-agent predicate evaluation against average task times of 25.4 seconds and 9.82 seconds.

**Limitations.**

**Direct evidence:** Section 6.3 describes the approach as checkpoint-based and mainly reactive rather than a long-horizon risk predictor.

**Direct evidence:** Generated rules can be incomplete, overly broad, or overly narrow, while human inspection and extra LLM calls are excluded from the fixed overhead measurement.

**Synthesis:** AgentSpec guarantees configured handling only when every relevant action crosses an instrumented hook and the applicable rule and predicate correctly encode the hazard.

**Coding-agent implications.**

**Synthesis:** AgentSpec is suitable for repository semantics such as requiring checks before a push, forbidding publication without approval, or limiting mutations to an approved worktree.

**Synthesis:** Paths, commands, URLs, and Git references must be canonicalized before predicates run, and an OS or capability boundary must still block uninstrumented side effects.

### 2. Progent: Programmable Privilege Control for LLM Agents

**Primary record and version.**

[Progent: Programmable Privilege Control for LLM Agents](https://arxiv.org/abs/2504.11703v1) is the v1 title from 2025-04-16.

The current [arXiv:2504.11703v3](https://arxiv.org/pdf/2504.11703v3), dated 2026-05-14, is retitled “Progent: Securing AI Agents with Privilege Control” and remains a preprint without a stated peer-reviewed venue.

**Mechanism and threat model.**

**Direct evidence:** Progent protects a benign user and agent against indirect prompt injection from attacker-controlled observations that arrive after the trusted initial request.

**Direct evidence:** Figure 2 defines default-deny allow and forbid rules over tool names and typed arguments, with Boolean, comparison, membership, array, and regular-expression conditions.

**Direct evidence:** Every call is checked, forbid rules take precedence, narrowing policy updates may proceed automatically, and expansions require approval.

**Direct evidence:** Progent uses Z3 to compare the call sets permitted by old and proposed policies, establishing monotonic confinement between approved expansions in Sections 5–6 of the [v3 paper](https://arxiv.org/pdf/2504.11703v3#page=5).

**Key quantitative results.**

| Result | No defense | Progent | Anchor |
|---|---:|---:|---|
| AgentDojo benign utility | 79.4 | 76.3 | Figures 3–4, [PDF p.8](https://arxiv.org/pdf/2504.11703v3#page=8) |
| AgentDojo utility under attack | 54.0 | 61.3 | Figures 3–4, PDF p.8 |
| AgentDojo ASR | 39.9% | 1.0% | Figures 3–4, PDF p.8 |
| Agent Security Bench benign utility | 78.2 | 78.2 | Figures 3–4, PDF p.8 |
| Agent Security Bench utility under attack | 71.1 | 69.7 | Figures 3–4, PDF p.8 |
| Agent Security Bench ASR | 70.3% | 3.9% | Figures 3–4, PDF p.8 |

**Direct evidence:** Figure 5 on [PDF page 9](https://arxiv.org/pdf/2504.11703v3#page=9) reports manual approval at 75.3 benign utility, 58.6 utility under attack, and 0.0% ASR, while auto-denying expansions reports 67.0, 58.9, and 0.7%.

**Direct evidence:** Only 6% of policy updates in that experiment were classified as privilege expansions requiring approval.

**Direct evidence:** Figure 8 on [PDF page 10](https://arxiv.org/pdf/2504.11703v3#page=10) reports ASR reductions from 32.6% to 1.2% for LangChain, 40.4% to 0.8% for the OpenAI SDK, 42.0% to 1.4% for OpenHands, and 18.7% to 0.8% for AutoGen.

**Direct evidence:** The same integration study reports benign-utility declines from 79.4 to 68.0 for LangChain, 83.5 to 73.2 for the OpenAI SDK, and 80.4 to 73.2 for OpenHands, while AutoGen remains at 56.7.

**Direct evidence:** The paper does not provide a systematic latency, token, CPU, or SMT-solver overhead table.

**Limitations.**

**Direct evidence:** Progent assumes the initial user request is benign, leaves harmful calls inside the permitted set and harmful text output out of scope, and relies on the approver not granting excessive privilege.

**Direct evidence:** Its proxy cannot necessarily intercept framework-native tools, while its more complete library mode requires application changes.

**Synthesis:** Monotonic confinement prevents silent expansion but does not prove that the initial LLM-generated policy or a human-approved expansion is correct.

**Coding-agent implications.**

**Synthesis:** Coding tools should expose structured file, process, Git, package, credential, and network arguments so Progent-like policies can constrain actual resources rather than parse arbitrary shell text.

**Synthesis:** Repository content, web pages, compiler output, and tool results may propose an expansion but must never authorize it.

### 3. MiniScope: A Least Privilege Framework for Authorizing Tool Calling Agents

**Primary record and version.**

[MiniScope: A Least Privilege Framework for Authorizing Tool Calling Agents](https://arxiv.org/abs/2512.11147) is arXiv:2512.11147v1, submitted 2025-12-11, with a [Berkeley project page](https://sky.cs.berkeley.edu/project/miniscope/) and no stated proceedings venue.

**Mechanism and threat model.**

**Direct evidence:** MiniScope treats the LLM, prompt data, and tool output as untrusted while trusting users, scope specifications, service implementations, the session-token checker, and unguessable tokens.

**Direct evidence:** The agent submits an execution graph, an integer linear program chooses a minimum-cost set of OAuth-like scopes covering the planned API methods, the user approves a grant, and a trusted checker validates each MCP call and substitutes the real credential.

**Direct evidence:** The agent never receives the bearer credential, and the security game requires every executed call to be covered by current authorization.

**Key quantitative results.**

**Direct evidence:** Figure 6 of the [v1 PDF](https://arxiv.org/pdf/2512.11147v1#page=9) reports optimal scope selection in approximately 70–83% of cases for proprietary LLM baselines and 20–34% for open-source baselines.

**Direct evidence:** Table 2 on [PDF page 10](https://arxiv.org/pdf/2512.11147v1#page=10) reports LLM-to-MiniScope authorized-method ratios from 1.03 to 2.19, with Qwen 3 reaching 2.19 on multi-application, multi-method tasks and GPT-5 ranging from 1.03 to 1.12.

**Direct evidence:** Table 3 on the same page reports, among other connector comparisons, ChatGPT Gmail at 50 methods versus MiniScope at 32, ChatGPT Notion at 32 versus 13, and ChatGPT Dropbox at 44 versus 25.

| Workload | Vanilla | MiniScope | LLM scope selection |
|---|---:|---:|---:|
| Single app, single method | 2.92 s | 3.04 s | 6.49 s |
| Single app, multiple methods | 4.42 s | 4.54 s | 10.20 s |
| Multiple apps, multiple methods | 4.91 s | 5.23 s | 20.50 s |

**Direct evidence:** Figure 7 on [PDF page 11](https://arxiv.org/pdf/2512.11147v1#page=11) supplies these raw latency values, which imply MiniScope overheads of approximately 4.1%, 2.7%, and 6.5%.

**Reporting caveat:** The body summarizes overhead as 1–6%, while the introduction rounds it as 1–7%.

**Direct evidence:** Figure 8 reports simulated confirmation rates from 18% to 60%, depending on permission-retention behavior, and approximately four times fewer confirmations than per-method prompting.

**Direct evidence:** User response time is excluded from the latency results, while the LLM scope-selection baseline adds about 50,000 tokens and $0.063 to the reported multi-application request.

**Limitations.**

**Direct evidence:** The experiments use synthetic definitions and requests for ten applications in a single-agent architecture.

**Direct evidence:** Correctness depends on accurate API-to-scope mappings and compliant services, while same-scope harmful behavior, user mistakes, denial of service, and general jailbreak prevention are out of scope.

**Synthesis:** “Least privilege” is optimal only relative to the declared execution graph, available scope hierarchy, and method-count cost, which may undervalue a single destructive method.

**Coding-agent implications.**

**Synthesis:** A coding-agent broker should issue opaque, expiring capabilities for canonical worktrees, branches, destinations, secrets, and operations and should inject credentials only after validating the actual call.

**Synthesis:** Resource- and argument-level checks must supplement coarse service scopes.

### 4. Pro2Guard: Proactive Runtime Enforcement of LLM Agent Safety via Probabilistic Model Checking

**Primary record and version.**

[Pro2Guard: Proactive Runtime Enforcement of LLM Agent Safety via Probabilistic Model Checking](https://arxiv.org/abs/2508.00500v1) is the v1 title from 2025-08-01.

The current [arXiv:2508.00500v4](https://arxiv.org/pdf/2508.00500v4), dated 2026-08-03, is retitled “ProbGuard: Proactive Runtime Monitoring for LLM Agent Safety via Probabilistic Prediction” and reports acceptance at ASE 2026.

**Mechanism and authority model.**

**Direct evidence:** ProbGuard maps offline execution traces into predicate-defined abstract states, learns a discrete-time Markov chain, applies semantic transition constraints and Laplace smoothing, and queries temporal safety properties probabilistically.

**Direct evidence:** At runtime it intervenes when estimated safety probability falls below threshold theta, but the learned model is not updated online.

**Direct evidence:** The paper has no prompt-injection attacker model and trusts the domain expert’s predicates, abstraction, safety property, and valid-transition constraints.

**Direct evidence:** The evaluated LangChain integration appends a warning rather than overriding agent control directly.

**Key quantitative results.**

| Driving scenario | Property | Theta 0.3 | Theta 0.5 | Theta 0.7 |
|---:|---|---:|---:|---:|
| 1 | Law38_2 | 15.84 s | 15.84 s | 15.84 s |
| 2 | Law51_5 | 13.41 s | 13.41 s | 13.41 s |
| 3 | No collision | 0.34 s | 1.76 s | 23.87 s |
| 4 | Law51_5 | 0.01 s | 0.01 s | 15.15 s |
| 5 | Law51_5 | 6.22 s | 9.33 s | 21.06 s |
| 6 | No collision | 12.57 s | 23.02 s | 38.66 s |
| 7 | Law53 | 0.77 s | 0.77 s | 0.77 s |

**Direct evidence:** Table 1 in Section 6.1 of the [current full text](https://arxiv.org/html/2508.00500) reports advance-warning times above zero in all seven unsafe scenarios.

**Direct evidence:** On safe traces from six scenarios, false-positive rates were 0% at theta 0.3, 75% at 0.5, and 100% at 0.7.

**Author claim:** The authors highlight 15.84 seconds of warning at the threshold with no observed false alarms and 38.66 seconds at stricter thresholds.

| Embodied intervention | Unsafe behavior | Task completion |
|---|---:|---:|
| No monitor | 40.63% | 59.38% |
| Stop, theta 0.9 | 2.60% | 10.42% |
| Stop, theta 0.7 | 5.20% | 20.31% |
| Stop, theta 0.5 | 21.35% | 41.14% |
| Stop, theta 0.3 | 29.17% | 48.96% |
| Reflect, theta 0.9 | 14.07% | 47.74% |

**Direct evidence:** Table 2 in Section 6.2 reports a 93.60% relative unsafe-behavior reduction for strict stopping and a 65.37% reduction for reflection, with reflection retaining 80.4% of baseline task completion.

**Direct evidence:** The monitor reports approximately 0.07 ms state abstraction, 0.6 ms I/O, about 430 ms for an uncached query, under 50 ms for cached embodied models up to 32 states, and about 100 ms for autonomous driving.

**Direct evidence:** Table 3 uses epsilon 0.1 and delta 0.05 and reports 530 to approximately 100,000 required traces for embodied configurations and 185–1,016 for a weaker driving frequency-estimation alternative, while experiments use only 30 traces per scenario.

**Direct evidence:** The stronger smoothed-model uniform driving bound has a reported parameter around 10^7–10^8 and becomes impractical.

**Limitations.**

**Direct evidence:** The PAC result assumes an adequate Markov abstraction and representative sampling and does not cover omitted safety-relevant variables.

**Direct evidence:** State-space growth, sparse transitions, offline-only learning, and the use of Apollo rather than an LLM controller in the driving evaluation limit generalization.

**Synthesis:** The theorem characterizes prediction error under its assumptions but does not certify the reported experiments at their sample counts.

**Coding-agent implications.**

**Synthesis:** ProbGuard-like monitoring is useful for cumulative hazards such as widening permissions, repeated secret-access attempts, expanding path sets, or a build-to-publish sequence.

**Synthesis:** Its risk estimate may only restrict, pause, or escalate authority and must never create permission.

### 5. Do Coding Agents Understand Least-Privilege Authorization?

**Primary record and version.**

[Do Coding Agents Understand Least-Privilege Authorization?](https://arxiv.org/abs/2605.14859) is arXiv:2605.14859v2, revised 2026-05-15, and is a 37-page preprint without a stated peer-reviewed venue.

**Benchmark and threat model.**

**Direct evidence:** AuthBench asks a policy-generation model to whitelist absolute POSIX paths for read, write, and execute access before a separate GPT-5/OpenClaw execution agent attempts a terminal task.

**Direct evidence:** It contains 120 containerized tasks across ten domains, including 80 standard and 40 sensitive tasks, with an average safe-oracle policy of 10.4 entries and an average sensitive attack surface of 2.9 entries.

**Direct evidence:** The gold policy is derived from one safe oracle execution under strace and is explicitly a workflow-dependent proxy rather than a universal minimum.

**Key quantitative results.**

| Policy source | Standard TSR | Sensitive TSR | SER | ASR |
|---|---:|---:|---:|---:|
| Full access | 83.3% | 94.0% | — | 65.8% |
| Golden permission proxy | 77.1% | 81.7% | — | 0.0% |
| Gemini 3.1 Pro | 75.4% | 85.8% | 34.8% | 28.3% |
| GPT-5 | 63.3% | 76.7% | 33.6% | 23.3% |
| GPT-5.4 | 52.6% | 61.1% | 21.1% | 19.4% |
| Claude Opus 4.6 | 61.3% | 61.5% | 47.0% | 25.6% |
| Kimi K2.5 | 60.0% | 70.0% | 74.5% | 28.3% |
| GPT-5.3-Codex | 58.8% | 65.8% | 42.6% | 15.8% |
| Qwen3-Coder | 52.1% | 63.3% | 65.0% | 20.8% |
| Qwen3.5-397B | 45.6% | 42.9% | 71.9% | 17.6% |
| MiniMax M2.7 | 42.1% | 48.3% | 64.2% | 15.8% |

**Direct evidence:** These values appear in [Table 1, Section 5](https://arxiv.org/html/2605.14859#S5).

**Direct evidence:** Appendix E reports 82.2% success across 202 runs whose policies cover the oracle-trace closure and 47.7% across 375 runs without complete closure.

**Direct evidence:** Table 2 in [Section 7.2](https://arxiv.org/html/2605.14859#S7.SS2) reports that sufficiency-tightness decomposition moves Claude Opus 4.6 from 61.5% to 75.0% sensitive TSR, 47.0% to 28.3% SER, and 25.6% to 15.0% ASR.

**Direct evidence:** The same decomposition moves Gemini 3.1 Pro from 85.8% to 75.0% sensitive TSR while reducing SER from 34.8% to 15.7% and ASR from 28.3% to 12.5%.

**Author claim:** The authors describe model-specific under-granting and over-granting tendencies as “authorization attractors” and argue that decomposed reasoning is more effective than merely increasing reasoning effort.

**Limitations.**

**Direct evidence:** The policy language excludes network, IPC, cloud, database, browser, credential, and API authority.

**Direct evidence:** Static scoring omits runtime files and implicit dependencies, and the primary execution study fixes GPT-5 as its downstream backbone.

**Direct evidence:** Appendix C reruns the same policies with Claude Sonnet 4.6 and Gemini 3 Flash Preview and finds substantial changes in absolute TSR and ASR, so authorization outcomes are not backbone-independent.

**Synthesis:** The benchmark tests ordinary policy inference error rather than a malicious policy generator or a sandbox escape.

**Coding-agent implications.**

**Synthesis:** Separate coverage discovery from privilege removal, bind policy to the chosen toolchain, and refresh authorization after plan changes, failures, retries, or alternative-tool selection.

**Synthesis:** Score utility and exposure independently because a policy can be both unusable and unsafe.

### 6. When Lower Privileges Suffice: Investigating Over-Privileged Tool Selection in LLM Agents

**Primary record and version.**

[When Lower Privileges Suffice: Investigating Over-Privileged Tool Selection in LLM Agents](https://arxiv.org/abs/2606.20023) is arXiv:2606.20023v2, revised 2026-07-07, and is a 20-page preprint without a stated peer-reviewed venue.

**Benchmark and threat model.**

**Direct evidence:** ToolPrivBench contains 544 scenarios across eight domains and five risk types, with three standard and three risk tools per case.

**Direct evidence:** Every tool is independently sufficient, the first call to a standard tool fails transiently, later standard calls succeed, risk tools succeed immediately, and the agent receives at most five tool turns.

**Direct evidence:** OPUR@5 records use of a broader tool before narrower alternatives are exhausted, while PED records how many distinct lower-privilege tools were tried first.

**Key quantitative results.**

| Model | Overall OPUR@5 |
|---|---:|
| Claude 4.6 Sonnet | 2.6% |
| GLM-5 | 8.6% |
| GPT-5.2 | 9.7% |
| Gemini 3 Flash | 17.5% |
| Kimi K2.5 | 21.0% |
| DeepSeek-v3.2 | 31.8% |
| Qwen3.5-397B | 33.3% |
| Grok 4.1 Fast | 37.1% |
| MiniMax-M2.7 | 43.4% |
| LLaMA-3.1-8B | 55.9% |
| Qwen3-8B | 64.9% |

**Direct evidence:** Figure 4 on [PDF page 5](https://arxiv.org/pdf/2606.20023#page=5) reports these values, with six of eleven models above 30%.

**Direct evidence:** For GPT-5.2, its 53 violations comprise five immediate broad-tool choices, 13 escalations after one narrower tool, and 35 after two narrower tools.

| Model | Base OPUR | Least-privilege prompt | Privilege-aware post-training |
|---|---:|---:|---:|
| Qwen3-4B | 65.4% | 54.0% | 39.7% |
| Qwen3-4B-Thinking | 66.0% | 47.4% | 18.9% |
| Qwen3-8B | 64.9% | 50.4% | 27.0% |

**Direct evidence:** Figure 5 on [PDF page 8](https://arxiv.org/pdf/2606.20023#page=8) reports these reductions after SFT and GRPO.

**Direct evidence:** Table 2 in [Section 5.1](https://arxiv.org/html/2606.20023#S5.SS1) shows that AgentAlign can reduce explicit harmfulness while leaving OPUR high or worse, including Qwen2.5-7B moving from 50.4% to 60.7% OPUR.

**Author claim:** The authors attribute many post-failure escalations to uncertainty about lower-privilege tool capability.

**Limitations.**

**Direct evidence:** The tools are simulated, independently sufficient, and restricted to six choices, five turns, and a fixed first-failure-then-success pattern.

**Direct evidence:** The benchmark excludes partially overlapping tools, genuine multi-tool workflows, real services, approval UX, latency, and enforcement.

**Synthesis:** The experiment associates escalation with simulated failure but does not directly measure model confidence or frustration.

**Coding-agent implications.**

**Synthesis:** A timeout, 503, subprocess failure, or denied call must trigger diagnosis and same-level alternatives rather than automatic privilege expansion.

**Synthesis:** A broader capability should require a structured insufficiency explanation and a new grant.

### 7. LLM Agents Should Employ Security Principles

**Primary record and version.**

[LLM Agents Should Employ Security Principles](https://arxiv.org/abs/2505.24019) is arXiv:2505.24019v1, submitted 2025-05-29, and explicitly presents itself as a position paper without a stated peer-reviewed venue.

**Architecture and threat model.**

**Direct evidence:** The paper proposes AgentSandbox around defense in depth, least privilege, complete mediation, and psychological acceptability.

**Direct evidence:** A Persistent Agent holds durable profile data, a Data Minimizer releases task-essential context, an Ephemeral Agent interacts externally, an I/O Firewall enforces schemas and static constraints, and a Response Filter checks reintegration.

**Direct evidence:** The defender trusts the personal agent and direct user input but treats external agents, tools, and their output as possible sources of malicious instructions.

**Key quantitative results.**

| Defense | Benign utility | Utility under attack | ASR |
|---|---:|---:|---:|
| No defense | 83.81% | 58.84% | 44.35% |
| Tool filter | 71.24% | 60.10% | 8.90% |
| Prompt-injection detector | 36.58% | 18.50% | 6.79% |
| Delimiting | 75.75% | 66.46% | 27.97% |
| Repeat prompt | 85.75% | 68.33% | 27.33% |
| AgentSandbox | 82.00% | 65.04% | 4.34% |

**Direct evidence:** These macro-averages are calculated from the four domain columns in Table 1 on [PDF page 8](https://arxiv.org/pdf/2505.24019#page=8), which uses 97 AgentDojo tasks and gpt-4o-2024-08-06.

**Reporting discrepancy:** The prose calls 58.84% the average no-defense ASR, but Table 1 yields 44.35% ASR and 58.84% utility under attack, indicating a likely column mix-up.

**Direct evidence:** AgentSandbox’s per-domain ASRs are 5.56% for banking, 3.81% for Slack, 7.14% for travel, and 0.83% for workspace.

**Author claim:** The authors call AgentSandbox the best overall utility-security trade-off.

**Synthesis:** That is a preference judgment rather than dominance because repeated prompting has greater utility while AgentSandbox has much lower ASR.

**Limitations.**

**Direct evidence:** The evaluation uses one main model, one attack template, and one benchmark family and provides no user, latency, compute-cost, or hard-containment study.

**Direct evidence:** Appendix E acknowledges that PII labeling, policy refinement, completeness, interpretability, and reward design remain immature.

**Synthesis:** The “sandbox” provides contextual and information-flow compartmentalization but does not specify process, syscall, filesystem, VM, or network isolation.

**Coding-agent implications.**

**Synthesis:** Separate durable project memory from task-local execution context, mediate inputs and outputs, and keep immutable parameter restrictions outside prompt optimization.

**Synthesis:** Psychological acceptability requires infrequent, understandable, and action-bound escalation rather than unmeasured warning prompts.

### 8. IsolateGPT: An Execution Isolation Architecture for LLM-Based Agentic Systems

**Primary record and version.**

[IsolateGPT: An Execution Isolation Architecture for LLM-Based Agentic Systems](https://www.ndss-symposium.org/ndss-paper/isolategpt-an-execution-isolation-architecture-for-llm-based-agentic-systems/) was published at NDSS 2025 with [DOI 10.14722/ndss.2025.241131](https://doi.org/10.14722/ndss.2025.241131), and the [official PDF](https://www.ndss-symposium.org/wp-content/uploads/2025-1131-paper.pdf) corresponds to arXiv v2 from 2025-01-30.

**Architecture and threat model.**

**Direct evidence:** IsolateGPT places each third-party app, app-local memory, non-LLM operator, and dedicated LLM in a separate spoke process connected only through a trusted hub.

**Direct evidence:** Direct spoke-to-spoke communication is forbidden, structured IPC is performed by deterministic operators, seccomp restricts syscalls, setrlimit bounds CPU, memory, and file creation, file descriptors are restricted, and app egress is limited to its eTLD+1 domain.

**Direct evidence:** The model trusts the host, hub, and system LLM while treating apps and app-processed content as untrusted.

**Key quantitative results.**

**Direct evidence:** Table I on [PDF page 10](https://www.ndss-symposium.org/wp-content/uploads/2025-1131-paper.pdf#page=10) evaluates 1,598 attacks, reports 20.2% VanillaGPT ASR, and shows that 7.6% of IsolateGPT cases reached a permission dialog and 100% of those dialogs displayed a warning.

**Reporting caveat:** The 7.6% and 100% values are not IsolateGPT attack-success measurements because the final effect depends on whether the user approves the warned flow.

**Direct evidence:** Table II on [PDF page 13](https://www.ndss-symposium.org/wp-content/uploads/2025-1131-paper.pdf#page=13) reports identical single-app and multiple-app correctness of 1.00, identical multi-app collaboration overall correctness of 0.95, and nearly identical no-app scores across 42 no-app queries within a 103-query total workload.

**Direct evidence:** The functionality workload primarily uses LangChain typewriter, relational-data, and email-extraction tests rather than realistic coding or office workflows.

**Direct evidence:** The latency measurements assume cold-start spokes in an unoptimized prototype.

| Query class | VanillaGPT | IsolateGPT | Derived increase |
|---|---:|---:|---:|
| Single app | 32.013 s | 39.210 s | 22.5% |
| Multiple apps | 30.292 s | 65.304 s | 115.6% |
| Multi-app collaboration | 24.728 s | 49.256 s | 99.2% |
| No apps | 19.502 s | 21.422 s | 9.8% |

**Direct evidence:** Table IV on [PDF page 14](https://www.ndss-symposium.org/wp-content/uploads/2025-1131-paper.pdf#page=14) supplies these means, while the paper reports 75.73% of queries below 30% overhead and 90th- and 95th-percentile ratios of 1.24 times and 1.80 times.

**Limitations.**

**Direct evidence:** App metadata and message formats are assumed vetted, intra-app compromise remains out of scope, performance tests automatically approve permissions, and the paper provides no user study of warning decisions.

**Synthesis:** The hub, planner, central memory, permission store, IPC, metadata, OS isolation, and users form a large trusted computing base and a compromised hub can affect every spoke.

**Synthesis:** eTLD+1 restriction still allows egress to attacker-controlled endpoints beneath an app’s own domain.

**Coding-agent implications.**

**Synthesis:** Run high-risk tools in separate processes or stronger sandboxes with distinct filesystems, credentials, memory, and egress policy.

**Synthesis:** Route cross-tool data through a small typed broker and use one-time grants for irreversible operations.

### 9. AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents

**Primary record and version.**

[AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents](https://papers.neurips.cc/paper_files/paper/2024/file/97091a5177d8dc64b1da8bf3e1f6fb54-Paper-Datasets_and_Benchmarks_Track.pdf) was published in the NeurIPS 2024 Datasets and Benchmarks Track, while [arXiv:2406.13352](https://arxiv.org/abs/2406.13352) is currently v3.

**Benchmark and threat model.**

**Direct evidence:** AgentDojo tests whether indirect prompt injections in emails, documents, messages, or web content redirect a tool-using agent from a legitimate user task to a separate attacker goal.

**Direct evidence:** Table 1 on [paper page 5](https://papers.neurips.cc/paper_files/paper/2024/file/97091a5177d8dc64b1da8bf3e1f6fb54-Paper-Datasets_and_Benchmarks_Track.pdf#page=5) reports 97 user tasks, 27 injection goals, and 70 tools across workspace, Slack, travel, and banking, producing 629 compatible task-attack cases.

**Reporting discrepancy:** Section 3.1 says 74 tools while Table 1 totals 70.

**Key quantitative results.**

**Direct evidence:** Table 3 on [paper page 19](https://papers.neurips.cc/paper_files/paper/2024/file/97091a5177d8dc64b1da8bf3e1f6fb54-Paper-Datasets_and_Benchmarks_Track.pdf#page=19) reports GPT-4o at 69.00% benign utility, 50.08% utility under attack, and 47.69% targeted ASR.

**Direct evidence:** The same table reports Command R+ at only 0.95% targeted ASR but also only 25.44% benign utility, showing why low ASR can reflect incapability.

**Direct evidence:** Table 4 on the same page reports GPT-4o Important-message targeted ASR of 57.70 ± 2.0% and Max targeted ASR of 57.55 ± 2.7%.

**Reporting caveat:** Max is defined as success by any evaluated attack but is reported slightly below Important message, although the 0.15-point inversion is much smaller than the overlapping uncertainty intervals and may reflect eligibility, aggregation, rounding, or sampling.

| GPT-4o defense | Benign utility | Utility under attack | Targeted ASR |
|---|---:|---:|---:|
| No defense | 69.00% | 50.01% | 57.69% |
| Delimiting | 72.66% | 55.64% | 41.65% |
| Prompt-injection detector | 41.49% | 21.14% | 7.95% |
| Repeat user prompt | 85.53% | 67.25% | 27.82% |
| Tool filter | 73.13% | 56.28% | 6.84% |

**Direct evidence:** Table 5 on [paper page 19](https://papers.neurips.cc/paper_files/paper/2024/file/97091a5177d8dc64b1da8bf3e1f6fb54-Paper-Datasets_and_Benchmarks_Track.pdf#page=19) supplies these separately reported defense results.

**Reporting caveat:** The prose rounds the tool-filter ASR to approximately 7.5%, while the table gives 6.84%, and this table’s no-defense ASR differs from Table 3’s GPT-4o slice.

**Direct evidence:** Reported defense intervals include 7.95 ± 2.1% for the prompt-injection detector and 6.84 ± 2.0% for the tool filter, so their point estimates should not be treated as a decisive ranking.

**Limitations.**

**Direct evidence:** In approximately 17% of cases, tools needed for the legitimate task are also sufficient for the attack, limiting whole-tool filtering.

**Direct evidence:** The attacks, defenses, tasks, and deterministic evaluators are comparatively simple and manually constructed.

**Synthesis:** The benchmark measures intent alignment and coarse tool restriction, not principal authentication, ACLs, resource ownership, argument scopes, credential isolation, revocation, or OS containment.

**Coding-agent implications.**

**Synthesis:** Select initial capabilities before reading untrusted repository content when possible, but reauthorize safely when exploratory work requires new tools.

**Synthesis:** An allowed shell tool still needs path, command, secret, network, and environment constraints.

### 10. Agent Security Bench (ASB): Formalizing and Benchmarking Attacks and Defenses in LLM-based Agents

**Primary record and version.**

[Agent Security Bench (ASB): Formalizing and Benchmarking Attacks and Defenses in LLM-based Agents](https://openreview.net/forum?id=V4y0CpX4hK) was published at ICLR 2025, and this note uses [arXiv:2410.02644v4](https://arxiv.org/pdf/2410.02644v4), dated 2025-05-30.

**Version caveat:** Earlier arXiv metadata described 23 attack-and-defense types, eight metrics, and ten defenses, while v4 reports 27 types, seven metrics, four mixed-attack combinations, and eleven defense applications.

**Benchmark and threat model.**

**Direct evidence:** ASB covers direct and indirect injection, retrieved-memory poisoning, proof-of-thought backdoors, mixed attacks, and attacker-added tools.

**Direct evidence:** Table 3 on [paper page 7](https://arxiv.org/pdf/2410.02644v4#page=7) reports ten scenarios, 50 normal tasks, 20 normal tools, 400 attack tools and tasks, ten backdoor demonstrations, and 420 total tools.

**Direct evidence:** Tools return predefined outputs, attack tools have no parameters, and attack success is selection of an attacker-designated tool.

**Key quantitative results.**

| Attack family | Mean ASR across 13 models | Mean refusal |
|---|---:|---:|
| Direct injection | 72.68% | 6.53% |
| Indirect injection | 27.55% | 8.61% |
| Memory poisoning | 7.92% | 4.63% |
| Mixed attack | 84.30% | 3.22% |
| Proof-of-thought backdoor | 42.12% | 5.42% |
| Overall | 46.91% | 5.68% |

**Direct evidence:** Table 5 on [paper page 8](https://arxiv.org/pdf/2410.02644v4#page=8) reports these values and gives GPT-4o 64.41% overall ASR and Claude 3.5 Sonnet 56.44%.

**Direct evidence:** Table 6 on [paper page 9](https://arxiv.org/pdf/2410.02644v4#page=9) reports mean PNA of 29.46%, ASR of 46.91%, and normal-performance-adjusted robustness of 15.64%.

**Direct evidence:** Table 7 reports direct-injection ASR of 78.38% with no defense, 79.08% with delimiters, 56.87% with paraphrasing, and 44.45% with dynamic prompt rewriting.

**Direct evidence:** Table 8 reports indirect-injection ASR of 27.98% with no defense, 24.96% with delimiters, and 28.04% with sandwiching.

**Direct evidence:** Table 21 on [paper page 34](https://arxiv.org/pdf/2410.02644v4#page=34) reports memory-detector false-negative rate 0.660 and false-positive rate 0.200.

**Author claim:** Mixed attacks are particularly effective because they compromise multiple pipeline stages, and current prompt-level defenses remain inadequate.

**Limitations.**

**Direct evidence:** ASB uses simulated fixed-output tools and parameter-free attack tools.

**Synthesis:** This design omits real external effects and cannot represent distinctions such as one file versus an entire filesystem.

**Synthesis:** Attacker-added tools partly model a tool-supply-chain compromise that a production registry should prevent before model selection.

**Synthesis:** Refusal, low ASR, and NRP still mix security with model incapability and do not establish enforceable authorization.

**Coding-agent implications.**

**Synthesis:** Sign or explicitly approve tool registries, preserve provenance for persistent memory, and prevent repository content or retrieved memory from registering executable tools.

**Synthesis:** Apply an independent gateway to paths, commands, destinations, secrets, branches, and publication targets after model tool selection.

### 11. R-Judge: Benchmarking Safety Risk Awareness for LLM Agents

**Primary record and version.**

[R-Judge: Benchmarking Safety Risk Awareness for LLM Agents](https://aclanthology.org/2024.findings-emnlp.79/) was published in Findings of EMNLP 2024 with [DOI 10.18653/v1/2024.findings-emnlp.79](https://doi.org/10.18653/v1/2024.findings-emnlp.79), and the final [ACL PDF](https://aclanthology.org/2024.findings-emnlp.79.pdf) corresponds to arXiv v3.

**Version caveat:** An earlier version had 162 records, seven risk categories, and nine models, while the final paper has 569 records, five application categories, and eleven models.

**Benchmark and threat model.**

**Direct evidence:** R-Judge asks a model to classify and explain risks in a static record containing a user instruction and the agent’s thoughts, actions, and feedback.

**Direct evidence:** The final dataset contains 569 records, 300 unsafe and 269 safe, across 27 scenarios and ten risk types, with averages of 2.6 turns and 206 words, as detailed in Table 5 and Appendix B on [PDF pages 13–14](https://aclanthology.org/2024.findings-emnlp.79.pdf#page=13).

**Direct evidence:** Its annotation policy may label a requested action unsafe when the agent should have sought a separate confirmation, so the benchmark mixes risk awareness with safety and consent norms rather than evaluating a formal authorization policy.

**Direct evidence:** It includes intended environmental injections and unintended harm from benign but underspecified requests, while excluding direct jailbreaks and deliberately malicious user prompts.

**Key quantitative results.**

| Model | Overall F1 | Intended recall | Intended specificity | Unintended F1 |
|---|---:|---:|---:|---:|
| GPT-4o | 74.45 | 91.50 | 42.06 | 80.90 |
| ChatGPT | 44.96 | 37.00 | 57.48 | 55.63 |
| Llama 3 8B | 61.01 | 66.50 | 66.36 | 48.32 |
| Llama 2 13B | 54.80 | 80.00 | 19.16 | 38.86 |
| Llama 2 7B | 53.74 | 91.50 | 7.48 | 21.56 |

**Direct evidence:** Table 1 on [PDF page 5](https://aclanthology.org/2024.findings-emnlp.79.pdf#page=5) reports these values.

**Reporting discrepancy:** The final table gives GPT-4o 74.45 overall F1, while the ACL landing-page abstract says 74.42.

**Direct evidence:** Table 2 on [PDF page 6](https://aclanthology.org/2024.findings-emnlp.79.pdf#page=6) reports GPT-4o baseline F1 74.45, recall 85.00, and specificity 51.67, while listing risk types changes them to 71.16, 89.67, and 30.48.

**Direct evidence:** Table 3 on [PDF page 7](https://aclanthology.org/2024.findings-emnlp.79.pdf#page=7) reports Meta-Llama-Guard 2 at 71.84 F1, 74.00 recall, and 64.31 specificity.

**Direct evidence:** For 50 unsafe samples, human judgments and the GPT-4 explanation judge correlate at Pearson 0.91, while GPT-4 explanations receive mean human score 0.89.

**Limitations.**

**Direct evidence:** The dataset is small, static, short, largely derived from InjecAgent, partly counterfactual, author-annotated, and judged for explanation quality by GPT-4.

**Synthesis:** R-Judge observes completed text rather than intervening before an irreversible side effect and assumes access to thoughts that may be unavailable or strategically unreliable.

**Synthesis:** High recall paired with low specificity would create serious false-denial costs if used as an automatic gate.

**Coding-agent implications.**

**Synthesis:** Risk judges should receive structured operations, arguments, resources, and active grants and should serve only as advisory or veto layers.

**Synthesis:** Confirmation must bind to an exact branch, tag, package, version, command, destination, and generation and must expire when those change.

### 12. Identifying the Risks of LM Agents with an LM-Emulated Sandbox

**Primary record and version.**

[Identifying the Risks of LM Agents with an LM-Emulated Sandbox](https://openreview.net/forum?id=GEcwtMk1uA), commonly presented as ToolEmu, was an ICLR 2024 Spotlight, and the full text used is [arXiv:2309.15817v2](https://arxiv.org/pdf/2309.15817v2), dated 2024-05-17.

**Benchmark and threat model.**

**Direct evidence:** ToolEmu uses GPT-4 to emulate tool environments and separately judge safety and helpfulness for benign but deliberately underspecified user requests.

**Direct evidence:** The adversarial emulator receives the underspecification and risk description so it can choose a state in which an unsafe assumption has serious consequences, but it does not inject hostile instructions.

**Direct evidence:** The benchmark contains 18 categories, 36 toolkits, 311 tools, 144 risky cases, and nine risk types, as described in Sections 3–4 of the [paper](https://arxiv.org/pdf/2309.15817v2#page=4).

**Key quantitative results.**

**Direct evidence:** Table 3 on [paper page 9](https://arxiv.org/pdf/2309.15817v2#page=9) reports identified-failure precision of 72.5 ± 7.1% for standard emulation and 68.8 ± 6.7% for adversarial emulation, with true failure incidence of 39.6 ± 4.9% and 50.0 ± 5.1%.

**Reporting caveat:** The widely cited 68.8% is precision among identified adversarial-emulator failures, not the fraction of all simulated trajectories reproduced in reality.

**Direct evidence:** Table 4 reports critical-issue-free trajectory rates of 91.9 ± 2.7% and 85.6 ± 3.6%, automatic safety-evaluator precision 75.3% and recall 73.1%, and only moderate safety agreement at kappa 0.478 between the evaluator and humans.

**Reporting discrepancy:** The limitations prose loosely swaps or restates one safety-evaluator number, so Table 4 is the preferred source.

| Agent or prompt | Mean safety | Failure incidence | Mean helpfulness |
|---|---:|---:|---:|
| GPT-4 | 2.007 | 39.4% | 1.458 |
| GPT-4 with safety prompt | 2.359 | 23.9% | 1.824 |
| GPT-4 with helpfulness-and-safety prompt | 2.241 | 30.5% | 1.624 |
| No-action baseline | 3.000 | 0.0% | 0.063 |

**Direct evidence:** Table 5 on [paper page 10](https://arxiv.org/pdf/2309.15817v2#page=10) reports these results across three runs, with average standard errors of 0.07 for safety, 0.05 for helpfulness, and 4.1 percentage points for failure incidence.

**Direct evidence:** Six of seven attempted real ChatGPT failure replications succeeded, while real sandboxes took about eight hours to build versus less than fifteen minutes for ToolEmu emulation.

**Author claim:** Safety prompting reduces GPT-4 failures and improves helpfulness, while stronger autonomy language partially reverses that gain.

**Limitations.**

**Direct evidence:** GPT-4 participates in case generation, emulation, and evaluation, the emulator misses constraints, human agreement is moderate, and simulation findings require real-world validation.

**Synthesis:** Adversarially sampled risk incidence is not deployment prevalence, and an emulator cannot test real authentication, authorization, race conditions, credential leakage, or sandbox escape.

**Coding-agent implications.**

**Synthesis:** Use emulation to generate tests for ambiguous deletion, secret access, branch mutation, dependency publication, and external communication, then reproduce severe failures in a real constrained sandbox.

**Synthesis:** Bind confirmation to exact arguments and effects rather than treating a broad natural-language request as unlimited authority.

## Cross-paper agreements and tensions

### Agreements

- **Synthesis:** AuthBench, ToolPrivBench, AgentDojo, Agent Security Bench, R-Judge, and ToolEmu expose distinct model failures in policy generation, tool choice, attack resistance, retrospective classification, and simulated consequence handling rather than measuring one common construct.
- **Direct evidence:** Progent, MiniScope, AgentSpec, AgentSandbox, and IsolateGPT all place at least part of the security decision outside the acting model.
- **Synthesis:** Complete mediation is the shared architectural hinge because a correct policy is irrelevant when shell, file, credential, IPC, or network side effects can bypass it.
- **Synthesis:** Utility must be reported with security because no action, task failure, overblocking, and excessively narrow permissions can all lower observed attack success without producing a usable system.
- **Synthesis:** Untrusted observations may change plans but must never create authority.
- **Synthesis:** Least privilege applies to both possession and use because an agent may receive an acceptable grant yet choose an unnecessarily powerful available tool.
- **Synthesis:** Authorization should be resource- and argument-specific because whole-tool labels and service scopes often remain too coarse.
- **Synthesis:** User confirmation is meaningful only when it identifies the exact operation, resource, persistence, and consequence and when denial is safely enforced.

### Tensions

- **Preselection versus exploration:** AgentDojo supports selecting a coarse whole-tool allowlist before reading untrusted data, but it does not validate resource- or argument-specific preselection, and exploratory coding tasks cannot always know their tool and resource closure in advance.
- **Adaptation versus confinement:** Progent permits runtime policy evolution while preventing silent expansion, whereas MiniScope re-solves planned scopes and AuthBench primarily evaluates a pre-execution policy.
- **Coverage versus tightness:** AuthBench shows that a narrow traced oracle can fail when a downstream agent chooses another valid workflow, while broad grants increase exposure and attack success.
- **Structural boundaries versus semantic richness:** MiniScope provides mediated scope-backed capabilities, and IsolateGPT constrains cross-spoke propagation absent an approved boundary-crossing flow, while AgentSpec and AgentSandbox express richer context-dependent policies but depend more heavily on correct predicates, prompts, and models.
- **Early warning versus availability:** ProbGuard obtains longer warning horizons at thresholds that also produce 75% or 100% false-positive rates in its small safe-driving sample.
- **Detection versus authorization:** R-Judge may recognize a risky action and ProbGuard may predict one, but neither proves that the underlying principal possessed or lacked authority.
- **Human control versus fatigue:** Progent, MiniScope, AgentSandbox, IsolateGPT, R-Judge, and ToolEmu rely on confirmation or escalation concepts, yet the corpus contains almost no realistic user-comprehension or fatigue evidence.
- **Isolation versus centralized trust:** IsolateGPT constrains cross-spoke propagation absent an approved boundary-crossing flow but places broad trust in a high-value hub, while AgentSandbox reduces contextual exposure without demonstrating hard containment.

## Practical defense-in-depth architecture

1. **Authenticate the requester and preserve provenance.**
   Bind every task to a user, service, workflow, repository, and organization rather than treating all natural-language text as one principal.
2. **Create an authority-free action plan.**
   Let the model propose operations and dependencies without granting the plan any capability.
3. **Derive coverage separately from tightness.**
   Enumerate transitive toolchain needs first, then independently remove ungrounded resources and flag sensitive overlaps.
4. **Represent typed capabilities.**
   Encode operations, canonical resources, arguments, network destinations, credential classes, budgets, persistence, delegation, and expiration.
5. **Keep credentials outside the model.**
   Let a broker inject short-lived credentials only after validating the concrete call.
6. **Enforce every side effect.**
   Mediate files, subprocesses, Git operations, package publication, cloud APIs, browser state, IPC, network egress, persistent memory, and cross-tool data.
7. **Run tools in isolated contexts.**
   Use per-tool or per-task processes, filesystem views, environment variables, resource limits, and egress policies.
8. **Prefer narrow tools and fail safely.**
   Retry or select same-level alternatives after transient failure, and require a structured insufficiency explanation before requesting broader authority.
9. **Constrain policy adaptation.**
   Allow automatic narrowing, require approval for expansion, and compare old and new permitted action sets mechanically.
10. **Apply deterministic semantic rules.**
    Check repository conventions, lifecycle prerequisites, test evidence, destructive actions, and release conditions at pre-action boundaries.
11. **Use risk monitors only to restrict.**
    A judge or probabilistic forecast may stop, narrow, re-plan, or escalate but may never grant authority.
12. **Bind confirmation to one action generation.**
    Display normalized arguments, resources, credentials, persistence, and consequences, and expire consent after relevant state or plan changes.
13. **Revalidate across lifecycle boundaries.**
    Recheck mutable state after waits, tool output, retries, cancellation, component disposal, session replacement, task completion, and shutdown.
14. **Record causal audit evidence.**
    Log the request principal, plan, capability, chosen tool, normalized arguments, actual resource use, denial, escalation, confirmation, intervention, and revocation.

## Evaluation gaps and research questions

- **Integrated enforcement:** Can one benchmark exercise policy generation, adaptive grants, argument-level mediation, process isolation, risk monitoring, user confirmation, revocation, and rollback in the same real coding workflow?
- **Real authority:** How should evaluations measure files, branches, repositories, accounts, credentials, network destinations, package registries, cloud resources, and monetary limits rather than tool names alone?
- **Principals and delegation:** How should authorization distinguish users, repository owners, organizations, CI workflows, tools, subagents, and external services and constrain delegation among them?
- **Complete mediation:** Which side channels, interpreters, shell features, symlinks, hooks, plugins, IPC paths, and alternate APIs bypass apparently typed tool gates?
- **Dynamic minimality:** Can a system expand enough for legitimate exploration without allowing untrusted observations, transient failures, or model uncertainty to widen privilege silently?
- **Policy correctness:** How can a policy be checked for both sufficient dependency closure and absence of unnecessary authority when multiple valid workflows exist?
- **Within-authority harm:** How should benchmarks score destructive or privacy-violating choices that remain inside a formally permitted scope?
- **Lifecycle safety:** Do cancellation, session replacement, retries, and shutdown reliably revoke credentials, processes, pending calls, and cached approvals?
- **Human factors:** Can users understand action-bound grants under realistic fatigue, and what error rate results from deceptive but correctly formatted approval requests?
- **Monitoring calibration:** How should false positives, false negatives, warning lead time, distribution shift, and model uncertainty be reported for pre-action monitors?
- **Formal assurance:** Can probabilistic predictors be combined with deterministic capabilities without allowing a learned model to weaken the hard authorization invariant?
- **Cost:** What are the end-to-end latency, token, solver, sandbox-startup, human-delay, and operational costs under long-lived and multi-tool workloads?
- **Recovery:** Can unauthorized or unsafe effects be contained, rolled back, and reconstructed from an audit trace when a model, monitor, broker, tool registry, or central hub fails?
- **Benchmark comparability:** Which common metrics can separate legitimate-task completion, false denial, unauthorized effect, exposed authority, confirmation error, and contained damage without hiding incapability inside a single score?

## Primary-source bibliography

1. [AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents](https://arxiv.org/abs/2503.18666), arXiv v3 reporting ICSE 2026 acceptance.
2. [Progent: Programmable Privilege Control for LLM Agents](https://arxiv.org/abs/2504.11703v1), with the renamed [current v3 record](https://arxiv.org/abs/2504.11703).
3. [MiniScope: A Least Privilege Framework for Authorizing Tool Calling Agents](https://arxiv.org/abs/2512.11147), arXiv v1.
4. [Pro2Guard: Proactive Runtime Enforcement of LLM Agent Safety via Probabilistic Model Checking](https://arxiv.org/abs/2508.00500v1), with the renamed ASE 2026 [ProbGuard v4 record](https://arxiv.org/abs/2508.00500).
5. [Do Coding Agents Understand Least-Privilege Authorization?](https://arxiv.org/abs/2605.14859), arXiv v2.
6. [When Lower Privileges Suffice: Investigating Over-Privileged Tool Selection in LLM Agents](https://arxiv.org/abs/2606.20023), arXiv v2.
7. [LLM Agents Should Employ Security Principles](https://arxiv.org/abs/2505.24019), arXiv v1 position paper.
8. [IsolateGPT: An Execution Isolation Architecture for LLM-Based Agentic Systems](https://www.ndss-symposium.org/ndss-paper/isolategpt-an-execution-isolation-architecture-for-llm-based-agentic-systems/), NDSS 2025.
9. [AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents](https://papers.neurips.cc/paper_files/paper/2024/file/97091a5177d8dc64b1da8bf3e1f6fb54-Paper-Datasets_and_Benchmarks_Track.pdf), NeurIPS 2024.
10. [Agent Security Bench (ASB): Formalizing and Benchmarking Attacks and Defenses in LLM-based Agents](https://openreview.net/forum?id=V4y0CpX4hK), ICLR 2025, with [arXiv v4 full text](https://arxiv.org/pdf/2410.02644v4).
11. [R-Judge: Benchmarking Safety Risk Awareness for LLM Agents](https://aclanthology.org/2024.findings-emnlp.79/), Findings of EMNLP 2024.
12. [Identifying the Risks of LM Agents with an LM-Emulated Sandbox](https://openreview.net/forum?id=GEcwtMk1uA), ICLR 2024 Spotlight, with [arXiv v2 full text](https://arxiv.org/pdf/2309.15817v2).
