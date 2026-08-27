# Fig autocomplete spec alignment

Audit of `@withfig/autocomplete-types@1.31.0` (the real Fig autocomplete
schema — `Fig.Subcommand`/`Option`/`Arg`/`Suggestion`/`Generator`) against
the cmd-mesh declaration model. Note: `packages/fig-plugin-types` vendors
Fig's *legacy shell-plugin* format (`Fig.Plugin`), a different artifact —
it is not this schema.

## Captured — equivalent or stronger

| Fig | cmd-mesh |
| --- | --- |
| `Subcommand.subcommands` (recursive tree) | `commands` tree + mounting by reference |
| `Option.name: string[]` (aliases) | `cli: "--port, -p"` |
| `Option.isRequired` | `required: true` |
| `Arg.isVariadic` / `isOptional` | `<...xs>` / `[x]` usage notation |
| `Arg.suggestions` (static) | `suggest: [...]` |
| `Arg.generators` / `Generator.custom` | `suggest: (ctx) => ...` with `ctx.exec` |
| `Arg.template: "filepaths" \| "folders"` | `suggest: "filepaths" \| "folders"` |
| `Generator.scriptTimeout` | `ExecOptions.timeoutMs` |
| `ExecuteCommandInput/Output` | `ExecOptions`/`ExecResult` (near-identical shape — convergent) |
| `hidden` | `cli.hidden` / `mcp.hidden` (per-surface, richer) |
| `Arg.default` (display-only string) | ArkType input-side defaults (real, validated, morphing) |

Where Fig is untyped (every value is a string to suggest), ArkType
definitions give cmd-mesh validation, parsing, enum-driven suggestion, and
schema projection Fig never had. That asymmetry is the product.

## Adoption queue (real gaps, ranked)

1. `isDangerous` → a universal `dangerous: true` on commands/parameters:
   projects to MCP `destructiveHint` (today hand-written in
   `mcp.annotations`), autoexec suppression in any interactive surface,
   and a visual marker in help.
2. `Option.isPersistent` → inherited flags available to all subcommands.
   Same gap as "root flags before a subcommand" — Fig's answer is the
   right shape: `persistent: true` on a root parameter.
3. `Option.isRepeatable` → repeatable flags (`--tag a --tag b`, `-vvv`).
   cmd-mesh variadics are positional-only today.
4. `exclusiveOn` / `dependsOn` → declarative cross-parameter constraints.
   `narrow` covers validation but is an opaque function; these are
   serializable, drive completion filtering (stop suggesting excluded
   flags), and project to agents.
5. `deprecated` (with replacement metadata) → universal metadata for help,
   suggestion ranking, and agent guidance.
6. `Generator.cache` (ttl / stale-while-revalidate / by-directory) →
   suggestion caching once generators get expensive.
7. `requiresSeparator`, `parserDirectives` (posix-noncompliant flags,
   options-before-args, separators) → parser knobs for wrapping
   nonstandard externals.
8. `loadSpec` / `generateSpec` / `Arg.isCommand` → dynamic spec
   composition (lazy subtrees, "this argument is itself a command").
   cmd-mesh mounting is static; the dynamic form matters for wrapping
   tools with plugin-extensible surfaces.

## Presentation layer — deferred with the interactive projection

`displayName`, `icon`, `priority`, `insertValue`, `replaceValue`,
`filterStrategy: "fuzzy"`, `suggestCurrentToken`, `additionalSuggestions`,
`debounce`, `trigger`, `getQueryTerm`, `previewComponent`, the `history`
template. These describe entries and mechanics of Fig's rendered overlay.
They enter when suggestions grow from strings into Suggestion-shaped
objects for the interactive surface; the shell callback protocol has no
slot for them.

## Not applicable

`SpecLocation` (Fig cloud spec hosting), `isScript`/`isModule`
(deprecated), `VersionDiffMap` spec versioning (cmd-mesh specs version
with their package), `Arg.parserDirectives.alias` (shell alias expansion
belongs to the shell integration, not the model).
