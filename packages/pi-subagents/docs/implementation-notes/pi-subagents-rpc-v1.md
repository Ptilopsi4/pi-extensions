# Historical pi-subagents RPC v1 note

This document is historical evidence for the removed retained RPC transport.

The active bounded runtime does not load, register, maintain, or fall back to RPC transport behavior.

It starts one fresh Pi subprocess per accepted job through `src/job-process.ts`.

The prior RPC contract included persistent child sessions, request correlation, turn cancellation, readiness negotiation, and transport metadata.

Those behaviors are unsupported by the current four-tool contract, and their executable source has been deleted.

Do not use this note as active implementation or user guidance.

See [`pi-subagents-current-direction.md`](pi-subagents-current-direction.md) and [`../async-runtime-protocol.md`](../async-runtime-protocol.md) for the active runtime boundary.
