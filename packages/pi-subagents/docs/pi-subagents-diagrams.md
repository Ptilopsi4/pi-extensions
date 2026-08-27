# pi-subagents architecture diagrams

These diagrams describe the bounded job surface, process boundary, and lifecycle.

## Overall architecture

```mermaid
flowchart TB
    Root["Main Pi Agent<br/>planning / coordination / verification / final answer"]
    Extension["pi-subagents<br/>current-session adapter"]

    subgraph Surface["Fixed Tool Surface"]
        Spawn["subagent_spawn"]
        Await["subagent_await"]
        Cancel["subagent_cancel"]
        Inspect["subagent_inspect"]
    end

    Runtime["In-memory Job Runtime<br/>8 active / 32 terminal summaries"]
    Process["Fresh Pi Subprocess<br/>one per accepted job"]
    Widget["TUI Active-job Widget"]
    Completion["Bounded Non-waking Completion"]

    Root --> Extension
    Extension --> Surface
    Spawn --> Runtime
    Await --> Runtime
    Cancel --> Runtime
    Inspect --> Runtime
    Runtime --> Process
    Runtime --> Widget
    Runtime --> Completion
    Completion --> Root
```

## Spawn and completion

```mermaid
sequenceDiagram
    participant R as Main Agent
    participant E as Extension
    participant J as Job Runtime
    participant P as Fresh Pi Child

    R->>E: subagent_spawn(task, tools?, thinkingLevel?, timeout?)
    E->>E: Validate session, schema, bytes, tools, model, depth, capacity
    E->>J: Admit queued job
    E-->>R: jobId

    Note over R: Continue useful non-overlapping work

    J->>P: Start isolated JSON-mode process
    P-->>J: Bounded JSON events
    P-->>J: Terminal assistant result or failure
    J->>J: Commit first terminal state
    J-->>R: steer completion with triggerTurn false

    opt Intentional join
        R->>E: subagent_await(jobId, timeout?)
        E->>J: Race terminal, caller timeout, and caller abort
        J-->>E: Terminal result or wait timeout
        E-->>R: Bounded result
    end
```

A wait timeout or caller cancellation releases only the waiter.

It never cancels the child.

## Child boundary

```mermaid
flowchart LR
    Input["Self-contained task"] --> Args["Fixed Pi CLI arguments"]
    Model["Current provider / model / thinking"] --> Args
    Trust["Current cwd / trust decision"] --> Args
    Tools["Approved core-tool allowlist"] --> Args
    Args --> Child["Fresh Pi subprocess"]

    Disabled["Disabled:<br/>session / extensions / skills / prompt templates"] -.-> Child
    Absent["Absent:<br/>parent transcript / broker / mailbox / retained state"] -.-> Child

    Child --> Decoder["Bounded JSON event decoder"]
    Decoder --> Terminal["completed / partial / failed / timed_out / cancelled"]
```

## Replacement and shutdown

```mermaid
sequenceDiagram
    participant Pi as Pi Lifecycle
    participant E as Extension Owner
    participant J as Job Runtime
    participant U as Widget
    participant P as Child Processes

    Pi->>E: session_start replacement
    E->>E: Invalidate prior generation
    E->>U: Clear widget and stop timer/subscription
    E->>J: Shutdown prior session
    J->>P: Abort every active child
    P-->>J: Process cleanup settles
    J->>J: Clear job map
    E->>J: Begin replacement session
    E->>U: Bind replacement widget

    Pi->>E: stale prior session_shutdown
    E-->>Pi: Ignore because session manager does not match
```
