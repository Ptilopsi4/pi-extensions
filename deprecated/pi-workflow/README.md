# 🧭 pi-workflow — Deprecated Integrated Plan-to-Goal Workflow

[![npm](https://img.shields.io/npm/v/@narumitw/pi-workflow)](https://www.npmjs.com/package/@narumitw/pi-workflow) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> `@narumitw/pi-workflow` is deprecated, kept under `deprecated/` for reference, and excluded from active workspace checks, tests, releases, and maintenance.
> Every published version is npm-deprecated with `Deprecated: this package is no longer maintained.`
> Migrate to [`@narumitw/pi-plan-mode`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-plan-mode) and [`@narumitw/pi-goal`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal) by following the [migration instructions](#-migration-from-pi-workflow) below.
> The focused packages do not replace atomic or automatic Plan-to-Goal handoff, the `/workflow` manager, unified settings, or handoff rollback.
> Remove the deprecated package with:
>
> ```bash
> pi uninstall npm:@narumitw/pi-workflow
> ```

This archived extension explored and approved an implementation plan, then handed the exact plan to persistent Goal execution in the same session or a fresh linked session.

It combined the established `/plan` and `/goal` workflows into one recoverable Plan-to-Goal transition.

> [!IMPORTANT]
> Do not load this package with `@narumitw/pi-plan-mode` or `@narumitw/pi-goal` because they intentionally share commands, tools, event channels, and session-state names.

## ✨ Features

- Provided `/workflow`, `/plan`, and `/goal` from one package.
- Supports planning alone, Goal execution alone, or an explicit approved Plan-to-Goal handoff.
- Preserves structured Plan questions, completion, save, export, tool selection, and thinking-level control.
- Preserves Goal completion, blockers, external waits, pause, resume, edit, clear, budgets, queues, and managed-run RPC.
- Reviews handoffs by default and offers execution in the current conversation or a fresh linked session.
- Restores the ready Plan when activation, delivery, or fresh-session creation fails or is cancelled.
- Prevents Plan and Goal from competing for tools or automatic turns.
- Stores optional settings atomically and reports Plan and Goal status independently.
- Loads a generated split runtime while preserving lazy manager, export, preflight, and handoff chunks.

## 📦 Archived reference

Build and inspect the archived local package only when maintaining historical behavior:

```bash
cd deprecated/pi-workflow
npm run build
pi -e .
```

The package declares `dist/index.ts`, so the build command must finish before Pi loads the archived package directory.

An unbuilt checkout still declares `dist/index.ts`, but the generated entrypoint and chunks do not exist until the build completes.

Pi extensions run with the same permissions as Pi.

Do not load this archived package with Plan or Goal.

## 🔄 Migration from pi-workflow

Use the maintained [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) and [`@narumitw/pi-goal`](https://www.npmjs.com/package/@narumitw/pi-goal) packages for focused planning and autonomous execution.

The repository archive and npm deprecation are complete.

No replacement package, tag, or release was created as part of deprecation.

### Behavior mapping

| Existing use | Focused replacement |
| --- | --- |
| Plan without execution | Install Plan and continue using `/plan`, `plan_mode_question`, and `plan_mode_complete`. |
| Goal without prior planning | Install Goal and continue using `/goal`, `goal_complete`, `goal_blocked`, and `goal_wait`. |
| Plan and Goal in one Pi session | Install current supported releases on the characterized Pi runtime; their anonymous workflow mutex prevents simultaneous activation. |
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

### Safe switch-over

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

### Settings migration

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

### Manual Plan-to-Goal alternative

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

In TUI mode, a single `plan_mode_question` shows its header as plain muted text, submits as soon as its preset or custom answer is confirmed, and does not show tabs, Review, or question-navigation controls.
Add an optional note with `n` before confirming a single preset answer.
With two or three questions, the interaction shows one question at a time with question tabs and a final Review tab.
Use Tab, Shift+Tab, left, or right to visit any question or Review, including unanswered future questions.
Use up and down to choose an option, Enter to record it and advance, or `n` to record the highlighted option and open its optional note editor.
Press `n` again on an answered item to edit or clear its note.
Revisiting a question can replace its answer, and changing the selected option clears its prior note.
Review lists every answer and note, blocks incomplete submission, and requires returning to a question to edit its answer or note.
Custom answers and notes retain their raw submitted text in the tool result, while terminal rendering is sanitized.
The TUI rejects either field above 4,000 characters instead of truncating it.
RPC keeps the existing sequential `select` and `editor` dialogs because Pi RPC cannot render custom TUI components.

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

## 🔒 Security and privacy

Plan mode's shell policy reduces accidental mutation but is not an operating-system sandbox.

Selected extension tools can still mutate or disclose data and are enabled at user risk.

Goal completion relies on the model's evidence audit plus stale-ID and contradiction checks; the extension cannot independently prove arbitrary external work complete.

Automatic Goal work can consume substantial tokens and provider cost.

Keep finite safety limits unless unlimited execution is an informed choice.

## 🚧 Limitations

This archived package owns source snapshots of the Plan and Goal implementations as they existed at deprecation.

It does not import or depend on another extension package.

It receives no feature, compatibility, or security fixes.

Use the focused Plan and Goal packages for maintained behavior.

## 🗂️ Package layout

```text
deprecated/pi-workflow/
├── dist/              # Generated split TypeScript runtime loaded through Pi's Jiti loader
├── scripts/
│   └── build-runtime.mjs # Deterministic bundler and eager-boundary validator
├── src/
│   ├── index.ts       # Thin authoritative source entrypoint
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
