# Pi Subagents Guidelines

## Bounded runtime

- Keep the registered provider-visible tool definitions fixed unless an approved public-contract change updates migration documentation and tests.
- Start at most one fresh Pi subprocess per accepted job and pass no parent transcript, unrelated extension, skill, prompt template, or retained state into the child.
- Provide fake Pi in subprocess tests through a test-owned `PI_PACKAGE_DIR` and `package.json#bin.pi`; never derive Pi from host `process.argv[1]`.
- Keep signalling a cancelled POSIX process group until captured stdout and stderr close because descendants can outlive the leader while retaining its streams.
- Commit terminal state before resolving waiters, and let the first terminal outcome win every completion, timeout, cancellation, replacement, and shutdown race.
- Deliver each bounded completion at most once with `deliverAs: "steer"` and `triggerTurn: false`.
- Keep caller await timeout and cancellation independent from child cancellation.
- Sanitize untrusted terminal text only at display boundaries while preserving bounded raw result details.
- Never read, migrate, rewrite, or delete legacy settings and retained-state files.

## Build and verification

- Keep the generated runtime input inventory aligned with the complete active source graph.
- Preserve deterministic source-mapped staging, validation, and atomic `dist` publication.
- Exercise process-group cleanup, source and generated loader paths, lifecycle replacement, and non-waking completion behavior in focused tests.
