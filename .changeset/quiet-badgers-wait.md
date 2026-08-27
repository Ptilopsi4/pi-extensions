---
"@narumitw/pi-subagents": major
---

Replace retained background agents with four current-session bounded-job tools: `subagent_spawn`, `subagent_await`, `subagent_cancel`, and `subagent_inspect`.

Run each accepted job in one fresh isolated Pi subprocess with a closed core-tool allowlist, no parent transcript, no unrelated extensions or prompt resources, and bounded non-waking completion delivery.

Remove retained follow-ups, mailboxes, hierarchy, persistence, custom agents, worktree management, multiple transports, settings, completion requirements, structured contracts, peer tools, and the `/subagents settings` route.

Leave legacy settings and retained-state files untouched for downgrade recovery.
