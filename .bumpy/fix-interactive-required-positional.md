---
cmd-mesh: patch
---

Guided invocation no longer accepts an empty submission for a required positional. The prompt read the flag-only `required` field, which a positional never sets, so `<entry>` was offered as skippable. The command line then failed validation after the walk. The prompt now uses the same requiredness rule as the spec: a positional is optional only when its usage says so.
