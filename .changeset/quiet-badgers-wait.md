---
"@narumitw/pi-subagents": major
---

Remove the blocking `subagent` and synchronous `subagent_consult` tools so the package exposes retained background delegation only.

Keep `subagent_await` as the intentional join whenever retained agents are enabled.

Remove blocking workflow inspection, settings, orchestration, and consultation behavior while preserving ignored legacy JSON fields for rollback with the previous package major.
