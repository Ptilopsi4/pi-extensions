# @narumitw/pi-workflow

## 0.4.0

### Minor Changes

- 1809ba0: Add an optional configurable global shortcut for toggling Plan mode through `plan.toggleShortcut` and the **Plan mode shortcut** Settings row, disabled by default and guarded by the same Goal and saved-plan checks as `/plan`.

## 0.3.1

### Patch Changes

- 5a14026: Reduce idle Pi startup imports by loading Subagents execution and selected transport implementations, plus Workflow manager and fresh-session handoff code, only when their registered routes first need them.

## 0.3.0

### Minor Changes

- 6132845: Keep each approved Plan linked and compaction-safe until its Goal completes, is cleared, or is superseded, and retire workflow-specific implementation retention choices.

## 0.2.0

### Minor Changes

- 3aa6588: Add an experimental combined `/workflow`, `/plan`, and `/goal` extension with review-first or explicitly automatic Plan-to-Goal handoff, unified settings, and recoverable current or fresh-session activation.
