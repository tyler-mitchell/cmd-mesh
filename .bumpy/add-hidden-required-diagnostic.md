---
cmd-mesh: minor
---

A required parameter that is hidden from mcp is now a declaration error (`CMSH1015`). The tool schema omits the parameter, so an agent cannot supply it and every call fails validation; the `env` fallback does not help, because it runs on the cli path only. Declare a default, make the parameter optional, or hide the whole command from mcp.
