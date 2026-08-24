# 🧰 pi-tool — Deprecated Pi Tool Browser

[![npm](https://img.shields.io/npm/v/@narumitw/pi-tool)](https://www.npmjs.com/package/@narumitw/pi-tool) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> `@narumitw/pi-tool` is deprecated without a replacement, kept under `deprecated/` for reference, and excluded from active workspace checks, tests, releases, and maintenance.
> Remove the deprecated package with:
>
> ```bash
> pi uninstall npm:@narumitw/pi-tool
> ```

This archived extension browsed every tool configured in the current Pi session and inspected its active state, description, origin, schema, and prompt guidance through one read-only `/tool` command.

## ✨ Features

- Lists built-in, SDK-provided, and extension-provided tools in one searchable catalog.
- Shows active state, description, source, scope, origin, path, and optional base directory.
- Displays the complete JSON parameter schema and prompt guidelines exposed by Pi.
- Shows the effective system-prompt snippet for each active tool.
- Refreshes metadata every time the catalog opens.
- Never changes tools, settings, files, or session data.

## 📦 Archived reference

Build and inspect the archived package only when maintaining historical behavior:

```bash
cd deprecated/pi-tool
npm run build
pi -e .
```

The package declares `dist/index.ts`, so the build command must finish before Pi loads the archived package directory.
Extensions run with the same permissions as Pi.
Only load archived code from sources you trust.

## 🚀 Quick start

Run:

```text
/tool
```

Type to filter the list, move to a tool, and press Enter to open its details.
Escape returns to the list and then closes the catalog.

The command works in TUI and RPC modes.
It rejects arguments and rejects print or JSON modes because Pi does not provide an observable interactive command surface there.

## 💬 Commands

| Command | Description |
| --- | --- |
| `/tool` | Browse configured tools and inspect their exposed metadata. |

`/tool` intentionally accepts no arguments and does not enable, disable, or execute tools.

## ℹ️ Metadata limits

The catalog displays the fields returned by Pi's public `pi.getAllTools()` API: name, description, parameter schema, prompt guidelines, and source metadata.
It combines those fields with the effective snippets returned by `ctx.getSystemPromptOptions()` for the current active tool set.
An inactive tool's configured snippet is not exposed through the Extension API, so “None in the current system prompt” does not mean its full definition has no snippet.
Pi does not expose a tool's implementation, runtime secrets, or label through these Extension APIs.

## 🗂️ Package layout

```text
deprecated/pi-tool/
├── src/
│   ├── index.ts         # Thin repository entrypoint
│   ├── tool.ts          # Command and session lifecycle ownership
│   └── tool-catalog.ts  # Lazy browse menu and exact detail projection
├── dist/                # Generated Jiti runtime and lazy catalog chunk
├── scripts/build-runtime.mjs
├── test/
├── README.md
├── LICENSE
├── package.json
└── tsconfig.json
```

## 🔎 Keywords

Pi extension, Pi coding agent, tool browser, tool catalog, tool schema, prompt guidelines, TypeScript Pi package.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
