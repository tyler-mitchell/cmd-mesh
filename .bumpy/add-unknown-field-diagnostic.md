---
cmd-mesh: minor
---

A misspelled parameter field is now a declaration error (`CMSH1013`) instead of a silent no-op. A declaration reaches the compiler through a `const` generic, whose constraint is checked by assignability — and assignability ignores extra properties, so `tsc` cannot see a typo like `cli: { complete: "filepaths" }` or `sugest: "folders"`. The interpreter now names the stray field and lists the ones that exist.
