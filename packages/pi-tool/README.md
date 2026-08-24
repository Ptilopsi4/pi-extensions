# 🧰 pi-tool — Browse Pi Tools and Track Active Tools

[![npm](https://img.shields.io/npm/v/@narumitw/pi-tool)](https://www.npmjs.com/package/@narumitw/pi-tool) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Browse every tool configured in the current Pi session and optionally show the active tool set above the editor.

## ✨ Features

- Lists built-in, SDK-provided, and extension-provided tools in one searchable catalog.
- Shows active state, description, source, scope, origin, path, and optional base directory.
- Displays the complete JSON parameter schema and prompt guidelines exposed by Pi.
- Shows the effective system-prompt snippet for each active tool.
- Refreshes metadata every time the catalog opens.
- Optionally shows the current active tools above the editor.
- Keeps the active-tool widget off by default.
- Persists widget changes in the extension-owned `pi-tool.json` settings file.
- Never enables, disables, or executes Pi tools.

## 📦 Install

Install persistently from npm:

```bash
pi install npm:@narumitw/pi-tool
```

Try without installing permanently:

```bash
pi -e npm:@narumitw/pi-tool
```

Try this package from a local checkout:

```bash
npm --workspace @narumitw/pi-tool run build
pi -e ./packages/pi-tool
```

An unbuilt local checkout must be built before loading the package directory.
Extensions run with the same permissions as Pi.
Only install packages from sources you trust.

## 🚀 Quick start

Run:

```text
/tool
```

Choose **Browse tools** to search the catalog and inspect a tool.
Choose **Settings** to turn the active-tool widget on or off.
The widget is off until you enable it.

The command works in TUI and RPC modes.
It rejects arguments and rejects print or JSON modes because Pi does not provide an observable interactive command surface there.

## 💬 Commands

| Command | Description |
| --- | --- |
| `/tool` | Browse configured tools and configure the active-tool widget. |

`/tool` intentionally accepts no arguments and does not enable, disable, or execute tools.
Its menu provides Browse tools, Settings, Status, and Help screens.

## ⚙️ Settings

The active user settings file is `<getAgentDir()>/pi-tool.json`, normally `~/.pi/agent/pi-tool.json`.
The file is not created when the widget remains at its default.
Use this document to enable the widget manually:

```json
{
  "activeToolStatus": true
}
```

`activeToolStatus` accepts `true` or `false` and defaults to `false` when absent.
Manual edits apply after `/reload` or the next session start.
The `/tool` Settings screen applies changes immediately and persists them with an atomic file replacement.
Settings writes preserve unknown fields so newer configuration is not erased.
Malformed JSON or an invalid value is ignored with a warning and is never overwritten by the menu.
Writes are ordered within one Pi process, but separate Pi processes do not share a settings lock.

## ℹ️ Active-tool widget

When enabled, the widget shows every name returned by Pi's public `pi.getActiveTools()` API above the editor.
It refreshes when relevant lifecycle events fire and polls for changes made by other extensions.
It clears immediately when disabled and during session replacement, reload, or shutdown.
Tool names are sanitized and bounded before terminal rendering.

## ℹ️ Metadata limits

The catalog displays the fields returned by Pi's public `pi.getAllTools()` API: name, description, parameter schema, prompt guidelines, and source metadata.
It combines those fields with the effective snippets returned by `ctx.getSystemPromptOptions()` for the current active tool set.
An inactive tool's configured snippet is not exposed through the Extension API, so “None in the current system prompt” does not mean its full definition has no snippet.
Pi does not expose a tool's implementation, runtime secrets, or label through these Extension APIs.

## 🗂️ Package layout

```text
packages/pi-tool/
├── src/
│   ├── index.ts               # Thin repository entrypoint
│   ├── tool.ts                # Command, settings, and session lifecycle ownership
│   ├── tool-catalog.ts        # Lazy menu and exact catalog detail projection
│   ├── active-tool-status.ts  # Widget formatting, refresh, and cleanup
│   └── settings.ts            # pi-tool.json validation and atomic persistence
├── dist/                # Generated Jiti runtime and lazy catalog chunk
├── scripts/build-runtime.mjs
├── test/
├── README.md
├── LICENSE
├── package.json
└── tsconfig.json
```

## 🔎 Keywords

Pi extension, Pi coding agent, tool browser, active tools, tool status, tool catalog, tool schema, TypeScript Pi package.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
