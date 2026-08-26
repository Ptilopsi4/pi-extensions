---
"@narumitw/pi-lsp": patch
---

Key published diagnostics by a canonical file path so servers that answer with a different but equivalent URI encoding are matched. Servers such as marksman publish `file:///c%3A/dir/a.md` where Node produces `file:///C:/dir/a.md`, which previously dropped every publication and reported the file as clean.
