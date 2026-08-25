# Cache hit monitor

This project-local Pi extension displays live prompt-cache diagnostics above the editor.
Pi discovers it automatically after the project is trusted, and `/reload` activates source changes.
The widget starts hidden in every session.

## Command

Run `/cache-hit-monitor` to show or hide the widget.
The command accepts no arguments and is available in TUI and RPC modes.

## Displayed metrics

- `hit` is `cacheRead / (input + cacheRead + cacheWrite)` for the latest provider response.
- `Δ` is the signed percentage-point change from the previous comparable request.
- `loss` is only the downward part of that hit-rate change.
- `uncached` is the latest `input` share and token count.
- `eligible` is the smaller prompt-token count between the previous and current request.
- `re-billed` estimates reusable-prefix tokens not covered by the current `cacheRead` count.
- `cache saved` estimates the price difference between uncached input and cache-read pricing.
- `miss premium` estimates the extra price of re-billed tokens compared with cache-read pricing.
- `Session` reports weighted active-branch totals and does not average request percentages.
- `Trend` shows the latest eight request hit rates from oldest to newest.

## Runtime behavior

While visible, the widget updates from `message_update` as soon as the provider reports usage and finalizes on `message_end`.
Cache comparisons reset across compaction and branch-summary boundaries because those events create a new cache prefix epoch.
Session totals continue to include usage records visible on the active branch.
The extension rebuilds state after session start, compaction, and tree navigation.
It clears its widget during session shutdown and ignores events from replaced sessions.
It does not add model-visible tools, messages, system instructions, or provider payload changes.

## Limitations

All values depend on provider-reported Pi usage fields and can remain unavailable when a provider omits cache accounting.
`re-billed` compares token counts and cannot prove which exact serialized prefix bytes the provider cached.
Cost values are estimates based on reported usage costs or the matching Pi model rates, and subscription billing can differ.
Cache writes are included in the repository-standard hit-rate denominator but are not labeled as uncached input.
