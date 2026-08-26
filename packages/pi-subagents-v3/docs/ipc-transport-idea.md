# Per-child IPC transport idea

## Status

This document records an unverified implementation idea for later evaluation.

The current loopback TCP broker remains the implemented and authoritative transport.

Do not treat this document as an approved migration plan or compatibility guarantee.

## Motivation

The TCP broker provides authenticated cross-process messaging but requires a server, ephemeral port, per-job tokens, socket lifecycle management, NDJSON framing, connection deadlines, and long-poll handling.

A private communication channel created with each child process may preserve the messaging contract with fewer transport concepts and less lifecycle code.

## Proposed direction

Spawn each child with a private Node.js child-process IPC channel:

```ts
spawn(command, args, {
	stdio: ["ignore", "pipe", "pipe", "ipc"],
});
```

Bind the channel to the job represented by that child process rather than accepting a job identifier or authentication token from the child.

Send question events from the child to the parent and reply events from the parent to the child over the same persistent channel.

Keep request state in a small session-owned registry in the parent and keep child wait promises in the child bridge.

A possible exchange is:

```text
child -> parent: ask(message)
parent -> child: accepted(requestId)
child -> parent: wait(requestId)
main agent -> parent: reply(requestId, message)
parent -> child: response(requestId, message)
```

The exact wire messages and ownership boundaries remain undecided.

## Complexity that may be removed

A successful IPC design may remove:

- The loopback TCP server and ephemeral port.
- Per-job broker tokens and broker environment variables.
- Socket connection and connection-limit management.
- Custom NDJSON request and response framing.
- Connection and frame deadlines.
- Long-poll socket ownership.
- Cross-job token validation.

## Behavior that must remain

Any replacement must preserve:

- A fresh child Pi process with no inherited main-agent conversation history.
- Fixed `subagent-ask` and child `subagent-wait` tools.
- Main-agent `subagent-reply` behavior.
- Plain-text replies.
- At most four outstanding requests per job.
- The 50 KiB UTF-8 message limit and 2,000-line reply limit.
- First-reply-wins semantics.
- Retryable waits after timeout.
- Caller cancellation that stops only the current wait.
- Immediate rejection of pending waits after job cancellation, child exit, session replacement, reload, or shutdown.
- Bounded retained state and terminal-safe cleanup.
- Untrusted-content handling and terminal sanitization.
- No peer messaging, retained child conversations, or nested subagents.

## Compatibility spike

Before selecting IPC, build the smallest possible spike that proves bidirectional messages, cancellation, child exit, and repeated cleanup through the actual Pi launch path.

Exercise the spike with npm-installed Node.js Pi, Bun execution, and the Pi standalone executable where available.

Include Linux and macOS, and include Windows before claiming Windows compatibility.

Verify that the IPC channel does not interfere with Pi JSON output, subprocess termination, detached process-group cleanup, or extension loading.

Reject the IPC design if any supported runtime cannot expose a reliable private channel without runtime-specific branches or substantial fallback code.

## Fallback

If child-process IPC is not portable enough, evaluate dedicated inherited file descriptors such as fd 3 and fd 4.

Inherited pipes can still remove TCP addressing and authentication, but they require a bounded framing protocol and explicit stream lifecycle handling.

HTTP loopback may simplify framing incrementally, but it retains the server, port, token, and network lifecycle and therefore offers a smaller reduction.

Do not use filesystem polling or share Pi's normal stdin and stdout unless evidence shows that their additional coupling and cleanup remain simpler than the current transport.

## Decision criteria

Adopt a replacement only if it measurably reduces implementation and lifecycle complexity while preserving current behavior and supported runtime compatibility.

Prefer the current TCP broker if the replacement requires runtime-specific branches, multiple transport fallbacks, or weaker isolation.
