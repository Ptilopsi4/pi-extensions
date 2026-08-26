# pi-subagents Architecture Diagrams

These diagrams describe the retained-agent tool surface, completion lifecycle, and transport selection.

## Overall architecture

```mermaid
flowchart TB
    Root["Main Pi Agent<br/>Planning, coordination, verification, and final answer"]
    Extension["pi-subagents Extension"]
    Settings["User Settings<br/>pi-subagents.json"]
    Catalog["Agent Catalog<br/>built-in / user / trusted project"]
    UI["/subagents Manager<br/>pi-tui-kit"]

    Root --> Extension
    Settings --> Extension
    Catalog --> Extension
    UI <--> Extension

    subgraph Surface["Retained Tool Surface"]
        Spawn["subagent_spawn"]
        Send["subagent_send"]
        Await["subagent_await"]
        Manage["subagent_manage"]
        Mailbox["subagent_mailbox"]
        Inspect["subagent_inspect"]
    end

    Extension --> Surface
    Spawn --> Registry["Agent Registry<br/>identity / generations / hierarchy / capacity"]
    Send --> Registry
    Await --> Registry
    Manage --> Registry
    Mailbox --> Registry
    Inspect --> Snapshots["Safe projections<br/>agents / runs / models / context / status"]

    Registry --> Persistence["Persistent retained state<br/>and completion outbox"]
    Registry --> TransportSelector["Transport Selector"]
    Registry --> Delivery["Completion Routing"]
    Delivery --> Root

    TransportSelector --> InProcess["in-process<br/>Retained SDK session"]
    TransportSelector --> RPC["RPC<br/>Retained child process"]
    TransportSelector --> Subprocess["subprocess<br/>Fresh process per turn"]
```

## Retained execution and completion delivery

```mermaid
sequenceDiagram
    participant R as Root Agent
    participant E as Extension
    participant P as Policy / Preflight
    participant G as Agent Registry
    participant T as Transport
    participant S as Persistent State
    participant D as Completion Broker

    R->>E: subagent_spawn(task, budgets, context)
    E->>P: Check cwd, trust, agent scope, contract, and capacity
    P-->>E: Approved execution plan
    E->>G: Create agent, generation, and runId
    G->>S: Persist accepted retained state
    E-->>R: Return agentId and taskPath immediately

    Note over R: Root continues non-overlapping local work

    G->>T: runTurn() when capacity is available
    T-->>G: Bounded progress and telemetry
    T-->>G: Terminal outcome
    G->>G: Create completionId and outbox record
    G->>S: Persist terminal state and completion first
    S-->>G: Durable
    G->>D: Route to direct parent or nearest live ancestor

    alt next-turn
        D-->>R: Steer without waking an idle root
    else auto-resume
        D-->>R: Steer active work or request one idle synthesis turn
    end

    opt Intentional join
        R->>E: subagent_await(agentId, timeoutMs)
        E->>G: Wait for this turn only
        G-->>E: Terminal result or wait timeout
        E-->>R: Bounded retained result
    end

    opt Follow-up
        R->>E: subagent_send(agentId, task)
        E->>P: Revalidate semantic resources and target policy
        P-->>E: Compatible or explicit revalidation required
        E->>G: Start a new generation with bounded retained history
        G->>T: Execute follow-up turn
    end

    R->>E: subagent_manage(close)
    E->>G: Release descendants child-first
    G->>T: Shutdown and release
    G->>S: Update retained state
```

A wait timeout or caller cancellation releases only the `subagent_await` waiter and never interrupts the retained turn.

The system persists each completion before notifying its parent so a process interruption does not permanently lose the result.

## Automatic transport selection

```mermaid
flowchart TD
    Start["Create a retained agent"]
    Explicit{"Was transport explicitly selected?"}
    UseExplicit["Use the selected transport"]
    BuiltIn{"Are all effective tools<br/>Pi built-in tools?"}
    ReadOnly{"Is the tool set read-only?"}
    InProcess["in-process<br/>Retained SDK session"]
    RPC["rpc<br/>Retained independent Pi process"]
    Subprocess["subprocess<br/>Fresh process for each turn"]
    Run["Create the child and accept the prompt"]
    Failure["Report startup or execution failure<br/>without switching transport"]

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
```

Read-only classification uses effective tool permissions rather than promises written in a task prompt.

Automatic selection never falls back after child creation or possible prompt acceptance because replay could duplicate side effects.
