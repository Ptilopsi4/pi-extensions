# axiv CLI Installation

## Install with uv

Use an existing `axiv` executable when `axiv --help` succeeds.

If the command is unavailable, install the published package with `uv tool install axiv`.

Do not use `sudo` for the installation.

Run `axiv --help` to verify that the installed executable is available.

Use `uv tool update-shell` and start a new shell when installation succeeds but `axiv` is not on `PATH`.

## Update before troubleshooting

When an authenticated command reports an unexpected runtime, MCP connection, initialization, or breaking tool drift error, first run `uv tool upgrade axiv` before diagnosing it.

Do not upgrade for invalid input, a missing API key, `401`, `403`, quota exhaustion, or an expected not-found response.

If uv reports that the tool is not installed, run `uv tool install axiv` instead.

Verify the updated published executable with `axiv --help` and `axiv auth status --json`.

If the error came from `uv run axiv` in a source checkout, use the updated published executable for verification before changing source code.

Do not automatically repeat quota-consuming research commands, remote library writes, or tool calls with ambiguous outcomes after updating.

## Run from a source checkout

From the repository root, use `uv run axiv --help` to create the project environment and verify the source CLI.

Use `uv run axiv` as the command prefix for subsequent commands in that checkout.

## Authentication setup

Set `ALPHAXIV_API_KEY` in the environment before using authenticated research or library commands.

Never pass the API key as a command argument or write it into the Skill files.

Verify authenticated access with `axiv auth status --json`, or with `uv run axiv auth status --json` from a source checkout.

## Failure handling

Stop and report the installation output when `uv` is unavailable, package installation fails, or neither command prefix can show help.

Do not bypass an installation failure by calling alphaXiv endpoints or importing private client code.
