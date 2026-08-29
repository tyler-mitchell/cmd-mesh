---
cmd-mesh: minor
---

Declaration validation now emits coded diagnostics: every `InvalidDeclaration` issue line carries a stable `CM1xxx` code and a fix hint, built on `nostics` at the validation boundary while the tagged error classes remain the error channel. The errors reference lives at `docs/errors.md` in the package.
