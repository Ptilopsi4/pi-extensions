# 🌳 pi-worktree — Safe Git Worktree Management for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-worktree)](https://www.npmjs.com/package/@narumitw/pi-worktree) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

`@narumitw/pi-worktree` adds one interactive `/worktree` command for common Git worktree operations and Pi workspace switching.

Pi cannot change its parent process working directory with `cd`. This extension performs the safe equivalent: it prepares a Pi session whose cwd is the selected worktree and switches to that session, preserving the current conversation when it has already been persisted.

## ✨ Features

- Shows compact main, linked, current, detached, locked, and prunable state in worktree selectors.
- Provides an on-demand, searchable status snapshot with staged, unstaged, untracked, conflict, upstream, and last-commit details.
- Creates a new branch worktree or attaches an existing unoccupied local branch.
- Previews the exact local base source and full commit OID before creation.
- Rejects occupied targets and unresolvable symbolic-link ancestors before Git can create a branch.
- Suggests `~/.worktrees/<main-worktree-name>/<branch>` by default and lets the user configure the root interactively.
- Optionally switches Pi into a newly created worktree while continuing the current conversation.
- Switches among existing registered worktrees through Pi's public session replacement API.
- Removes unlocked, non-current linked worktrees and preserves their branches.
- Refuses removal when tracked, untracked, manually index-flagged, submodule, or current unreachable detached-commit data may be lost.
- Allows ignored-only data such as `node_modules/` after listing it in the destructive confirmation.
- Names recovery-only administrative commits in the destructive confirmation instead of making ordinary rebase/reset history block cleanup forever.
- Always previews stale metadata before pruning it and revalidates the preview after confirmation.
- Runs Git through argv-based subprocess calls, without interpolating user input into shell commands.

## 📦 Install

```bash
pi install npm:@narumitw/pi-worktree
```

Try without installing permanently:

```bash
pi -e npm:@narumitw/pi-worktree
```

Try this package locally from the repository root:

```bash
pi -e ./packages/pi-worktree
```

## 🚀 Quick start

Run `/worktree` in TUI or RPC mode and choose the worktree action you need.
Every mutation shows package-owned safety checks and an exact confirmation before Git changes the worktree state.

## 💬 Commands

Run the command without arguments:

```text
/worktree
```

Choose one action:

- **Worktree status** — browse a local snapshot for every registered worktree without fetching remotes.
- **Add worktree** — enter a branch, optional start point, and optional path; review exact base provenance, confirm creation, and optionally switch.
- **Switch worktree** — search for another existing worktree by displayed path, branch, or HEAD and continue this Pi conversation there.
- **Remove worktree** — search for a linked worktree by displayed path, branch, or HEAD, then remove it without deleting its branch; ignored-only data is listed for explicit confirmation.
- **Prune stale metadata** — inspect Git's dry-run output, then optionally run the matching prune.
- **Configure worktree root** — set a machine-local default root or submit a blank value to restore `~/.worktrees`.

The standard root menu shows the registered count, current path, effective worktree root, its source,
and any settings warning. Escape closes it. `/worktree` intentionally does not accept text
subcommands or expose argument autocomplete. Every change is initiated and confirmed through TUI or
RPC dialogs; print and JSON modes reject the command observably. Operation-specific branch/path
inputs, searchable worktree identity selectors, preflight previews, and destructive confirmations remain
extension-owned because they carry Git safety and commit-aware revalidation.

The status browser runs only when selected and has no watcher, timer, persistent cache, or network
fetch. Each card shows textual current/main/detached state, full snapshot HEAD, aggregate working-tree
counts, configured upstream ahead/behind, and the last commit timestamp and subject. A missing
upstream is reported as **not configured**; it is not treated as proof that no commits are unpushed.
Bare, missing, prunable, or individually failing worktrees remain visible with an unavailable reason.
The snapshot is informational and can become stale immediately, so Remove still performs its stricter
inventory and identity checks.

## 🌿 Add defaults

For a new branch, the current symbolic branch is the default start point. If Pi is running from detached HEAD, the command requires an explicit commit-ish. Git must resolve the start point to exactly one commit.

Before mutation, Add identifies whether the branch is new or existing and displays the provenance as the current branch, an explicit commit-ish, or an existing local branch together with its full resolved OID and target path. New branches are created from that approved OID even if the source ref later moves. Existing branches are checked again immediately before mutation and the created worktree HEAD is verified afterward. Git has no atomic compare-and-add operation for attaching an existing branch, so a post-add mismatch is retained for inspection rather than rolled back.

The default root is `~/.worktrees`, where `~` is Node's platform home directory. Suggestions use the registered main worktree's directory name, not the current linked-worktree cwd:

```text
main worktree: /home/user/workspace/project
branch:        feat/login
root:          /home/user/.worktrees
suggested:     /home/user/.worktrees/project/feat-login
```

On Windows, the equivalent default is such as `C:\Users\Alice\.worktrees`. Branch `/` characters become `-`. The extension does not add hashes or collision suffixes: if two normalized paths collide or the target already exists, Add stops before Git mutation.

Leave the path input blank to accept the suggestion. A custom absolute path is used directly; a custom relative path is resolved from the current Pi cwd. The target itself must not exist, and its nearest existing ancestor must resolve without a broken or looping symbolic link. Existing registered worktrees are never moved when this default changes.

The MVP does not expose `--force`, `-B`, `--detach`, `--orphan`, or lock options.

## ⚙️ Settings

The machine-local user settings file is:

```text
<getAgentDir()>/pi-worktree.json
```

For a default Pi installation this is typically `~/.pi/agent/pi-worktree.json`. Configure it through **Configure worktree root** or edit it manually:

```json
{
  "worktreeRoot": "~/worktrees"
}
```

`worktreeRoot` accepts `~`, a home-prefixed path such as `~/worktrees`, or a native-platform absolute path. It does not expand `$VAR`, `%VAR%`, or other shell syntax. Empty, relative, NUL-containing, non-string, and invalid paths are rejected. There is no project override or extension-specific environment variable.

A missing `worktreeRoot` uses `~/.worktrees`; the settings file is created only by a successful interactive change. Submitting a blank value in the interactive action removes the override. Within one Pi process, queued saves run in invocation order, reread the latest valid document immediately before merging `worktreeRoot`, and preserve concurrent unknown-field edits. Settings reload on every `session_start`, including `/reload` and workspace replacement; a successful interactive save applies immediately to the next Add flow.

Malformed or invalid settings are warned about but never overwritten, including an invalid edit made while a settings action is open. An initial failure uses `~/.worktrees`; a later failure retains the last valid effective root. Interactive configuration remains blocked until the invalid file is fixed manually. Failed publication leaves the prior file and effective runtime root unchanged, and the save queue remains usable after rejection.

## 🔀 Pi workspace switching

Switching uses Pi's public `SessionManager` and `ctx.switchSession()` APIs:

1. The command waits for Pi to become fully idle so the current assistant/tool results are persisted.
2. A linear persisted session is forked into the target worktree. If `/tree` currently points at an older branch, the documented session entries for that active branch are written to the target instead, so switching cannot jump to a newer serialized leaf.
3. Pi tears down the old cwd-bound runtime and creates the target runtime.
4. The extension reports success only through the fresh replacement-session context.

If the current session is completely empty, the extension creates a valid empty Pi session for the target. If the current session is ephemeral (`--no-session`), the extension copies its active conversation branch into a persisted target session so the workspace switch does not lose context.

A successfully created Git worktree is never rolled back merely because Pi session switching fails. Re-run `/worktree` and choose **Switch worktree** after resolving the reported Pi/session issue.

## 🛡️ Safety boundaries

- The main worktree and current worktree cannot be removed.
- Locked or stale worktrees cannot be removed through this extension.
- Dirty, untracked, initialized-submodule, and intentional `assume-unchanged`/`skip-worktree` index state causes removal to fail closed. Sparse-checkout-managed `skip-worktree` entries outside the active sparsity rules are allowed when Git's rule checker can confirm them; clear other intentional index flags before removing the worktree.
- Ignored-only files and directories do not block removal. The confirmation lists them, and the extension rechecks the exact ignored inventory before Git deletes the worktree.
- A detached HEAD must be reachable from a local branch, tag, or remote ref before removal or prune.
- Removal and prune inspect reflogs, pseudorefs, per-worktree refs, and `FETCH_HEAD`. Historical commits reachable only through this administrative recovery state are listed by full OID in the destructive confirmation; approval removes those recovery pointers, so Git may later garbage-collect the commits. Create a branch or tag instead when any listed commit should survive.
- Staged-only administrative index state, a missing attached branch ref, or an unreachable current detached HEAD still blocks prune without an override.
- Removal never deletes a branch and never uses `--force`.
- Remove invokes only argv-based `git worktree remove <path>`; production runtime never invokes a shell, `rm`, `rm -rf`, or a Node filesystem directory-deletion API for worktrees.
- Prune always runs `git worktree prune --dry-run --verbose` before confirmation, inspects candidates omitted from porcelain, rechecks the exact preview and recovery-risk set after confirmation, and uses Git's default expiry. Remove likewise rechecks worktree identity, inventory, administrative path, and the approved recovery-risk set before mutation.
- The status browser uses only local Git state and never fetches a remote; its cards never authorize Remove or Prune.
- The extension does not commit, push, fetch, rebase, repair, move, lock, or unlock worktrees.

Use Git directly when you intentionally need force removal, branch deletion, custom prune expiry, detach/orphan creation, move, repair, lock, unlock, or remote refresh behavior.

## 🚧 Limitations

- Git must be installed and the current Pi cwd must be inside a non-bare Git worktree.
- The command requires a UI-capable Pi mode; print and JSON modes cannot drive its dialogs.
- Project trust and cwd-bound extension/resource loading during a switch remain owned by Pi.
- The extension registers no LLM tool, background watcher, project settings, or statusline item.

## 🗂️ Package layout

```text
packages/pi-worktree/
├── src/
│   ├── index.ts
│   ├── command.ts
│   ├── git.ts
│   ├── session.ts
│   ├── settings.ts
│   ├── status.ts
│   └── worktree.ts
├── test/
│   ├── add-command.test.ts
│   ├── command-test-support.ts
│   ├── command.test.ts
│   ├── git.integration.test.ts
│   ├── git.test.ts
│   ├── remove-ignored-command.test.ts
│   ├── session.test.ts
│   ├── settings-command.test.ts
│   ├── settings.test.ts
│   ├── status-command.test.ts
│   └── status.test.ts
├── package.json
├── README.md
├── LICENSE
└── tsconfig.json
```

## 🔎 Keywords

`pi-package`, `pi-extension`, `git`, `worktree`, `workspace`, `session`

## 📄 License

MIT
