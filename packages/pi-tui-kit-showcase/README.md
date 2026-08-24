# 🧭 Pi TUI Kit Showcase — Preview Standard Pi Interactions

[![private](https://img.shields.io/badge/npm-private-lightgrey)](./package.json) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> Pi TUI Kit Showcase is experimental and private.
> It is a local maintainer demo, not a published extension.

Preview the public `@narumitw/pi-tui-kit` screens and standalone interactions in one local interactive demo.

The showcase uses only in-memory state and stores no settings.

## ✨ Features

- Demonstrates action, detail, browse, choice, settings, input, review, and multi-select screens.
- Demonstrates standalone questionnaire, task, confirmation, and live-choice interactions from the same menu.
- Covers disabled rows, busy labels, search, exact documents, adaptive review, bulk actions, and row descriptions.
- Shows the shared top and bottom horizontal rules across every standard screen at normal terminal heights.
- Keeps all effects in memory inside the demo process.
- Loads the Kit runtime only after `/tui-kit-showcase` runs.

## 📦 Install

This package is private and is not meant for npm publication.

Load it from a local checkout:

```bash
pi --no-extensions --no-skills --no-session -e ./packages/pi-tui-kit-showcase
```

The repository shortcut builds Kit first and then loads only this showcase extension:

```bash
just showcase-tui-kit
```

## 🚀 Quick start

Run this command in Pi TUI mode:

```text
/tui-kit-showcase
```

Choose any row to inspect a presentation pattern.

The standalone questionnaire, task, confirmation, and live-choice rows close the menu, show the standalone interaction, then reopen the menu when the interaction finishes.

RPC mode reports that the showcase requires TUI mode.

Print and JSON modes reject the command without writing ad hoc output.

## ⚙️ Settings

The showcase has no extension-owned settings file.

The **Settings screen** row edits in-memory demo values only.

Those values reset when the command starts again or the session owner is replaced.

## 💬 Commands

### `/tui-kit-showcase`

Opens the showcase menu in TUI mode.

The command accepts no arguments.

Unknown arguments are rejected with usage text.

## 🗂️ Package layout

- `src/index.ts` — thin Pi extension entrypoint forwarder.
- `src/showcase.ts` — command registration, lazy runtime loading, mode handling, and session owner cancellation.
- `src/runtime.ts` — menu loop plus standalone Kit interactions.
- `src/menu.ts` — declarative showcase screens and in-memory demo state.
- `test/` — focused package behavior tests.

## 🔎 Keywords

pi, pi-extension, tui, showcase, demo

## 📄 License

MIT © narumiruna
