# `cmd-mesh`

The command mesh model, implemented: one declarative program definition that
is simultaneously a set of plain typed functions, a CLI, an MCP server, a
completion source, and a typed wrap over external binaries. The contract is
[ideations/08-final.ts](./ideations/08-final.ts); this package is its
interpreter.

```ts
import { external, program } from "cmd-mesh"

const git = external({
  name: "git",
  commands: {
    status: {
      description: "working tree status",
      input: { short: { type: "boolean", cli: "--short, -s" } },
      output: "string"
    }
  }
})

const mesh = program({
  name: "mesh",
  version: "0.1.0",
  commands: {
    serve: {
      description: "serve a directory over http",
      input: {
        directory: { type: "string", cli: { usage: "<directory>", complete: "folders" } },
        port: { type: "string.integer.parse = '3000'", cli: { usage: "--port, -p", env: "MESH_PORT" } },
        verbose: { type: "boolean", cli: "--verbose, -v" }
      },
      run: (input) => ({ served: input.directory, port: input.port })
      //     ^ inferred: { directory: string; port: number; verbose: boolean }
    },
    git // a module mounts by reference — nesting mechanism for programs too
  }
})
```

One declaration, consumed three ways:

```ts
await mesh.serve({ directory: "./public" })      // typed function; port defaults to 3000
await mesh.main(process.argv.slice(2))           // cli: mesh serve ./public -p 8080
// claude mcp config: { "command": "mesh-bin", "args": ["mcp"] }
//   → tools mesh_serve, mesh_git_status with ArkType-projected JSON Schemas
```

## The two boundaries

Each command compiles to two ArkType types:

- **token boundary** (`argv`): CLI strings in, values out — morphs parse
  (`string.integer.parse`), ArkType input-side defaults apply
  (`= '3000'`), booleans come from flag presence/`--no-x` negation.
- **value boundary** (direct calls and MCP): canonical values in
  (`port: 8080`), defaults evaluated through their morphs at compile time,
  same command-level `narrow` cross-field invariants.

Both feed the same handler. `module.args` exposes the value-boundary type
(`assert`/`allows`/`toJsonSchema`); the un-narrowed variant powers MCP input
schemas (predicates are not JSON-Schema-representable).

A parameter's `type` is any ArkType definition — string defs, object defs,
tuple expressions, Type instances. A bare string at parameter position is
the shorthand; an object at parameter position is always a descriptor, and
its `type` field is verbatim ArkType. Structured parameters
(`tlsKey: { type: { a: "string" } }`) take real objects on the value
boundary and a JSON token on the CLI (`--tls-key '{"a":"…"}'` —
input-domain JSON, morphed through the definition), and project full
nested JSON Schemas to MCP.

## Module surface

| member | meaning |
| --- | --- |
| `module(input)` / `module.sub(input)` | typed direct invocation (assert semantics: invalid input throws; the argument is optional when every key is optional) |
| `module.args` | compiled value-boundary ArkType surface |
| `module.main(argv)` | CLI projection; routes `--help`, `--version`, and the reserved `mcp`, `completion <shell>`, and `__complete` subcommands |
| `module.mcp.tools` / `module.mcp.serve()` | MCP projection (stdio, `@modelcontextprotocol/sdk`) — tools carry `outputSchema`, calls return schema-conformant `structuredContent` (non-object outputs wrapped under `result`) |
| `module.help(path?)` / `module.complete(words)` | rendered help (usage, Arguments/Options sections with `[possible values: …]` from ArkType unions, defaults, required markers, root Built-in section); completion candidates |
| `module.spec` | the compiled model as pure data, functions stripped |
| `module.dispose()` | releases the Effect runtime |

## Declaration validation

`program()`/`external()` validate the whole declaration at compile time and
throw one `InvalidDeclaration` listing every problem with its
command/parameter path — unparsable ArkType defs, flag token collisions
(including aliases), variadic positionals that aren't last, boolean
positionals, env fallback on positionals:

```
invalid declaration:
  tool broken · bad: ParseError: 'not.a.keyword' is unresolvable
  tool broken: flag --same is claimed by flag and other
```

## Process execution

`ctx.exec(bin, args, options?)` runs through the Effect process spawner:
exit codes are reported, not thrown (branch on `result.exitCode` — `git
grep`'s 1-means-no-match is the canonical case). Options: `cwd`, `env`,
`timeoutMs` (interruption kills the process), and `stdio: "inherit"` to
stream a long-running child straight to the terminal (result carries the
exit code with empty output strings).

## Shell completion

The declaration drives tab completion end to end. `<bin> completion zsh`
(or `bash`) prints an installable script; the script calls back into
`<bin> __complete <words…>`, which answers from the compiled model:
subcommands, flags with aliases and `--no-x` negations, literal values
enumerated from ArkType unions (`"'patch' | 'minor' | 'major'"`
tab-completes), and `complete: "filepaths" | "folders"` sources translated
to the shell's native file completion. Positional slots are tracked, so a
consumed enum stops offering itself.

`complete` also takes a Fig-style generator — `(ctx: CompleteContext) =>
Promise<string[]>` with `ctx.exec` available — for candidates computed at
completion time (real branch names, workspace manifests). Hoist generators
to consts with annotated parameters: an inline arrow is context-sensitive
and collapses the command's type inference. Generator failures degrade to
static candidates; completion never errors.

## CLI rendering

Human output follows the grep convention: string results print raw, arrays
of flat records print as aligned rows, everything else pretty JSON. Agents
never see this — MCP responses carry JSON text plus `structuredContent`.

## Nesting

Mount modules by reference — `commands: { cache, git }` — at any depth; each
mounted program/external carries its own full inference. Inline `commands`
one level deep infer fully (bare `(input, ctx)` handlers included); deeper
inline handlers lose contextual parameter types (a TypeScript
reverse-mapped-inference limit), which surfaces as a loud implicit-any error
— the fix is to mount a subprogram, which is the intended structure anyway.

## Internals

- Effect TS v4 throughout, per the repo praxis in [AGENTS.md](../../AGENTS.md).
  Nothing Effect-shaped leaks: the public surface is plain values and
  Promises via `ManagedRuntime`.
- Process execution is `effect/unstable/process` (`ChildProcessSpawner`),
  chosen over tinyexec: scoped interruption-safe child processes, streamed
  output, typed exit codes, zero adapter code. `ctx.exec` in handlers is a
  thin promise bridge over the same service.
- Validation is ArkType only. Errors are `Data.TaggedError` classes —
  Effect Schema is not used anywhere.

## Planned projections

- **Interactive CLI** (Ink): generated prompt flows from the same compiled
  model — each parameter already carries type, description, completion
  source, and default, which is exactly what a prompt generator needs. This
  is the Fig lineage of the design: a rich spec that powers a human UI.

## Validation

```sh
pnpm --filter cmd-mesh run typecheck
pnpm --filter cmd-mesh run test        # vitest: public surface + interpreter internals
pnpm --filter cmd-mesh run test:types  # @ark/attest inference proofs
```

[examples/demo.ts](./examples/demo.ts) drives every surface for real;
[examples/bin.ts](./examples/bin.ts) is a working bin (`tsx examples/bin.ts
serve . -p 8080`, `tsx examples/bin.ts mcp`).
