---
cmd-mesh: minor
---

Added `importExternal`: convert a foreign command description into an `external()` declaration, with the source grammar named as data (`format: "fig"` reads the `withfig/autocomplete` shape). Per subcommand, `curation` supplies what a completion spec cannot express — `flags` names exactly the options to keep, and a required `safety` classification gives every generated command explicit MCP hints, because a command with no hints reads as destructive. A `filepaths` or `folders` template becomes the parameter's suggestion source.
