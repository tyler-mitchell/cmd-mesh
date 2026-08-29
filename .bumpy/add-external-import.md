---
cmd-mesh: minor
---

Added `importExternal`: turn a binary's observed command surface into an `external()` declaration. The surface is described in this model's own terms — commands, options with their name tokens, arguments with optional/variadic/suggest — so a converter that reads another tool's spec file maps into these fields and the importer never carries a foreign grammar. Per command, `curation` supplies what an observed surface cannot state: `flags` names exactly the options to keep, and a required `safety` classification gives every imported command explicit MCP hints, because a command with no hints reads as destructive.
