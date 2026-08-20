# 🧭 pi-workflow — Integrated Plan and Goal Workflow for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-workflow)](https://www.npmjs.com/package/@narumitw/pi-workflow) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

`@narumitw/pi-workflow` is an experimental Pi extension that combines Codex-like Plan mode and persistent Goal execution in one independently installable package.

It keeps the established `/plan` and `/goal` command surfaces while making the approved Plan-to-Goal handoff one owned, recoverable transition.

> **Experimental:** Workflow behavior, settings, and integrated persistence may change between releases.

Do not load this package together with `@narumitw/pi-plan-mode` or `@narumitw/pi-goal`.

Those packages intentionally share command, tool, event-channel, and session-state compatibility names with this combined replacement.

## ✨ Features

- Provides `/workflow`, `/plan`, and `/goal` from one extension.
- Registers required Plan and Goal lifecycle behavior eagerly while loading manager UI, Plan export writes, saved-plan authentication preflight, and fresh-session handoff code only when those routes are used.
- Preserves Plan exploration, structured questions, completion, save, export, tool selection, and thinking-level control.
- Supports an optional configurable global shortcut for toggling Plan mode, disabled by default.
- Supports Plan alone, Goal alone, and approved Plan-to-Goal execution without adding a non-Goal implementation path.
- Preserves Goal completion, blocking, external waits, pause, resume, edit, clear, token budgets, continuation guards, optional ordered queues, and managed-run RPC.
- Uses review-first handoff by default, matching Codex's authoritative-plan and explicit-approval workflow.
- Offers **Run with Goal** and **Start fresh with Goal** as the primary completed-plan actions.
- Supports explicitly pre-authorized automatic handoff from Plan completion to Goal execution.
- Sends one current-session implementation request containing the exact approved plan and Goal stale-turn contract.
- Creates linked Plan and Goal state before a fresh-session kickoff.
- Restores a ready Plan and clears provisional Goal state when current-session activation or delivery fails.
- Leaves the source Plan resumable when fresh-session creation is cancelled or partially fails.
- Prevents Plan and Goal from competing for active tools or automatic turns in one session.
- Uses one optional, atomically published `pi-workflow.json` settings file.
- Shows independent `workflow:plan` and `workflow:goal` status channels.

## 📦 Install

Install persistently from npm:

```bash
pi install npm:@narumitw/pi-workflow
```

Try without installing permanently:

```bash
pi -e npm:@narumitw/pi-workflow
```

Try the local package from this repository:

```bash
pi -e ./packages/pi-workflow
```

Pi extensions run with the same permissions as Pi.

Only install extensions from sources you trust.

Remove the standalone Plan and Goal packages from the same Pi configuration before loading this combined package.

## 🚀 Quick start

Open the combined manager:

```text
/workflow
```

Start planning:

```text
/plan describe the feature and produce an implementation plan
```

A Plan can remain planning-only: save it, export it, continue revising it, or discard it without execution.

When the Plan is ready, choose **Run with Goal** to keep the planning conversation or **Start fresh with Goal** to transfer only the approved Plan.

Start Goal directly when no prior Plan is needed:

```text
/goal implement and verify the requested change
```

Use `/goal` to inspect, pause, resume, edit, or clear managed execution.

## 🔁 Plan-to-Goal handoff

### Review first

`review` is the default handoff behavior.

Plan completion creates an authoritative ready Plan but does not grant execution authority by itself.

The ready menu offers:

1. **Run with Goal** — restore normal tools and start Goal in the same session with the planning conversation.
2. **Start fresh with Goal** — create a linked session carrying only the exact approved plan and Goal state.
3. Export, save, continue planning, or discard the Plan without starting Goal.

`/plan implement` remains the direct compatibility route for **Run with Goal**.

### Automatic

`automatic` is an explicit pre-authorization.

After `plan_mode_complete` settles, the extension starts Goal without opening the ready menu.

Automatic handoff is off by default because it can begin long-running work that consumes tokens and provider cost.

### Failure and cancellation

A failed current-session Goal activation or kickoff restores the exact ready Plan and clears the provisional Goal.

Cancelling fresh session replacement leaves the source Plan unchanged.

If both fresh destination states cannot be saved, any published Plan state is compensated and an unmanaged exact-Plan implementation prompt is placed in the editor.

That recovery prompt never claims Goal is active when Goal state is unavailable.

If the destination kickoff fails after state is saved, the destination retains both Plan and Goal state so `/goal` can inspect or resume it.

The source planning session remains resumable after every fresh handoff.

### Linked Plan lifecycle

Implement always starts Goal; `pi-workflow` has no non-Goal implementation path.

The exact approved Plan remains linked and available while Goal is active, paused, blocked, waiting, usage-limited, budget-limited, retried, compacted, or resumed.

The original combined handoff supplies the first Goal request without duplication.

After that handoff disappears from model context, the extension injects one hidden canonical copy of the exact Plan instead of depending on a lossy compaction summary.

Goal completion, clear, or successful supersession clears the linked Plan so stale context does not leak into later work.

A linked `/plan exit` is rejected because it would leave Goal referring to a missing Plan; use `/goal` to manage execution or `/goal clear` to stop it and clear both states.

Persisted unlinked implementation state is recovered as a ready Plan because no Goal owns execution.

## 💬 Commands

### Workflow manager

| Command | Behavior |
| --- | --- |
| `/workflow` | Open combined Plan, Goal, Settings, Status, and Help screens. |

`/workflow` accepts no arguments.

It works in TUI and RPC modes and rejects print and JSON modes before opening interactive UI.

### Plan

```text
/plan
/plan start
/plan <prompt>
/plan tools
/plan show
/plan finalize
/plan implement
/plan save
/plan export [path]
/plan exit
```

`/plan` retains the Plan-mode read-only tool policy, structured `plan_mode_question` interaction, standalone `plan_mode_complete` completion contract, saved-plan slot, export safety, session persistence, and compaction-aware linked-Plan context.

`/plan implement` is the direct compatibility route for starting the ready or saved Plan as Goal in the current session.

A new Plan cannot start while any unfinished Goal exists.

Clear the Goal first so one runtime owns tool restrictions and automatic work.

Plan mode has no global shortcut until `plan.toggleShortcut` configures one; the configured key then toggles Plan mode and respects the same Goal and saved-plan guards as `/plan`.

### Goal

```text
/goal
/goal status
/goal [--tokens 100k] <objective>
/goal edit <objective>
/goal pause
/goal resume
/goal clear
```

When the experimental ordered queue is enabled:

```text
/goal add [--tokens 20k] <objective>
/goal prioritize [--tokens 20k] <objective>
/goal drop-last
/goal skip
```

`/goal` retains stale goal IDs, requirement-by-requirement completion audits, distinct stopped states, settled-idle continuation, token accounting, automatic-response and no-progress guards, wait deadlines, compaction recovery, queue behavior, and managed-run RPC.

A manual Goal cannot start while Plan mode or an active implementation Plan owns the session.

The integrated Plan handoff bypasses that public guard only for its atomic Goal activation.

## 🛠️ Tools

Plan mode registers:

- `plan_mode_question`
- `plan_mode_complete`

Goal mode registers:

- `goal_complete`
- `goal_blocked`
- `goal_wait`

Plan mode activates only selected inspection tools plus its required tools and blocks unsafe mutation paths.

Goal activation restores normal tools and reveals the Goal terminal tools according to Goal settings.

The Goal managed-run event channels retain their compatibility names:

```text
pi-goal:start
pi-goal:cancel
pi-goal:event:<runId>
```

## ⚙️ Settings

Open `/workflow` → **Settings** to change handoff behavior or open the complete Plan and Goal settings editors.

The optional user file is:

```text
<getAgentDir()>/pi-workflow.json
```

It is normally `~/.pi/agent/pi-workflow.json`.

A missing file uses defaults and is not created by reads.

Example:

```json
{
  "workflow": {
    "planHandoff": "review"
  },
  "plan": {
    "thinkingLevel": "inherit",
    "defaultPlanTools": ["read", "bash", "grep", "find", "ls"],
    "defaultPlanExportPath": "PLAN.md",
    "toggleShortcut": "<your_key>",
    "safeSubcommands": {
      "git": ["status", "log", "diff", "show"]
    }
  },
  "goal": {
    "toolVisibility": "after-first-goal",
    "experimental": {
      "goals": false
    },
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

`workflow.planHandoff` accepts `review` or `automatic`.

The `plan` object accepts Plan thinking, tools, export destination, Plan-mode shortcut, and reviewed shell-subcommand defaults.

`plan.toggleShortcut` controls the global Plan-mode keybinding and accepts a Pi key identifier such as `ctrl+alt+p`.

Omit it—or submit an empty value in **Plan mode shortcut**—to keep the shortcut disabled.

Avoid values that conflict with editor shortcuts.

An invalid key string makes the whole settings file read-only, so fix it before saving again.

A shortcut saved through Settings is rebound immediately; a manual file edit applies on the next session start or `/reload`.

The standalone `implementationPlanRetention` setting is not used by `pi-workflow` because every Implement action starts Goal and keeps the exact Plan until linked execution ends.

A legacy `plan.implementationPlanRetention` field is ignored and preserved as unknown data during ordinary settings saves.

The `goal` object accepts the same tool visibility, queue, RPC, and continuation-limit settings as the standalone Goal extension.

Settings changes made through menus apply immediately where safe.

External edits are loaded on session start or `/reload`.

Every save validates the complete document, preserves unknown top-level and nested fields, writes a private same-directory temporary file, and publishes with rename.

Malformed, invalid, oversized, symbolic-link, or non-regular settings files are read-only and are never overwritten.

Writes are ordered inside one Pi process because publication is synchronous and atomic.

Separate Pi processes are not coordinated by a cross-process lock and can still race.

The standalone `pi-plan-mode.json` and `pi-goal.json` files are not silently copied or modified.

Recreate their desired values through `/workflow` or manually place them under the matching `plan` and `goal` objects.

## 📊 Status and persistence

`workflow:plan` reports `plan active`, `plan ready`, `plan saved`, or `plan implementing` while the exact Plan is linked to Goal.

`workflow:goal` reports active, waiting, paused, blocked, usage-limited, budget-limited, complete, and queue-frozen states.

Plan and Goal session entries retain their established compatibility names so existing session branches can be restored when this package replaces the standalone extensions.

Current-session handoff publishes Plan state before Goal activation and rolls it back if activation fails.

Fresh-session handoff serializes both states before sending the implementation request.

Session replacement, reload, and shutdown abort owned menus and release timers, statuses, widgets, pending prompts, and continuation work.

## ⚠️ Safety and limitations

Plan mode's shell policy reduces accidental mutation but is not an operating-system sandbox.

Selected extension tools can still mutate or disclose data and are enabled at user risk.

Goal completion relies on the model's evidence audit plus stale-ID and contradiction checks; the extension cannot independently prove arbitrary external work complete.

Automatic Goal work can consume substantial tokens and provider cost.

Keep finite safety limits unless unlimited execution is an informed choice.

This experimental package owns source snapshots of the stable Plan and Goal implementations so it remains independently installable.

This is an explicit prototype deviation from the existing shared workflow-engine roadmap.

The package must migrate to one shared engine, or receive a superseding architecture decision, before promotion to stable.

It does not import or depend on another extension package.

Behavioral updates to either stable predecessor must be intentionally synchronized and reverified here.

## 🗂️ Package layout

```text
packages/pi-workflow/
├── src/
│   ├── index.ts       # Thin Pi package entrypoint
│   ├── workflow.ts    # Composition, lifecycle, and retryable first-use loaders
│   ├── workflow-contract.ts # Lightweight shared handoff identity
│   ├── handoff.ts     # First-use fresh linked-session Plan-to-Goal transfer
│   ├── menu.ts        # Standard /workflow TUI and RPC manager
│   ├── settings.ts    # Unified validated and atomic settings store
│   ├── plan/          # Plan runtime with retryably loaded cold actions
│   └── goal/          # Package-owned Goal runtime
├── test/
├── README.md
├── LICENSE
├── package.json
└── tsconfig.json
```

## 🔎 Keywords

Pi extension, Pi coding agent, workflow, Plan mode, Goal mode, autonomous coding agent, read-only planning, implementation handoff, verification.

## 📄 License

MIT.

See [`LICENSE`](./LICENSE).
