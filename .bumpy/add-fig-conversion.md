---
cmd-mesh: minor
---

Added `figToExternal`: convert a Fig completion-spec subset (the `withfig/autocomplete` shape) into an `external()` declaration, with a mandatory per-command flag allowlist — Fig carries no requiredness or output contracts, so curation supplies both and prevents the 100-plus-option flood an uncurated program produces.
