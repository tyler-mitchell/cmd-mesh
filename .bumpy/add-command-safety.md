---
cmd-mesh: minor
repo-ops: minor
---

Added the command safety taxonomy: `safety: "read" | "action" | "destructive"` on internal and external commands, validated at compile time, exposed in the spec, and projected to MCP tool annotations with both hints always explicit (`readOnlyHint` and `destructiveHint`) so clients never fall back to their destructive-by-default assumption. Every repo-ops operation now declares its safety.
