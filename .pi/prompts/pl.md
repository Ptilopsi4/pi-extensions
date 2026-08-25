---
description: Research, plan, and complete an objective using a dated plan
argument-hint: "[objective]"
---

${ARGUMENTS:-Derive the objective from the preceding conversation.}

Use `docs/plans/YYYY-MM-DD_<topic>-plan.md` as the executable source of truth for this objective.
Replace `YYYY-MM-DD` with the current date and `<topic>` with a concise kebab-case topic.

## Planning workflow

1. Read the repository instructions and inspect the relevant code, tests, documentation, configuration, and history.
2. Resolve discoverable facts yourself.
   Ask one focused question only when missing information would materially change the plan.
3. Create or update `docs/plans/YYYY-MM-DD_<topic>-plan.md` without starting implementation.
   If the target file covers different active work, preserve it and ask how to proceed.
4. Review the plan for missing dependencies, edge cases, failure paths, compatibility concerns, and verification gaps.
5. Present the plan and wait for explicit approval.

The plan file must contain:

```markdown
## Goal
## Plan
## Completion Checklist
```

Add only useful optional sections:

```markdown
## Context
## Architecture
## Tech Stack
## Non-Goals
## Assumptions
## Unknowns
## Risks
## Rollback / Recovery
```

## Plan quality rules

- Write each plan step and completion criterion as a Markdown checkbox.
- Make every checkbox specific, finite, actionable, and independently verifiable.
- State the expected result and verification method in each checkbox.
- Order steps by dependencies and identify safe checkpoints or rollback actions where relevant.
- Cover tests, documentation, compatibility, migration, cleanup, and release work only when applicable.
- Keep failed, blocked, skipped, or unverified work unchecked.
- Do not mark an item complete based only on implementation; verify its result first.

## Execution workflow

After approval:

1. Execute one plan item at a time.
2. Verify the item immediately after completing it.
3. Check it off and append concise evidence, such as the command, test result, or inspected artifact.
4. Keep the dated plan file synchronized with discoveries and actual progress.
5. If a major scope, architecture, risk, or acceptance criterion changes, update the plan and request approval again before continuing.
6. Run the completion checklist and inspect the final diff.
7. Report the work as `DONE` only when every required checkbox has passed.

Report blockers and failed or unverified checks plainly.
