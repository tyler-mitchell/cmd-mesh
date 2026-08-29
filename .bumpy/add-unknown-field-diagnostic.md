---
cmd-mesh: minor
---

A misspelled parameter or command field is now a declaration error (`CMSH1013`) instead of a silent no-op. TypeScript's excess-property check covers a declaration unevenly — it misses a field typed as a union with a primitive, which is where parameters live, so `cli: { complete: "filepaths" }` and `sugest: "folders"` both compiled clean — and a JavaScript caller gets no check at all. The interpreter now names the stray field and lists the ones that exist. The command-level case matters most: `mcp: { hiden: true }` left a command advertised to agents.
