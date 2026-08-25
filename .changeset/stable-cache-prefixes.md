---
"@narumitw/pi-todo": patch
"@narumitw/pi-subagents": patch
---

Restore compacted todo and required-subagent state at deterministic summary boundaries, retain each restored message for its summary epoch as later tail evidence supersedes it, and append restored required-run cancellations after stale retained handoffs while keeping request prefixes stable.

Publish mutable subagent catalog and policy guidance through append-only session contracts instead of re-registering provider-visible tools.
