---
cmd-mesh: patch
---

A handler now receives only the parameters its command declares. An argument that no parameter declares reached the handler untouched, so an mcp client could put any key it invented into handler input; the cli already rejected an undeclared flag. Undeclared keys are stripped at the value boundary on every surface.
