---
"@narumitw/pi-starship": minor
---

Add module-local appearance behaviors, all preserved through the existing settings document:

- `thinking` now follows the current native Pi theme's per-level colors (`style_off` through `style_max` stay available as explicit overrides); the legacy `style` field remains the fallback for unknown levels.
- `model` renders a deterministic per-model hash color (same-series models share a hue; distinct models differ) while `[model] style` has no explicit color. `[model] model_styles` maps exact ids or prefixes to explicit styles, and `[model] hash_colors = false` restores the configured style color.
- `[provider] provider_aliases` shortens provider names.