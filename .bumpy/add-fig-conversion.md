---
cmd-mesh: minor
---

Added `importExternal`: convert a foreign command description into an `external()` declaration, with the source grammar named as data (`format: "fig"` reads the `withfig/autocomplete` shape). A per-subcommand flag allowlist is mandatory — Fig carries no requiredness or output contracts, so curation supplies both and prevents the 100-plus-option flood an uncurated program produces. A `filepaths` or `folders` template becomes the parameter's suggestion source.
