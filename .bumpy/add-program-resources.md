---
cmd-mesh: minor
---

Added program-level resources: declared acquire/release pairs run around every handler invocation on all three surfaces — acquired before the handler, typed on ctx.resources, released in reverse order whether the handler succeeds or throws.
