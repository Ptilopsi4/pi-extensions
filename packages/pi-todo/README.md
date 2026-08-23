# ✅ pi-todo — Keep Coding Tasks Visible

[![npm](https://img.shields.io/npm/v/@narumitw/pi-todo)](https://www.npmjs.com/package/@narumitw/pi-todo)
[![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Give coding agents a structured todo tool and show the current task list above Pi's editor.

The list follows the active session branch and disappears cleanly when it is empty or the session ends.

## ✨ Features

- Registers one `todo_widget` tool with pending, in-progress, and completed task states.
- Shows a compact themed task list above the editor in TUI mode.
- Restores the latest valid list when Pi starts a session or navigates between branches.
- Keeps at most one task in progress and validates non-empty task text.
- Sanitizes terminal and bidirectional controls before rendering model-provided text.
- Works without settings, files, network access, or external services.

## 📦 Install

Install persistently from npm:

```bash
pi install npm:@narumitw/pi-todo
```

Try from npm without installing permanently:

```bash
pi -e npm:@narumitw/pi-todo
```

Load this package directly from a repository checkout:

```bash
pi --no-extensions -e ./packages/pi-todo
```

Pi extensions run with the user's permissions, so install only trusted code.

## 🚀 Quick start

Ask Pi to perform a multi-step coding task.

The agent can create a list through `todo_widget`, keep the current step marked `in_progress`, and update the complete list as work advances.

Send an empty list through the tool to clear the widget.

## 🛠️ Tools

### `todo_widget`

Replace the complete authoritative todo list for the active session.

Each item has this shape:

```json
{
  "text": "Run the focused tests",
  "status": "in_progress"
}
```

Accepted statuses are `pending`, `in_progress`, and `completed`.

A list may contain up to 50 items, each item may contain up to 300 characters, and at most one item may be `in_progress`.

The tool result stores a versioned snapshot in the session branch so branch navigation can reconstruct the latest valid list.

In TUI mode, updates appear above the editor immediately.

In RPC, print, and JSON modes, the tool still returns structured details but does not create a visual widget.

## 🔒 Security and privacy

The extension does not read or write files, start processes, access credentials, or make network requests.

Task text is stored in Pi's normal session tool results and therefore follows the user's existing session persistence choices.

Terminal escape sequences, control characters, and bidirectional display controls are removed at the rendering boundary without changing the stored tool payload.

## 🚧 Limitations

- The visual widget is available only in TUI mode.
- The extension provides a model tool rather than a slash command or manual task editor.
- Branch reconstruction uses only valid versioned `todo_widget` tool results on the active branch.
- Long task text is shown on one bounded terminal line and may be truncated to the available width.

## 🗂️ Package layout

```text
packages/pi-todo/
├── src/
│   ├── index.ts          # Thin Pi extension entrypoint
│   └── todo-widget.ts    # Tool, lifecycle, state reconstruction, and rendering
├── test/
│   └── todo-widget.test.ts
├── LICENSE
├── README.md
├── package.json
└── tsconfig.json
```

The package exposes its Pi extension through `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

## 🔎 Keywords

Pi extension, coding agent, todo list, task progress, session widget, TypeScript Pi package.

## 📄 License

MIT.

See [`LICENSE`](./LICENSE).
