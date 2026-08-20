# @narumitw/pi-starship

## 0.52.0

### Minor Changes

- 7a61fe5: Add nested configuration views for effective public TOML and the exact loaded settings document, plus a validated preview-and-confirm reload workflow for external edits and file removal.

### Patch Changes

- Updated dependencies [f47364f]
  - @narumitw/pi-tui-kit@0.56.1

## 0.51.5

### Patch Changes

- 37bf862: Load the extension from a generated split TypeScript runtime to reduce Jiti package startup work while preserving lazy command and collector boundaries.

## 0.51.4

### Patch Changes

- 5f0ccd3: Load lightweight Pi TUI Kit helpers without evaluating the full menu runtime during extension startup.

## 0.51.3

### Patch Changes

- Updated dependencies [8bead31]
  - @narumitw/pi-tui-kit@0.56.0

## 0.51.2

### Patch Changes

- Updated dependencies [3176172]
  - @narumitw/pi-tui-kit@0.55.0

## 0.51.1

### Patch Changes

- 11bdf1e: Update runtime dependencies for chat networking, Starship TOML parsing, and TUI syntax highlighting.
- Updated dependencies [11bdf1e]
  - @narumitw/pi-tui-kit@0.54.1

## 0.51.0

### Minor Changes

- ff35763: Render the existing native GitHub PR `$checks`, `$review`, and `$status` variables as compact symbols and counts by default.

  This is a breaking display change for custom formats that expect the previous English values; variable names and the default module format remain unchanged.

## 0.50.3

### Patch Changes

- c3721fd: Reuse Pi TUI Kit's display-only terminal sanitizer for model, symbol, and directory text.

## 0.50.2

### Patch Changes

- d403f3c: Use Pi TUI Kit's published Live Choice interaction for preset browsing while keeping active-preset customization available.

## 0.50.1

### Patch Changes

- 306a4e5: Use Pi TUI Kit's standard adaptive review screen for the read-only footer explanation while keeping inspection snapshots and formatting in Starship.
- Updated dependencies [4a0358b]
- Updated dependencies [93b507b]
  - @narumitw/pi-tui-kit@0.53.0

## 0.50.0

### Minor Changes

- 46f59ba: Add four bundled Pi-native footer presets with menu browsing, live preview, optional TOML customization, confirmed atomic application, and built-in recovery.
