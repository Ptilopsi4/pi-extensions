# pi-subagents Architecture Diagrams

These diagrams describe the main `pi-subagents` components, detached-agent lifecycle, transport selection, and verified workflow.

## Overall architecture

```mermaid
flowchart TB
    Root["Main Pi Agent<br/>Planning, integration, verification, and final answer"]
    Extension["pi-subagents Extension"]
    Settings["User Settings<br/>pi-subagents.json"]
    Catalog["Agent Catalog<br/>built-in / user / project"]
    UI["/subagents Manager<br/>pi-tui-kit"]

    Root --> Extension
    Settings --> Extension
    Catalog --> Extension
    UI <--> Extension

    subgraph Surfaces["Tool Surfaces"]
        Blocking["subagent<br/>Blocking workflows"]
        Consult["subagent_consult<br/>Synchronous read-only consultation"]
        Stateful["Detached lifecycle<br/>spawn / send / manage / mailbox"]
        Inspect["subagent_inspect<br/>Read-only diagnostics"]
    end

    Extension --> Blocking
    Extension --> Consult
    Extension --> Stateful
    Extension --> Inspect

    Blocking --> BlockingExecution["Blocking Execution<br/>single / parallel / chain / workflow / panel"]
    Consult --> ConsultPolicy["Read-only tool intersection<br/>read / grep / find / ls"]
    Stateful --> Registry["Agent Registry<br/>queue / generations / hierarchy"]
    Inspect --> Snapshots["Safe projections<br/>runs / workflows / models / status"]

    Registry --> Persistence["Persistent State and Completion Outbox"]
    Registry --> TransportSelector["Transport Selector"]
    BlockingExecution --> Runner["Subprocess Runner"]
    ConsultPolicy --> Runner

    TransportSelector --> InProcess["In-process<br/>Low startup overhead"]
    TransportSelector --> RPC["Retained RPC process<br/>Process isolation and retained history"]
    TransportSelector --> Subprocess["Fresh subprocess<br/>Custom-tool compatibility"]

    Registry --> Delivery["Completion Routing"]
    Delivery --> Root
```

## Detached-agent execution and completion delivery

```mermaid
sequenceDiagram
    participant R as Root Agent
    participant E as Extension
    participant P as Policy / Preflight
    participant G as Agent Registry
    participant T as Transport
    participant S as Persistent State
    participant D as Completion Broker

    R->>E: subagent_spawn(task, contract, budgets)
    E->>P: Check cwd, trust, agent scope, and capacity
    P-->>E: Approved execution plan
    E->>G: Create agent, generation, and runId
    G->>S: Persist starting / queued state
    E-->>R: Immediately return agentId and taskPath

    Note over R: Root continues non-overlapping local work

    G->>T: runTurn() when capacity is available
    T-->>G: Bounded progress / telemetry
    T-->>G: Terminal outcome

    G->>G: Classify completed / failed / blocked / interrupted
    G->>G: Create completionId and outbox record
    G->>S: Persist terminal state and completion first
    S-->>G: Durable

    G->>D: Route to the direct parent or nearest live ancestor

    alt next-turn
        D-->>R: Steer without waking an idle root
    else auto-resume
        D-->>R: Trigger a synthesis turn after the root settles
    end

    R->>E: subagent_send(agentId, follow-up)
    E->>G: Start a new generation while retaining agent history
    G->>T: Execute the follow-up

    R->>E: subagent_manage(close)
    E->>G: Release descendants child-first
    G->>T: Shutdown / release
    G->>S: Update or remove retained state
```

The system persists each completion before notifying its parent so that a process interruption does not permanently lose the result.

## Automatic transport selection

```mermaid
flowchart TD
    Start["Create a detached agent"]
    Explicit{"Was transport explicitly selected?"}
    UseExplicit["Use the selected transport"]
    BuiltIn{"Are all effective tools<br/>Pi built-in tools?"}
    ReadOnly{"Is the tool set read-only?"}
    InProcess["in-process<br/>Retained SDK session"]
    RPC["rpc<br/>Retained independent Pi process"]
    Subprocess["subprocess<br/>Fresh process for each turn"]
    Run["Create the child and accept the prompt"]
    Failure["Startup or execution failure<br/>Report failure without switching transport"]
    Note["After a child is created or may have accepted work,<br/>automatic fallback is forbidden to prevent duplicate side effects"]

    Start --> Explicit
    Explicit -- "Yes" --> UseExplicit
    Explicit -- "No, use auto" --> BuiltIn

    BuiltIn -- "No, includes extension/custom tools" --> Subprocess
    BuiltIn -- "Yes" --> ReadOnly

    ReadOnly -- "Yes" --> InProcess
    ReadOnly -- "No, includes bash/edit/write" --> RPC

    UseExplicit --> Run
    InProcess --> Run
    RPC --> Run
    Subprocess --> Run
    Run --> Failure
    Failure -.-> Note
```

Read-only classification is based on effective tool permissions rather than promises written in the task prompt.

## Verified workflow and acceptance barrier

```mermaid
flowchart TD
    Request["Caller-authored workflow"]
    Validate["Validate DAG, contracts, dependencies, and budgets"]
    Preflight["Preflight every cwd, agent, scope, and authority"]
    Ledger["Create the WorkItem Ledger"]
    Scheduler["Adaptive Scheduler<br/>dependency / capacity / budget / conflict"]
    Worker["Execute Worker"]
    Result["Parse structured-v2<br/>Record artifacts and tree identity"]
    NeedsVerify{"Is independent verification required?"}
    OrdinaryDone["Complete the ordinary workflow item"]

    Checks["Run executor-owned checks<br/>in a disposable worktree"]
    ChecksPass{"Did every check pass?"}
    Verifier["Independent read-only Verifier<br/>Different agent and generation"]
    Receipt["Create verification receipt<br/>Bind patch, tree, plan, and evidence"]
    Decision{"Verifier decision"}

    Accept["Acceptance Controller<br/>Mark accepted"]
    Rework{"Is rework capacity available?"}
    Rotate["Revoke old grants<br/>Rotate worker/verifier generations"]
    Reject["rejected / non-success"]
    Finish["Workflow terminal result"]

    Request --> Validate --> Preflight --> Ledger --> Scheduler
    Scheduler --> Worker --> Result --> NeedsVerify

    NeedsVerify -- "No" --> OrdinaryDone --> Finish
    NeedsVerify -- "Yes" --> Checks
    Checks --> ChecksPass
    ChecksPass -- "No" --> Reject
    ChecksPass -- "Yes" --> Verifier
    Verifier --> Receipt --> Decision

    Decision -- "accepted" --> Accept --> Finish
    Decision -- "rework" --> Rework
    Decision -- "rejected" --> Reject

    Rework -- "Yes, at most once" --> Rotate --> Scheduler
    Rework -- "No" --> Reject
    Reject --> Finish
```

A worker's own claim that verification passed cannot move acceptance from `pending` to `accepted`.

Only executor-owned checks, an independent verifier, and the acceptance controller can complete acceptance.
