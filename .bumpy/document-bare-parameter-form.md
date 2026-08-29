---
cmd-mesh: patch
---

The README, the reference, and the bundled agent skill now teach that a bare ArkType definition is a complete parameter: `input: { force: "boolean" }` derives the flag `--force` from the key. The shipped code always accepted this, but every example used the `{ type, cli }` descriptor, so readers concluded the descriptor was mandatory.
