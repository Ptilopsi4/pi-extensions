# Migrate from pi-workflow

`@narumitw/pi-workflow` is archived in this repository.

Use the maintained [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) and [`@narumitw/pi-goal`](https://www.npmjs.com/package/@narumitw/pi-goal) packages for focused planning and autonomous execution.

## Support decision

The repository deprecation is effective immediately and its warning remains permanently in the archived package README and root deprecated-package list.

The archived source, generated-runtime builder, and tests remain available as historical reference under `deprecated/pi-workflow`.

They are excluded from active workspace builds, typechecks, tests, package releases, and routine dependency updates.

The archive receives no feature, compatibility, or security fixes.

The npm package has not been deprecated and no package, tag, or release was created by the repository deprecation.

Any npm deprecation or other external action requires separate explicit approval.

## Evidence reviewed

Plan `0.52.0` and Goal `0.53.0`, the minimum versions that implement Workflow Mutex Protocol v1 together, are published on npm.

The [coexistence release-readiness record](./implementation-notes/2026-08-22_plan-goal-coexistence-release-readiness.md) covers both load orders, both acquisition orders, lifecycle cleanup, restoration, tool safety, package checks, and isolated Pi loading.

The npm downloads API reported 968 `pi-workflow` downloads across nine non-zero days from its first publication on 2026-08-12 through 2026-08-21.

Download counts include automated and repeated downloads, so they show exposure rather than a count of affected users.

Migration was approved despite that exposure because maintaining copied Plan and Goal implementations creates continuing synchronization cost, while the focused packages now coexist without depending on each other.

## Behavior mapping

| Existing use | Focused replacement |
| --- | --- |
| Plan without execution | Install Plan and continue using `/plan`, `plan_mode_question`, and `plan_mode_complete`. |
| Goal without prior planning | Install Goal and continue using `/goal`, `goal_complete`, `goal_blocked`, and `goal_wait`. |
| Plan and Goal in one Pi session | Install both supported floors or newer on the characterized Pi runtime; their anonymous workflow mutex prevents simultaneous activation. |
| `/plan implement` for ordinary implementation | Use Plan's `/plan implement`; it restores normal tools and starts ordinary implementation without activating Goal. |
| Direct managed Goal execution | Use Goal's `/goal` routes or its `pi-goal:start`, `pi-goal:cancel`, and `pi-goal:event:<runId>` protocol. |
| `/workflow` combined manager | No replacement; use the separate `/plan` and `/goal` managers. |
| Reviewed or automatic atomic Plan-to-Goal handoff | No replacement. |
| Fresh linked-session Goal handoff | No replacement. |
| Handoff rollback that restores the exact ready Plan | No replacement. |
| One unified Plan and Goal settings menu and file | No replacement; migrate the two nested settings objects into separate files. |
| Experimental ordered Goal queue | No replacement; merge remaining work into one explicit Goal objective. |

The focused packages coordinate only whether an agent workflow group is busy.

They do not identify one another, transfer a Plan, start one another, share state, or compose tool policies.

## Safe switch-over

1. Finish or stop active combined work before changing extensions.
2. Export any ready Plan that must survive the switch, and use `/goal clear` for combined Goal state that should not resume.
3. Exit Pi so no old command handlers, timers, prompts, or tool policies remain in memory.
4. Remove the combined package.

```bash
pi uninstall npm:@narumitw/pi-workflow
```

5. Install one or both focused packages.

```bash
pi install npm:@narumitw/pi-plan-mode
pi install npm:@narumitw/pi-goal
```

6. Start a new Pi process and confirm `/plan` and `/goal` show the expected inactive state before starting work.

Do not load the archived package with either focused package.

They intentionally reuse commands, tools, event channels, and session-entry names, which would create duplicate handlers and competing state owners.

Do not rely on an unfinished combined workflow restoring across the package switch.

Export or finish important work first.

## Settings migration

The combined file is normally `~/.pi/agent/pi-workflow.json`, or `$PI_CODING_AGENT_DIR/pi-workflow.json` when that environment variable is set.

Plan reads `pi-plan-mode.json` in the same agent directory.

Goal reads `pi-goal.json` in the same agent directory.

Copy only the nested `plan` object from the combined file into the top level of `pi-plan-mode.json`.

Copy only supported fields from the nested `goal` object into the top level of `pi-goal.json`.

Do not copy the top-level `workflow` object because `workflow.planHandoff` has no focused-product equivalent.

Do not copy `goal.experimental.goals` because the ordered Goal queue has been removed.

For example, migrate this combined file:

```json
{
  "workflow": {
    "planHandoff": "review"
  },
  "plan": {
    "thinkingLevel": "high",
    "defaultPlanTools": ["read", "bash", "grep", "find", "ls"],
    "defaultPlanExportPath": "PLAN.md"
  },
  "goal": {
    "toolVisibility": "after-first-goal",
    "rpc": {
      "enabled": false
    },
    "continuationLimits": {
      "automaticTurns": 25,
      "noProgressTurns": 3
    }
  }
}
```

into `pi-plan-mode.json`:

```json
{
  "thinkingLevel": "high",
  "defaultPlanTools": ["read", "bash", "grep", "find", "ls"],
  "defaultPlanExportPath": "PLAN.md"
}
```

and `pi-goal.json`:

```json
{
  "toolVisibility": "after-first-goal",
  "rpc": {
    "enabled": false
  },
  "continuationLimits": {
    "automaticTurns": 25,
    "noProgressTurns": 3
  }
}
```

Keep backups until each focused package accepts its file without a warning.

The focused settings writers preserve unknown fields, but recognized invalid values make the complete file read-only until fixed.

## Manual Plan-to-Goal alternative

When a durable handoff is needed, export the approved Plan to a reviewed file and start Goal with an explicit objective that names that file.

Exporting a ready Plan leaves Plan mode automatically; clear any saved or active implementation Plan explicitly before Goal when it should no longer remain active.

For example:

```text
/plan export PLAN.md
/goal implement and verify the approved plan in PLAN.md
```

Review the exported file before starting Goal and keep it unchanged while Goal depends on it.

This sequence is deliberately manual.

It does not provide atomic activation, automatic handoff, a fresh linked session, hidden exact-Plan reinjection, or rollback to the ready Plan when Goal kickoff fails.
