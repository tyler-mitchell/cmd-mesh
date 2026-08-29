# ideations

> **Status**: [08-final.ts](./08-final.ts) is implemented in
> [../src](../src) — see the [package README](../README.md). These files
> remain as the design record.

Contract drafts for `@cmd-mesh/core`. Nothing is implemented: each file ends
with a `declare` stub section so the usage above it typechecks as shape.
Handler inputs carry explicit annotations from a "depicted inference" section
— those state what the real contract must infer, and vanish once it does.

All candidates share one scenario so they compare directly: a `mesh` dev tool
with `serve` and `build` commands, plus a typed wrap of the external `git`
binary.

## Invariants every candidate honors

- Parameters are ArkType one-argument definitions. Consumers get
  ArkType-grade autocomplete and validation without importing ArkType. A
  parameter value is the bare definition string, or a flat descriptor
  object (`{ type, ...meta }`) — an object at parameter position is always
  a descriptor, which keeps `type` unambiguous, and `type` itself accepts
  any ArkType definition including object defs (revised during
  implementation: structured parameters take JSON tokens on the cli and
  real objects on the value/mcp surface).
- Fig-grade richness (descriptions, completion sources, suggestions, hidden,
  variadics) lives inside the declaration, not in side registration.
- The declaration is data; one thin interpreter fulfills it. No builder
  chains, no `.action()` registration, no mutation.
- Every command is directly callable as a typed function. The CLI is one
  projection of the model, not its owner.
- External binaries execute through tinyexec behind the same contract shape.
- Effect is an internal runtime candidate only. The public surface is plain
  promises.

## Candidates

| file | authoring shape | grammar lives in | distinguishing bet |
| --- | --- | --- | --- |
| [01-command-tree.ts](./01-command-tree.ts) | nested object tree | object keys + descriptor objects | maximum explicitness, easiest inference |
| [02-signature-strings.ts](./02-signature-strings.ts) | flat maps with string signatures | the strings themselves | maximum ArkType feel, template-literal inference |
| [03-spec-and-bind.ts](./03-spec-and-bind.ts) | pure JSON spec + separate handler map | serializable data | spec is projectable/diffable with zero handler code loaded |
| [04-external-weave.ts](./04-external-weave.ts) | tree (01 style) + `external` contracts | same as 01 | the mesh: internal and external commands in one fabric |
| [05-module-return.ts](./05-module-return.ts) | tree (01 style), module return | same as 01 | `program` returns `{ [name]: callableModule }` — the typed function module is the product, argv one caller |
| [06-unified-input.ts](./06-unified-input.ts) | tree, single `input` map | metadata (`at: "position"`) | one parameter construct; positional vs option is a property, not a block (clap/argparse precedent) |
| [07-contract.ts](./07-contract.ts) | tree, module return, unified input | per-parameter `cli` usage-notation strings | the merit-decided synthesis, fully justified in-file |
| [08-final.ts](./08-final.ts) | **adopted** — 07 revised | `cli:` / `mcp:` surface blocks | tools as the model, CLI and MCP as peer projections; nesting by reference; `ctx.exec` |
| [09-practical.ts](./09-practical.ts) | worked example of 08 | — | `repokit`: one bin shipping as CLI and MCP server (`repokit mcp`), surfaces diverging by one key |
| [10-hkt-contracts.ts](./10-hkt-contracts.ts) | commands as named contracts in a registry | contract names, referenced as strings | a command is a name rather than a position, so it can be reused, derived, and nested by reference |

04 and 05 are orthogonal to 01–03: 04 settles the external-command leg, 05
settles the return shape, and both compose with whichever authoring style
wins. 05 also removes the double naming in 01–04 (`const mesh = program({
name: "mesh" })` states the name twice; destructuring derives the binding
from the declaration).

10 is exploratory, not a candidate to adopt. It records what higher-kinded
contracts would offer at the authoring level, with two results measured
against arktype 2.2.3: a contract containing other contracts infers exactly
two levels deep, which the adopted shape cannot do without mounting, and a
bare handler written against such a contract typechecks with no annotation.
The cost measured against the adopted shape was unfavourable — about 15%
more type instantiations for an artifact carrying no callable surface and no
argv handling.

## Adopted contract

[08-final.ts](./08-final.ts) is the adopted contract — 07's synthesis
(unified input, usage-notation bindings, ArkType-native input-side defaults,
symmetric `output` contracts, assert-throw direct calls, `spec` as an
extracted projection) with four revisions: plain module return under a
declared `name`; nesting by reference (programs and externals mount in
`commands` uniformly, `externals:` key gone); argv-specific parameter config
grouped under `cli:` with a symmetric `mcp:` block, reframing the model as
tools with CLI and MCP as peer projections; and interpreter-owned `ctx`
(`ctx.exec` via tinyexec, `ctx.surface`) distinct from user dependency
wiring, which stays in module scope. `external` remains optional and purely
additive — the file header carries its full value case.

## Open questions

- Defaults: ArkType input-side string defaults (`"string.integer.parse =
  '3000'"`, candidate 02) versus meta-level output defaults (`default: 3000`,
  candidates 01/03). One must win; carrying both is incoherent.
- Positional metadata in 02: signature strings name positionals but have no
  natural slot for their completion sources.
- Nested subcommand paths in 03's handler map (`"remote add"` keys) are
  sketched but unresolved.
- Whether direct invocation validates through the same ArkType pipeline as
  argv parsing (it should), and what its error surface is (thrown ArkErrors
  vs result object).
