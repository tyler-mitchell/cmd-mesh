# Changelog

## 0.1.0
<sub>2026-09-01</sub>

- *(minor)*
  First release: the closed-distribution repository operations (Bumpy release procedure, CI runs, dependabot PRs) as mountable cmd-mesh modules, configured with the published package name.
- *(minor)*
  Added the command safety taxonomy: `safety: "read" | "action" | "destructive"` on internal and external commands, validated at compile time, exposed in the spec, and projected to MCP tool annotations with both hints always explicit (`readOnlyHint` and `destructiveHint`) so clients never fall back to their destructive-by-default assumption. Every repo-ops operation now declares its safety.
- *(minor)*
  The package ships an agent skill in the tarball (`skill-data/core/SKILL.md`): the release procedure, CI, dependabot, and git surfaces with their safety contract and the cli-only streaming rule, discoverable by agents from node_modules.
- *(minor)*
  Fixed release-blocking runtime, MCP projection, config-key, generated-identifier, and package-content defects. Added compact review-thread commands for release work.
- *(patch)*
  Replaced workspace-only ArkType metadata defaults with native default tuples in declarations, generated code, and documentation. `CMSH1016` rejects metadata that looks like an applied default before it becomes a required parameter.
