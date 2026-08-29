---
cmd-mesh: minor
---

The package now ships an agent skill in the tarball (`skill-data/core/SKILL.md`): code-first usage instructions agents discover from node_modules, covering the one-declaration surfaces, externals, exec, the safety contract, spec-first planning, mounting, and caller-owned MCP transports. The MCP projection also gained `mcp.server()`, the same server as a connectable instance for a caller-owned transport, and serves the spec as the `cmd-mesh://spec` resource with a paired `<name>_spec` read tool.
