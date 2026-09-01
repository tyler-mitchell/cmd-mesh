---
cmd-mesh: patch
---

`CMSH1013` now checks a parameter's `mcp` object too. A command's `mcp` block was checked and a parameter's was not, so `mcp: { hiden: true }` on a parameter passed silently and left the parameter advertised in the agent-facing schema — the exact case the diagnostic exists to catch.
