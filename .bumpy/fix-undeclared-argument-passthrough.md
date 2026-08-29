---
cmd-mesh: patch
---

An mcp tool call now carries only the parameters its command declares. An argument that no parameter declares reached the handler untouched, so an agent could put any key it invented into handler input; the cli already rejects an undeclared flag.
