# @narumitw/pi-accounts

## 0.49.8

### Patch Changes

- dc4f90e: Load each extension from a generated source-mapped Jiti runtime while preserving first-use feature boundaries.

## 0.49.7

### Patch Changes

- 25aa27e: Use Pi's native login dialog and selector for provider OAuth steps in TUI mode while preserving standard extension UI requests in RPC mode.

## 0.49.6

### Patch Changes

- d3242d6: Pass the account menu's abort signal to provider-owned OAuth login so interactive GitHub Copilot and other provider logins do not fail while Pi is idle and stop safely when their session closes.
