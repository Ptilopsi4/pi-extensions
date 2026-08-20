# 🚀 pi-starship — Native Starship-style Statusline for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-starship)](https://www.npmjs.com/package/@narumitw/pi-starship) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

A native Pi footer configured with Starship-style TOML. It parses and renders formats itself—no `starship` executable or shell prompt required.

> **Different package:** the unscoped npm package `pi-starship` delegates to the Starship binary. This package is `@narumitw/pi-starship` and renders Pi-specific modules natively.

## ✨ Features

- Loads a generated split TypeScript runtime through Pi's Jiti loader to reduce package startup work.
- Uses a readable, palette-free Starship-style built-in configuration until settings are saved.
- Starship-style root/module formats, conditional groups, `$all`, styles, and opt-in palettes.
- Pi modules for model, thinking, activity, context, tokens, prompt cache, cost, turn, and extension statuses.
- Cached Git branch, commit, operation state, line metrics, detailed status, and linked-worktree identity.
- Native current-branch GitHub pull request links, checks, review state, and terminal-state retention.
- Opt-in package, language, development-shell, deployment, cloud, and execution-context modules.
- Width-aware `$fill` alignment for native multiline left/right layouts.
- Footer rendering is pure: no subprocess, network, filesystem, timer, or environment work runs from `render()`.
- Multiline output wraps to the terminal width instead of truncating.
- Goal-oriented `/starship` menu with every Starship 1.26 preset style plus a Pi-native Minimal
  preset, footer explanation, searchable module inspection, configuration health, transactional
  preview, and recovery.

## 📦 Install

```bash
pi install npm:@narumitw/pi-starship
```

Try the published package without installing it permanently:

```bash
pi -e npm:@narumitw/pi-starship
```

Build the generated runtime and try the local package from this repository:

```bash
npm --workspace @narumitw/pi-starship run build
pi -e ./packages/pi-starship
```

The package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.

Do not enable this together with `@narumitw/pi-statusline`: both own Pi's footer, and Pi does not arbitrate that conflict.

## 🚀 Quick start

Start Pi with the extension to use the built-in footer without creating a settings file.
Run `/starship` to inspect the footer, choose a preset, or customize the configuration.

## ⚙️ Settings

The only configuration source is:

```text
<getAgentDir()>/pi-starship.toml
```

When this file is absent, the extension uses its readable palette-free default without creating the
file or parent directory. The built-in root is the explicit sequence `$brand$model$thinking$directory`
`$git_branch$git_status$activity$context$time`; it does not start the opt-in GitHub PR query. The first
successful settings save creates the file atomically. Existing malformed documents are never
overwritten.

The extension does **not** read project overrides, `pi-statusline.json`, `PI_STATUSLINE_PRESET`, or `~/.config/starship.toml`, and does not migrate statusline settings.

Open the interactive menu in TUI mode:

```text
/starship
```

Choose **Customize footer** to edit the TOML. Closing the editor validates the draft and opens an
adaptive, scrollable preview whose **Apply changes…**, **Continue editing**, and **Discard draft**
actions remain reachable in short or narrow terminals. Saving happens only after a separate
confirmation. Confirmed changes are atomically saved and applied immediately. Manual TOML edits load
on the next `session_start`, including `/reload` and session replacement. Editor cancellation, preview
cancellation, component disposal, invalid drafts, write failures, and runtime application failures
preserve the previous file and effective footer.

The shallow main menu also exposes **Presets**, **Explain footer**, **Modules**, **Configuration**,
**Help**, and **Restore built-in…**. Explain footer uses the current immutable runtime snapshot to list
each currently showing non-empty module once with its rendered value and description; it starts no new
collection work. Modules opens a bounded searchable inspector for every registered module. Its
textual states distinguish **Showing**, **Empty**, **Disabled**, **Not in format**, and
**Unavailable** only when the current footer cannot provide an inspection snapshot. Module detail
shows the current preview when available, description, root reference and reachability, format
variables, style fields, display rules, and the known reason for absent output. Both views are
read-only and never create or update the settings document.

Configuration combines state, source, path, health, and diagnostics. A healthy missing file is shown
as **Built-in defaults**, an exact bundled document is shown as its named preset, and **Built-in
fallback** is reserved for read or parse errors. Restore is disabled when no settings document exists
or the exact built-in document is already saved. For a custom or invalid document, Restore previews
the result and warns that the complete document,
including custom settings, unknown fields, and comments, will be replaced without a post-success
backup before asking for confirmation.

### 🎛️ Presets

Choose **Presets** from `/starship` to browse complete Pi-native starting points. The catalog adapts
all styles listed by `starship preset --list` in Starship 1.26.0, plus a Pi-specific Minimal option.
Colors, separators, typography, and layout follow the named Starship preset; modules are deliberately
selected for Pi's model, thinking, workspace, Git, activity, context, and time snapshots.

| Preset | Adapted visual treatment | Font requirement |
| --- | --- | --- |
| **Minimal** | Compact Pi essentials | Standard Unicode |
| **Bracketed Segments** | Balanced Pi and Git information in brackets | Standard Unicode |
| **Catppuccin Powerline** | Connected Catppuccin Mocha blocks; other Catppuccin palettes remain in the document for customization | Nerd Font |
| **Gruvbox Rainbow** | Warm Gruvbox connected segments | Nerd Font |
| **Jetpack** | Airy geometric activity/context and workspace columns joined by fill | Standard Unicode |
| **Nerd Font Symbols** | Balanced default layout with icon-rich symbols | Nerd Font |
| **No Empty Icons** | Conditional text labels that cannot appear without their values | Standard Unicode |
| **No Nerd Font** | Portable Unicode symbols without private-use glyphs | Standard Unicode |
| **No Runtime Versions** | Presence indicators without model or thinking details | Standard Unicode |
| **Pastel Powerline** | Connected magenta, coral, orange, blue, teal, and navy blocks | Nerd Font |
| **Plain Text Symbols** | Plain words replace pictograms | Standard Unicode |
| **Pure Preset** | Clean two-line workspace and session context | Standard Unicode |
| **Tokyo Night** | Connected cool blue Tokyo Night blocks | Nerd Font |

The preset cursor is a live footer preview. Opening the picker and moving with Up/Down, Page Up/Down,
Home, or End temporarily renders the selected preset in the actual footer without writing settings or
starting new collectors. Press Enter to start the named preset's replacement confirmation, or press
`e` to customize the selected complete TOML document before its normal editor preview and
confirmation. Escape returns to the main menu, while Ctrl+C closes the complete workflow; both restore
the previously effective footer.

Presets are complete documents, not overlays. Applying one replaces `pi-starship.toml`, including
custom settings, unknown fields, and comments, only after a separate confirmation; no post-success
backup is kept. Cursor movement, confirmation cancellation, disposal, validation failure, write
failure, and runtime-apply failure retain the previous valid document and effective footer. Exact
unedited matches are shown as **Currently applied** and cannot be redundantly selected; editing any
byte makes the document custom again. **Restore built-in…** remains the deterministic recovery path.

The bundled presets use only pi-starship's local Pi and Git snapshot modules. They do not enable the
GitHub PR query, cloud/deployment readers, or optional command-backed workspace collectors. They are
Pi-native adaptations of the color and format treatments emitted by Starship 1.26.0; they do not copy
Starship's module selections because Pi exposes different runtime information. There is no
`/starship preset` textual route and no remote preset download.

### 📝 Example

```toml
format = """
$brand\
$model\
$thinking\
$directory\
$git_branch\
$git_status\
$activity\
$context\
$time"""

[model]
format = "[ $symbol$model ]($style)"
symbol = "◆ "
style = "bold blue"
truncation_length = 36
truncation_symbol = "…"
truncation_direction = "middle"

[directory]
style = "cyan bold"

[git_branch]
style = "bold purple"

[context]
format = "[$symbol $percentage/$window ]($style)"

[[context.display]]
threshold = 0
style = "bold green"
hidden = true

[[context.display]]
threshold = 30
style = "bold green"
hidden = false

[[context.display]]
threshold = 60
style = "bold yellow"
hidden = false

[[context.display]]
threshold = 80
style = "bold red"
hidden = false

[git_metrics]
added_style = "bold green"
deleted_style = "bold red"
disabled = false

[username]
style_user = "yellow bold"
style_root = "red bold"

[extension_status]
format = "([$statuses ]($style))"
icons = { "foo:*" = "🧪", "third_party/key" = "◎", fallback = "•" }
```

Every module table supports `format`, `symbol`, and `disabled`. Most modules also support one `style`.
The exceptions are `git_metrics` (`added_style` and `deleted_style`), `username` (`style_user` and
`style_root`), and the threshold-selected `context` and `cost` `display` arrays described below.
Module-specific options are catalog-owned and type-checked; unknown options warn and stay inactive.
Version formats replace `$raw`. Detection arrays replace defaults when non-empty and inspect only one
listing of the current directory. A leading `!` is supported by language detection arrays and rejects
a matching project.
`[extension_status].icons` accepts arbitrary exact Pi status keys and explicit colon namespace
wildcards such as `foo:*`; `fallback` controls unmatched statuses. Icon matching uses the exact key,
the longest `:*` wildcard, a leading status emoji, then `fallback`/`🔌`. An empty configured icon
suppresses only the icon. `foo:*` matches `foo:server` but not `foo`, `foobar`, or `foo/server`.

Pi does not expose which package owns a status, so exact raw keys are the reliable third-party
contract. pi-starship does not inspect installed packages, infer package aliases, assign icons to
known extensions, or bridge compatibility keys. Extension authors may adopt `<extension-id>` or
`<extension-id>:<stable-slot>` for interoperability, but pi-starship does not require that convention.

**Icon migration:** configurations that relied on package-ID aliases, built-in known-extension icons,
or compatibility mappings must use an exact raw status key, an explicit namespace wildcard, a
leading emoji in the status value, or `fallback`.

## 🧩 Format grammar

- Variables: `$name` and `${name}`. Unknown variables render empty and produce a warning when loaded from TOML.
- Escapes: `\\$`, `\\[`, `\\]`, `\\(`, `\\)`, and `\\\\` render functional characters literally.
- Styled groups: `[format string](style string)`.
- Conditional groups: `(format string)` render only when a nested variable has a non-empty value.
- Nested groups are supported.
- `$all` expands enabled modules in the default order and omits modules already referenced explicitly.

Module formats can use `$style` in a style expression. Module output keeps its own style when embedded in an outer styled group.

## 🎨 Styles and palettes

Style expressions support:

- Named colors and ANSI numbers `0`–`255`.
- Hex RGB (`#7aa2f7`).
- `fg:<color>` and `bg:<color>`; an unprefixed color is foreground.
- `bold`, `dimmed`, `italic`, `underline`, `blink`, `inverted`, `hidden`, and `strikethrough`.
- `none` and `fg:none`, which make the complete expression unstyled regardless of position.
- `bg:none`, which clears only the absolute background; an unknown `bg:<value>` has the same
  Starship-compatible reset behavior.
- `prev_fg` and `prev_bg`, which use the previous rendered chunk's colors when present and retain any
  absolute foreground/background in the expression as the no-previous fallback.
- Direct color names from one explicitly selected `[palettes.<name>]` table.

There is no built-in or fallback palette. A custom palette is active only when its table is explicitly
selected, and its values must be direct named, ANSI, or RGB colors—palette entries cannot reference
other entries. Palette names override terminal color names such as `blue`:

```toml
palette = "company"

[palettes.company]
blue = "#86BBD8"
accent = "208"

[model]
style = "bold blue"
```

Style tokens are case-insensitive and ordinary foreground/background colors are last-wins.
`prev_fg`/`prev_bg` override their absolute fallback only when a previous chunk exists. Empty styled
groups still advance previous-color state. Invalid literal style expressions warn and render
unstyled. An invalid root format falls back to the built-in root format; an invalid module format or
catalog-owned style field falls back only at that field's module scope. `/starship status` reports
warnings.

The background-free direct defaults are: `brand = "bold white"`, `provider`/`model` = `"bold blue"`,
`thinking`/`git_branch`/`turn` = `"bold purple"`, `directory`/`git_worktree` = `"cyan bold"`,
`github_pr = "bold blue"`, `git_commit = "green bold"`, `git_state`/`activity`/`time` =
`"bold yellow"`, `git_status = "red bold"`, `tokens = "bold cyan"`, `cache = "bold green"`,
`extension_status = "dimmed white"`, `direnv = "bold bright-yellow"`, and `fill = "bold black"`.
Context, cost, Git metrics, and username use the state/multi-style defaults below.

### State-selected styles

`context` and `cost` select the last entry at the highest threshold less than or equal to the current
value. A later entry wins when thresholds are equal. Each display entry requires a finite `threshold`,
a valid `style`, and boolean `hidden`. Invalid entries warn and are ignored; module defaults are used
if none remain.

The default context thresholds are hidden at `0`, `bold green` at `30`, `bold yellow` at `60`, and
`bold red` at `80`. The default cost thresholds are hidden at `0`, `bold yellow` at `1`, and `bold red`
at `5`:

```toml
[[cost.display]]
threshold = 0
style = "bold green"
hidden = true

[[cost.display]]
threshold = 1
style = "bold yellow"
hidden = false

[[cost.display]]
threshold = 5
style = "bold red"
hidden = false
```

`git_metrics` exposes `$added_style` and `$deleted_style` in its module format. `username` still uses
`$style` in its format, but selects `style_user` or `style_root` from private execution metadata; the
selector is not a format variable.

### Breaking palette migration

The previous implicit `tokyo-night` palette and its `lead`, `header`, `header_fg`, `directory`,
`directory_fg`, `git`, `git_fg`, `runtime`, `runtime_fg`, `meter`, `meter_fg`, and `extension` aliases
were removed. Existing files are not rewritten. Old alias-based module styles warn and fall back to
the module's new direct-color default; alias-based literal Powerline groups warn and render unstyled.

Choose one migration:

1. Replace old aliases with direct styles such as `cyan bold`, `bold bright-yellow`, or
   `fg:#e3e5e5 bg:#769ff0`.
2. Define every needed alias under your own `[palettes.<name>]` table and explicitly select it with
   `palette = "<name>"`.
3. Use **Restore built-in…** from `/starship` to review and replace the complete document with the new
   plain nine-module configuration.

There is no hidden compatibility overlay or automatic migration.

## 🧱 Modules

| Module | Format variables | Meaning |
| --- | --- | --- |
| `brand` | `$symbol` | Pi brand marker |
| `provider` | `$symbol`, `$provider` | Current model provider |
| `model` | `$symbol`, `$model` | Current model name |
| `thinking` | `$symbol`, `$level` | Thinking level |
| `directory` | `$symbol`, `$path`, `$full_path` | Current working directory |
| `git_worktree` | `$symbol`, `$name`, `$path` | Linked worktree name and top-level path |
| `git_branch` | `$symbol`, `$branch`, `$remote_name`, `$remote_branch` | Local branch and upstream |
| `github_pr` | `$symbol`, `$number`, `$link`, `$state`, `$checks`, `$review`, `$status` | Current-branch GitHub pull request |
| `git_commit` | `$symbol`, `$hash`, `$tag` | Seven-character HEAD hash and optional exact tag |
| `git_state` | `$symbol`, `$state`, `$progress_current`, `$progress_total` | Rebase, merge, revert, cherry-pick, bisect, or mail-apply state |
| `git_metrics` | `$symbol`, `$added`, `$deleted` | Added/deleted line totals from the working tree diff |
| `git_status` | `$symbol`, `$all_status`, `$ahead_behind`, `$ahead`, `$behind`, `$diverged`, `$up_to_date`, `$conflicted`, `$stashed`, `$deleted`, `$renamed`, `$modified`, `$typechanged`, `$staged`, `$untracked`, and detailed index/worktree counters | Cached porcelain-v2 counters |
| `activity` | `$symbol`, `$state`, `$tool`, `$count`, `$text` | Active tools, streaming, completion, or idle |
| `context` | `$symbol`, `$percentage`, `$tokens`, `$window` | Context-window use |
| `tokens` | `$symbol`, `$input`, `$output`, `$total` | Token totals |
| `cache` | `$symbol`, `$rate`, `$read`, `$write` | Prompt-cache reads, writes, and latest hit rate; disabled by default |
| `cost` | `$symbol`, `$cost`, `$subscription` | Session cost and optional `(sub)` marker |
| `time` | `$symbol`, `$time` | Current local time |
| `turn` | `$symbol`, `$count` | User turn count |
| `package` | `$symbol`, `$version`, `$source` | Direct project manifest version |
| `nodejs` | `$symbol`, `$version`, `$engines_version` | Detected Node.js project/runtime |
| `python` | `$symbol`, `$version`, `$virtualenv`, `$pyenv_prefix` | Python runtime and allowlisted environment name |
| `rust` | `$symbol`, `$version`, `$numver`, `$toolchain` | Safe native `rustc` runtime and allowlisted toolchain name |
| `golang` | `$symbol`, `$version`, `$mod_version` | Go runtime (`$mod_version` is reserved and currently empty) |
| `bun` / `deno` | `$symbol`, `$version` | Bun or Deno runtime |
| `mise` | `$symbol`, `$health` | Bounded mise health result |
| `direnv` | `$symbol`, `$rc_path`, `$allowed`, `$loaded` | Inert direnv status; `.envrc` is never sourced |
| `conda` | `$symbol`, `$environment` | Active Conda environment name |
| `pixi` | `$symbol`, `$version`, `$environment`, `$project_name` | Pixi project and environment |
| `nix_shell` | `$symbol`, `$state`, `$name`, `$level` | Allowlisted Nix shell activation metadata |
| `guix_shell` | `$symbol`, `$state` | Guix shell activation marker |
| `docker_context` | `$symbol`, `$context` | Non-default local Docker context |
| `kubernetes` | `$symbol`, `$context`, `$namespace`, `$cluster`, `$user` | Current inert kubeconfig metadata |
| `terraform` | `$symbol`, `$workspace`, `$version` | Local Terraform/OpenTofu workspace and optional version |
| `aws` | `$symbol`, `$profile`, `$region` | AWS profile/region metadata, never credentials |
| `gcloud` | `$symbol`, `$active`, `$account`, `$domain`, `$project`, `$region` | Active gcloud configuration metadata |
| `azure` | `$symbol`, `$subscription`, `$username` | Default Azure subscription; username is separately enabled |
| `openstack` | `$symbol`, `$cloud`, `$project` | Selected OpenStack cloud/project metadata |
| `os` | `$symbol`, `$type`, `$name`, `$version`, `$edition`, `$codename` | Platform/OS metadata; disabled by default |
| `container` | `$symbol`, `$name`, `$type` | Known container, WSL, or Dev Container context |
| `hostname` | `$symbol`, `$hostname`, `$ssh_symbol` | Hostname, SSH-only by default |
| `username` | `$symbol`, `$user` | Contextual login identity |
| `fill` | `$symbol` | Flexible width-aware root-layout marker |
| `extension_status` | `$symbol`, `$statuses`, `$count` | Pi extension statuses |

### Usage semantics

- `tokens`, `cache`, and `cost` total every usage-bearing session entry, matching Pi's native footer:
  assistant messages, nested-LLM tool results, compactions, and branch summaries, including abandoned
  branches retained in the session.
- Cache `$read` and `$write` are cumulative. `$rate` uses only the latest assistant prompt:
  `cacheRead / (input + cacheRead + cacheWrite) * 100`. The module is empty when Pi has reported no
  cache reads or writes.
- `cache` is disabled and absent from the built-in root. Enable it and add `$cache` to a custom root
  format (or use `$all`) to display it.
- Context `$percentage` uses native one-decimal precision. Its default display hides values below 30%;
  customize `[[context.display]]` when lower values should remain visible. The module name remains
  `context`, not `context_usage`.
- Subscription-backed OAuth models and `kimi-coding` set cost `$subscription` to `(sub)`. The dollar
  value is usage cost, not proof of an amount billed under a subscription.
- Pi's public extension API does not expose the current auto-compaction toggle, so pi-starship cannot
  reliably provide the native `(auto)` marker.

### Directory, Git, and environment contraction

The analogous modules keep their display policy local and use Starship defaults:

```toml
[directory]
truncation_length = 3
truncate_to_repo = true
fish_style_pwd_dir_length = 0
truncation_symbol = ""
home_symbol = "~"
use_os_path_sep = true
substitutions = { "/Volumes/network/path" = "/net" }

[git_branch]
truncation_length = 0 # pi-starship's bounded no-truncation sentinel
truncation_symbol = "…"

[git_commit]
commit_hash_length = 7

[conda]
ignore_base = true
truncation_length = 1

[hostname]
trim_at = "." # set to "" to keep the complete hostname
```

Directory `$path` contracts the home directory and, by default, the current Git repository root
before retaining the last three path components. `$full_path` remains the unmodified absolute cwd.
A positive `fish_style_pwd_dir_length` abbreviates otherwise omitted parent components when no
substitution is configured. `substitutions` is an ordered TOML string table of literal replacements.
Pi exposes one cwd rather than separate logical and physical paths, and pi-starship does not implement
Starship's regex substitution array or repo-root-specific split style/format fields. Directory
rendering reads only immutable home and repository-root snapshot data and performs no filesystem or
Git work.

Git branch truncation retains the first `N` grapheme clusters and appends the first grapheme of
`truncation_symbol` only when truncation occurs. The same rule applies independently to `$branch`,
`$remote_name`, and `$remote_branch`. Upstream Starship represents its unlimited default as
`2^63 - 1`; pi-starship uses `0` for the same behavior because its settings integers are deliberately
bounded. `commit_hash_length` accepts 0 through 64.

Conda retains the last path component by default; `0` keeps the complete environment path. Hostname
trimming runs before exact alias lookup, matching Starship. These are display transformations only:
collectors retain bounded, control-sanitized source metadata.

### Model aliases and truncation

The model module accepts exact `model_aliases`, Starship-style `truncation_length` and
`truncation_symbol` options, plus the Pi-specific `truncation_direction` option:

```toml
[model]
model_aliases = { "/models/Qwen3.6-35B-Q4.gguf" = "Qwen 35B Q4" }
truncation_length = 36
truncation_symbol = "…"
truncation_direction = "middle"
```

An exact alias is selected before the built-in Claude/GPT shortening rules, then the resulting label
is subject to the configured truncation. `truncation_length` counts model grapheme clusters retained
before the symbol; `0` disables
truncation and is the default. The direction names the removed portion: `start` retains the suffix,
`end` retains the prefix and is the default, and `middle` retains both ends. When no alias matches,
truncation runs after the built-in Claude/GPT shortening rules. It always changes display only—the
provider model ID is untouched.
Terminal control sequences in model IDs and truncation symbols are removed at render time. An empty
symbol truncates without a marker. For example, `middle` can retain both a Hugging Face model
family and its variant, while `start` is useful when a llama.cpp server reports an absolute model path.
pi-starship treats model IDs as opaque strings and does not parse paths, repositories, GGUF suffixes,
or quantization names.

`truncation_direction` is a pi-starship adaptation; upstream Starship has no model module or generic
truncation-direction setting.

`git_worktree` is empty in the primary worktree. In a linked worktree it defaults to the top-level directory name; use `$path` when the full absolute path is needed.

`git_commit`, `git_state`, and `git_metrics` are intentionally not present in the built-in root format. Add their variables to `format` to opt in; also set `[git_metrics].disabled = false`, matching Starship's opt-in metrics default. `$tag` resolves only an exact tag on HEAD and is queried only when the configured `git_commit` format references it.

### 🔎 Native GitHub pull requests

`$github_pr` is independent of `pi-github-pr`; installing that extension is not required. It runs one
bounded GitHub CLI query for the current branch:

```text
gh pr view --json number,isDraft,url,state,closedAt,mergedAt,reviewDecision,statusCheckRollup
```

Install and authenticate `gh` first:

```bash
gh auth login
```

For GitHub Enterprise Server, authenticate the repository host and keep that host in the repository
remote, for example `gh auth login --hostname github.example.com`. pi-starship starts `gh` directly
with child-only environment data that omits ambient `GH_HOST` and `GH_REPO` overrides, so `gh` resolves
the correct repository and host from the current checkout. It never mutates Pi's environment, calls
the GitHub API directly, or manages tokens.

Variables have these values:

- `$number`: digits such as `123`.
- `$link`: an OSC 8 `#123` link for a safe HTTP(S) URL, otherwise plain `#123`.
- `$state`: `open`, `draft`, `merged`, or `closed`.
- `$checks`: all non-zero check counts in passed, failed, pending order, or `-` when no checks exist.
- `$review`: `R✓` for approved, `R×` for changes requested, `R?` for review required, or empty
  when unknown.
- `$status`: one result selected in this order: merged, closed, draft, failing checks, changes
  requested, pending checks, approved, review required, passing checks, then no checks.

The compact symbols are font-safe and distinct from Git's default `$`, `!`, and `?` worktree markers:

| Compact value | Meaning |
| --- | --- |
| `✓<n>` | Checks that passed, including successful, skipped, and neutral conclusions |
| `×<n>` | Checks that failed |
| `…<n>` | Checks that are pending |
| `R✓` | Review approved |
| `R×` | Changes requested |
| `R?` | Review required |
| `M` / `C` / `D` | Merged, closed, or draft PR |
| `-` | No checks |

The unchanged default module format uses `$status` and now renders compact output:

```text
PR #123 · ×2
PR #123 · R✓
PR #123 · M
```

Use the existing `$checks` and `$review` variables together when every check category and the review
result should remain visible:

```toml
[github_pr]
format = "[$symbol$link( $checks)( $review) ]($style)"
```

```text
PR #123 ✓12 ×2 …7 R×
```

This is a breaking display migration for custom formats that use these variables:

| Previous value | Compact value |
| --- | --- |
| `checks passing` | `✓<n>` |
| `<n> failing` | `×<n>` |
| `<n> pending` | `…<n>` |
| `no checks` | `-` |
| `approved` / `changes requested` / `review required` | `R✓` / `R×` / `R?` |
| `merged` / `closed` / `draft` | `M` / `C` / `D` |

The old English values have no verbose aliases.
The variable names and default module format remain unchanged, so no TOML field migration is needed.

The query runs only in TUI sessions when the enabled module is reachable from the root format. It
refreshes at session start, immediately after a branch change, after each agent run, after accepted
settings changes, and every 60 seconds. Each query has a 10-second timeout. Branch changes clear the
old PR before querying the new branch. Closed and merged PRs remain visible for 24 hours, then expire
without waiting for the next refresh. Missing `gh`, missing authentication, no current PR, timeout,
malformed or oversized output, and network failures all render an empty module without exposing raw
errors or credentials.

The query sends the repository/current-branch context through authenticated `gh` to the GitHub host
configured by the repository. It requests only the fields above—never comments, review bodies,
inline comments, or review threads. Footer rendering and previews read only the immutable cached
snapshot and perform no network or subprocess work.

**Breaking migration:** `$git_branch.$pr` has been removed without a compatibility alias or automatic
migration. Replace it with root `$github_pr` and an optional `[github_pr]` table. If `pi-github-pr`
remains installed, its independent `github-pr` status can also appear under `$extension_status`;
disable or remove that extension when adopting the native module to avoid duplicate information.

### 📦 Package and language modules

Module behavior is inspired by Starship pinned at
`9f4d07ed45804e280d6884bb8ced7ea3d3033093`; formatter style semantics and the approved
multi/state-style surfaces are aligned with the checked-in Starship source at `cad50cd8`. This is not
complete Starship module or configuration compatibility.

| Area | Adopted | Adapted | Intentionally omitted |
| --- | --- | --- | --- |
| `package` | `package.json` → Cargo → PEP 621/Poetry precedence, `$version` | Direct manifests only; Cargo workspace version lookup is capped at eight ancestors | Other package ecosystems, dynamic Python versions, package-manager execution |
| Node.js | Direct markers/extensions, `node --version`, package engine text | Bun/Deno markers suppress Node's default detection | Constraint checks and manager/shim evaluation |
| Python | Direct markers, selected interpreter `--version`, virtualenv name | Interpreter selection uses only an existing active virtualenv path or `python` | Python code execution and broad environment discovery |
| Rust | Direct markers and native `rustc --version` | `.cargo`/`.rustup` shim paths are rejected to avoid toolchain installation | Falling back to rustup or any installing probe |
| Go | Direct markers and `go version` | `$mod_version` stays empty | `go list`, module downloads, and constraint enforcement |
| Bun / Deno | Direct markers and `bun --version` / `deno -V` | Negative detection avoids overlapping Node defaults | Runtime installation and recursive source detection |

All runtime commands use argv execution in `ctx.cwd`, a 2-second timeout, and 64 KiB accepted output.
Commands run only when the reachable module format references the command-backed variable. Missing,
killed, oversized, or malformed commands clear that value independently. `version_format`,
`detect_files`, `detect_extensions`, and `detect_folders` are available on language modules; package
supports `version_format`.

### 🧰 Development environments

| Module | Detection / allowed inputs | Optional command | Options |
| --- | --- | --- | --- |
| `mise` | Direct `mise.toml`, `.mise.toml`, or `.tool-versions` | `mise doctor` only for `$health` | Detection arrays |
| `direnv` | Direct `.envrc`; the file is never read or sourced | `direnv status --json` only for status variables | Detection arrays |
| `conda` | `CONDA_DEFAULT_ENV` only | None | `ignore_base` (default `true`) |
| `pixi` | Direct `pixi.toml`/`pixi.lock`, `PIXI_ENVIRONMENT_NAME`, `PIXI_PROJECT_NAME` | `pixi --version` only for `$version` | Detection arrays, `version_format`, `show_default_environment` |
| `nix_shell` | `IN_NIX_SHELL`, `NIX_SHELL_NAME`, `NIX_SHELL_LEVEL` | None | None |
| `guix_shell` | Presence of `GUIX_ENVIRONMENT` | None | None |

The extension never enumerates the process environment, activates a shell, evaluates Nix, lists
installed tools, or publishes arbitrary environment values. Names and paths are control-sanitized and
bounded before publication.

### 🚢 Deployment and cloud context

These modules read inert local metadata only. They do **not** contact Docker, a Kubernetes cluster,
a Terraform/OpenTofu backend, a cloud API, an OAuth flow, a credential helper, or a metadata service.
The deployment/cloud safety review retained opt-in root behavior: context labels may be sensitive and
there is no usage evidence justifying more default footer density.

- `docker_context`: `DOCKER_CONTEXT`, then `DOCKER_CONFIG/config.json` or `~/.docker/config.json`;
  `default` is suppressed. `only_with_files` and detection arrays are supported.
- `kubernetes`: at most `max_config_files` (default 8) from `KUBECONFIG` or `~/.kube/config`, with
  first-wins merge semantics. Only context, namespace, cluster name, and user name are selected.
  Exact `context_aliases`, `namespace_aliases`, `cluster_aliases`, and `user_aliases` apply.
- `terraform`: direct `.tf`, `.tfplan`, `.tfstate`, or `.terraform`; workspace precedence is
  `TF_WORKSPACE` → `TF_DATA_DIR/environment` → `.terraform/environment`. `terraform version`, then
  `tofu version`, runs only for `$version`. Workspace, init, provider, and state commands never run.
- `aws`: `AWS_PROFILE`/`AWS_DEFAULT_PROFILE`, `AWS_REGION`/`AWS_DEFAULT_REGION`, then the selected AWS
  config section. The credentials file is never read. Exact profile/region aliases are supported.
- `gcloud`: active selector plus allowlisted `core.account`, `core.project`, and `compute.region` INI
  keys. Exact project/region aliases are supported.
- `azure`: the default local `azureProfile.json` subscription name. `show_username` defaults to
  `false`; exact subscription aliases are supported.
- `openstack`: `OS_CLOUD`, `OS_PROJECT_NAME`, or the selected `clouds.yaml` `auth.project_name` only;
  exact cloud/project aliases are supported.

Cloud files often colocate credentials with labels. Parsers allowlist fields while reading and
discard source documents; token, key, password, auth URL, tenant, and credential-derived duration
fields never enter snapshots, diagnostics, notifications, or rendered output. Presence indicates only
selected local metadata—not valid credentials or connectivity.

### 🖥️ Execution context

`hostname` is SSH-only by default and supports `ssh_only`, `trim_at`, and exact `aliases`. `username`
appears only for `show_always`, SSH, root/Administrator, a login-user mismatch, or configured
`detect_env_vars`; it supports exact aliases. Negated username detection names are rejected. `os` is
disabled by default and supports an exact `symbols` map. `container` uses only Dev Container/Codespaces
markers, WSL metadata, `/.dockerenv`, `/run/.containerenv`, and `/run/systemd/container`; it does not
scan process tables or cgroups. Ordinary local hostname/username sessions stay empty. All identity
labels are bounded and stripped of C0/C1 controls, ANSI, newlines, and OSC control bytes.

### ↔️ Fill layout

Add `${fill}` between left and right root content (braces disambiguate adjacent text):

```toml
format = "$directory$git_branch${fill}$model$context"

[fill]
symbol = " " # native invisible default; use "·" for a visible pattern
style = "dimmed"
```

Fill resolves independently on each logical line before ANSI serialization and wrapping. Multiple
fills divide remaining cells left-to-right; complete positive-width patterns repeat and any remainder
uses styled spaces. Empty/zero-width patterns become spaces. Fixed content is never truncated: when it
already meets or exceeds the width, fill contributes zero and normal ANSI-aware wrapping applies.
Unicode wide/combining symbols, palettes, `prev_fg`/`prev_bg`, ANSI, and OSC hyperlinks use Pi TUI
visible-width semantics. `$all` deliberately includes enabled fill, so use `$all` only when that
whole-catalog layout is intended. There is no `line_break` module; use literal newlines in `format`.

### 🔄 Cached refresh lifecycle

Workspace, Git, and GitHub PR readers start only in TUI sessions and only for reachable enabled
modules. Root format reachability, `$all`, module `disabled`, and module-format variables determine
file and command requirements. Workspace/Git refreshes run at session start, after accepted settings,
branch changes, tool/turn completion, and a 30-second fallback. GitHub PR uses the narrower lifecycle
and 60-second network refresh described above. One read runs with at most one latest pending refresh;
immutable snapshot equality suppresses redraws, and session/request generations reject stale results.
Shutdown, replacement, footer disposal, branch changes, and accepted settings abort active command
work before starting replacements; disabling `github_pr` also stops its query and timers. Bounded local
filesystem operations may finish, but stale generations cannot publish them. Execution identity is
retained rather than re-read by the periodic fallback. Render and live preview consume snapshots
synchronously and perform zero reads or commands.

Missing, unreadable, malformed, oversized, timed-out, or unavailable sources fail to empty values.
Workspace/Git readers cap direct files at 64 KiB, use one bounded current-directory listing, never
recurse, and make no network calls. The native GitHub PR query is the documented network exception.
Package's explicitly documented Cargo lookup is the only ancestor walk and is capped at eight parents.

## 💬 Commands

| Command | Purpose |
| --- | --- |
| `/starship` | Open the current-state menu in TUI mode; retain help behavior outside TUI |
| `/starship settings` | Open the compatible direct edit → preview → confirm flow (TUI only) |
| `/starship status` | Show config source/path and diagnostics |
| `/starship help` | Show command and configuration help |

The standard main menu keeps seven goals on one level: **Customize footer**, **Presets**,
**Explain footer**, **Modules**, **Configuration**, **Help**, and **Restore built-in…**. It shows whether
the footer uses built-in defaults, a saved built-in document, a named preset, a custom document, or an
error-driven fallback,
together with the current health. Presets, Explain, and Modules are menu-only paths; they do not add
textual subcommands or change RPC, print, or JSON protocols. Restore remains last and unavailable
when there is no document to replace.

The TOML editor, adaptive live footer previews, Explain view, and searchable module inspector remain
specialized extension UI. Their hints follow Pi's injected keybindings; list and detail content stay
bounded across terminal resize. Escape returns from detail or to the main menu, while Ctrl+C closes
the whole workflow.

The direct routes accept no trailing arguments. Status and help remain safe in TUI, RPC, JSON, and
print modes. RPC receives notifications but never opens custom terminal UI; print and JSON modes
produce no ad hoc output. Footer/timer/Git lifecycle work starts only in TUI mode.

## 📐 Scope

The formatter, style concepts, and selected contextual modules are Starship-inspired, while Pi owns
the lifecycle, snapshots, privacy boundary, and footer layout. This extension does not load
`starship.toml`, claim complete module/config compatibility, invoke the Starship binary, run custom
shell modules, or expose unrestricted `env_var` behavior. JVM/.NET, other long-tail languages,
alternative VCS, system-monitor, and additional DevOps modules remain demand-gated; the first-wave
review found no issue/discussion evidence for a coherent follow-up batch, so no second wave is added.

Pi-native model, context, cache, cost, Git metrics, and activity remain owned by the existing modules. The
lifecycle design rejects provider-specific duplicates and ambiguous `turn_duration`/`last_result`
modules until separately approved semantics exist.

## ➕ Adding a module

Create `src/modules/<name>.ts` with its format variables, defaults, and runtime value resolver, then register it in display order in `src/modules/catalog.ts`. Configuration names, validation variables, defaults, and `$all` ordering are derived from that catalog. Add the module to the built-in root format when it should be visible by default, then document and test its user-facing values.

Keep `extension_status` last in the catalog so arbitrary third-party statuses follow native module output.

## 🗂️ Package layout

- `dist/` — generated split TypeScript runtime loaded through Pi's Jiti loader.
- `scripts/build-runtime.mjs` — deterministic runtime bundler and eager-boundary validator.
- `src/index.ts` — thin authoritative source entrypoint.
- `src/pi-starship.ts` — authoritative extension lifecycle, cached refresh binding, live preview, and footer.
- `src/usage.ts` — native-aligned session usage and cache aggregation.
- `src/command-contract.ts` — lightweight command routes and completions loaded at startup.
- `src/commands.ts` — lazily loaded menu, preview/confirmation flow, diagnostics, and compatibility routes.
- `src/command-preset-picker.ts` — lifecycle-owned preset cursor and temporary footer-preview UI.
- `src/presets/` — bundled complete TOML documents and stable preset metadata.
- `src/command-inspector.ts` — adaptive Explain and searchable read-only module inspection surfaces.
- `src/command-preview.ts` — adaptive, scrollable, keybinding-aware preview action surface.
- `src/config.ts` — TOML loading, draft validation, defaults, atomic persistence, and rollback.
- `src/format/` — native format/style parser and renderer.
- `src/modules/` — domain module definitions, ordered registry, reachability, and width-aware renderer.
- `src/modules/git/` — bounded local Git reader plus branch, status, and worktree modules.
- `src/modules/github-pr.ts` — pure native GitHub PR snapshot presentation.
- `src/runtime/github-pr.ts` — bounded `gh` query, validation, terminal-safe links, and expiry data.
- `src/runtime/` — shared refresh controller and requirement-gated, lazily loaded package/language/context collectors.

## 🔎 Keywords

Pi Coding Agent, Starship statusline, Starship TOML, terminal footer, native statusline, GitHub pull
request, prompt cache, cache hit rate, Pi extension

## 📄 License

MIT. See [`LICENSE`](./LICENSE). Starship attribution and its ISC license are included in [`NOTICES.md`](./NOTICES.md).
