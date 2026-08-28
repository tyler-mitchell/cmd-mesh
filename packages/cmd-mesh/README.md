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
  version: "0.2.0",
  commands: {
    snapshot: {
      description: "record a directory snapshot",
      input: {
        directory: { type: "string", suggest: "folders", cli: "<directory>" },
        depth: { type: "string.integer.parse = '2'", cli: { usage: "--depth, -d", env: "MESH_DEPTH" } },
        verbose: { type: "boolean", cli: "--verbose, -v" }
      },
      run: (input) => ({ snapped: input.directory, depth: input.depth })
      //     ^ inferred: { directory: string; depth: number; verbose: boolean }
    },
    git // a module mounts by reference — nesting mechanism for programs too
  }
})
```

The typed functions ARE the program; the CLI and the MCP server are its
two projections:

```ts
mesh.snapshot({ directory: "./public" })  // the program itself: a sync handler
                                          //   is a sync function — no promise

// bin.ts — the complete entry point; the word `mcp` serves agents,
// everything else is the cli. one line, zero plumbing.
await mesh.main()

// claude mcp config: { "command": "mesh-bin", "args": ["mcp"] }
//   → tools mesh_snapshot, mesh_git_status with ArkType-projected JSON Schemas
```

## Declaration reference

Everything a parameter or command can declare, in one place. The `cli`
string is the usage notation; an object form adds cli config beside it.

```ts
const tool = program({
  name: "tool",
  version: "1.0.0",
  cli: { default: "dev" },              // bare `tool` runs `tool dev` (an alias works too)
  // program-level options: root input joins EVERY command's handler,
  // call surface, and schema — `tool --log-level debug dev` and
  // `tool dev --log-level debug` both reach the handler
  input: {
    logLevel: { type: "'debug' | 'info' = 'info'", cli: "--log-level" }
  },
  commands: {
    dev: {
      description: "start dev mode",
      cli: {
        alias: ["d"],                                       // `tool d` ≡ `tool dev`
        examples: ["tool dev src/main.ts --port 8080"]      // an Examples section in help
      },
      input: {
        entry: { type: "string", cli: "<entry>" },          // required positional
        out: { type: "string", cli: "[out]" },              // optional positional
        files: { type: "string", cli: "[...files]" },       // variadic (zero ok; <...files> requires one)
        port: { type: "string.integer.parse = '3000'",      // parsed + defaulted
          cli: { usage: "--port, -p", env: "TOOL_PORT" } }, // argv > env > default
        tag: { type: "string", cli: "--tag <tags...>" },    // repeatable → string[]
        token: { type: "string",                            // `required: true` would force a flag
          cli: { usage: "--token", hidden: true },          // hidden: out of help/completion, still parses
          mcp: { hidden: true } },                          // out of the tool schema, still validates
        level: { type: "'debug' | 'info' | 'warn'" }        // no cli → derived --level flag,
        //                                                  //   union members tab-complete
      },
      narrow: (input, ctx) =>                               // cross-field invariant, both boundaries
        input.out === input.entry ? ctx.mustBe("a distinct output path") : true,
      output: { url: "string", tags: "string[]", logLevel: "string" },
      run: (input) => ({                                    // ArkType output contract → MCP outputSchema
        url: `http://localhost:${input.port}`,
        tags: [...input.tag],
        logLevel: input.logLevel                            // ← the program-level option, right here
      }),
      mcp: {
        name: "tool_serve",                                 // overrides the derived tool name
        annotations: { readOnlyHint: true }                 // MCP tool annotations, verbatim
      }
    },
    render: {
      description: "custom human rendering",
      cli: { render: (output) => `→ ${output.url}` },       // humans only; --json and MCP unaffected
      output: { url: "string" },
      run: () => ({ url: "https://example.com" })
    }
  }
})
```

Every command also answers `--json` (machine output on stdout), `--help`,
and the program `--version`.

## Exit codes

`cli.run`/`main` resolve the getopt convention: `0` success, `2` usage
errors (unknown command/flag, missing value, invalid input), `1` runtime
failures. Every usage error appends the routed command's usage line and
a `--help` pointer, so one failed invocation is enough to self-correct. A handler that needs a *report* exit — `diff`'s "differences
found", a linter's severity code — throws an error carrying `exitCode`;
that code owns the exit and the message prints bare, without failure
framing:

```ts
run: (input) => {
  const drifted = check(input)
  if (drifted.length > 0) {
    throw Object.assign(new Error(`${drifted.length} files drifted`), { exitCode: 3 })
  }
  return { clean: true }
}
```

## Testing a mesh program

The typed functions are the test seam — call them directly, no argv, no
process, no capture machinery:

```ts
expect(tool.dev({ entry: "src/main.ts" })).toEqual({ url: "http://localhost:3000" })
expect(() => tool.dev({ entry: "x", out: "x" })).toThrow(/distinct output/)
```

For argv-grammar concerns, `cli.run(argv)` is pure toward the process —
it returns the exit code and never calls `process.exit` — so asserting
on it composes with any output-capture your test harness already has.
`cli.help()` and `cli.complete(words)` return strings/arrays directly.

A handler that shells out needs no mocking seam: it is a plain function
and `Ctx` is a structural exported type, so hoist it to a const and unit
test it against a hand-built ctx:

```ts
import type { Ctx } from "cmd-mesh"

const list = async (input: { readonly dir: string }, ctx: Ctx) => {
  const result = await ctx.exec("git", ["ls-files", input.dir])
  return { files: result.stdout.split("\n").filter(Boolean) }
}
// in the declaration: run: list
// in the test: await list({ dir: "src" }, { surface: "call", exec: fakeExec })
```

## The two boundaries

Each command compiles to two ArkType types:

- **token boundary** (`argv`): CLI strings in, values out — morphs parse
  (`string.integer.parse`), ArkType input-side defaults apply
  (`= '2'`), booleans come from flag presence/`--no-x` negation.
- **value boundary** (direct calls and MCP): canonical values in
  (`depth: 4`), defaults evaluated through their morphs at compile time,
  same command-level `narrow` cross-field invariants.

Both feed the same handler. `module.args` exposes the value-boundary type
(`assert`/`allows`/`toJsonSchema`); the un-narrowed variant powers MCP input
schemas (predicates are not JSON-Schema-representable).

A parameter's `type` is any ArkType definition — string defs, object defs,
tuple expressions, Type instances. A bare string at parameter position is
the shorthand; an object at parameter position is always a descriptor, and
its `type` field is verbatim ArkType. Structured parameters
(`signKey: { type: { a: "string" } }`) take real objects on the value
boundary and a JSON token on the CLI (`--sign-key '{"a":"…"}'` —
input-domain JSON, morphed through the definition), and project full
nested JSON Schemas to MCP.

## Synchrony

The typed functions keep their handler's own synchrony: a sync handler
compiles to a sync function, and only a handler that returns a promise
(async work, `ctx.exec`, wrapped externals) compiles to an async one —
the return type tells you which. Input validation is eager and
synchronous for every function (assert semantics: invalid input throws,
even from an async-typed function); handler and output failures follow
the handler's synchrony. `try { await fn(...) } catch` handles every case
uniformly. Failures are the exported tagged classes (`InvalidInput`,
`HandlerFailure`, `InvalidOutput`, `ExternalExit`, …), catchable by type.

## Module surface

| member | meaning |
| --- | --- |
| `module(input)` / `module.sub(input)` | the program itself: typed invocation, handler-synchronous (the argument is optional when every key is optional) |
| `module.args` | compiled value-boundary ArkType surface (`assert`/`allows`/`toJsonSchema`) |
| `module.main(argv?)` | the composed bin: head token `mcp` serves the MCP projection, anything else runs the CLI projection. Bare `main()` reads process argv and owns the exit code — a complete `bin.ts` is `await mytool.main()`. A program whose own vocabulary needs the word `mcp` uses `cli.run()` as its bin instead |
| `module.cli.run(argv?)` | the CLI projection alone: parse, route, run, render, resolve exit code; routes `--help`, `--version`, and the `complete` protocol |
| `module.cli.help(path?)` / `module.cli.complete(words)` | rendered help (usage, Arguments/Options with `[possible values: …]`, defaults, required markers, root Built-in row); completion candidates |
| `module.mcp.tools` / `module.mcp.serve()` | the MCP projection (stdio, `@modelcontextprotocol/sdk`) — tools carry `outputSchema` and `annotations`, calls return schema-conformant `structuredContent` (non-object outputs wrapped under `result`) |
| `module.spec` | the machine-readable self-description: a JSON-serializable tree of every command (path, aliases, examples, per-surface hiding, runnability, documented input/output JSON Schemas) and parameter (cli grammar, required/variadic/boolean, default value, env). Doc generators and UI generators consume this — never parse help text |

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

Completion runs on [`@bomb.sh/tab`](https://github.com/bombshell-dev/tab)
— the Cobra-protocol completion engine used by Cloudflare, Nuxt, Astro,
and Vitest. The compiled model projects into tab's registry, so the same
declaration answers zsh, bash, fish, and powershell:

```sh
# print an installable script for your shell
mesh complete zsh

# what the shell script calls back into (value, description, directive)
mesh complete -- snapshot --d
```

```
--depth	traversal depth
:4
```

Because the protocol re-invokes the bin, candidates are computed live:
literal values enumerate from ArkType unions (`"'patch' | 'minor'"`
tab-completes), `suggest: "folders" | "filepaths"` lists the working
directory at completion time, and a Fig-style generator —
`(ctx: SuggestContext) => Promise<string[]>` with `ctx.exec` available —
resolves real branch names or workspace manifests on demand. Generator
failures degrade to static candidates; completion never errors. Hoist
generators to consts with annotated parameters: an inline arrow is
context-sensitive and collapses the command's type inference.

tab also registers completion delegation for package managers, so a
locally-installed bin completes through `pnpm exec mesh <TAB>` without
being on `PATH`.

## CLI conventions

The argv grammar follows the conventions the wider ecosystem settled on
(the suite borrows citty's own test cases, including two citty cannot
pass):

```sh
mesh snapshot ./public --depth=4      # = syntax, long or short (-d=4)
mesh --verbose snapshot ./public      # flags are position-free; the
                                      #   subcommand path is positional
mesh snapshot ./public --verbose=off  # boolean literals: true/false,
                                      #   yes/no, on/off, 1/0
mesh build --no-minify src/a.ts       # --no-x negates any long boolean
MESH_DEPTH=4 mesh snapshot ./public   # argv > env > default, all three
                                      #   validated by the same token type
mesh run -- --help                    # after --, every token is a value
```

When a wrapped external's positional value itself starts with `-`, the
reconstructed argv fences it behind `--` so it reaches the binary as data
— argv injection into `git rev-parse` and friends is structurally off.

## CLI rendering

Human output follows the grep convention: string results print raw, arrays
of flat records print as aligned rows, everything else pretty JSON. Agents
never see this — MCP responses carry JSON text plus `structuredContent`.

## Program-level options

Root `input` declares options every command receives — handler, typed
call, schema, and spec alike, with argv accepting them on either side of
the subcommand. A root `narrow` travels with them, so an invariant over
program-level values holds wherever they are supplied. One inference
bound: a root `narrow` beside *bare* child handlers can trip TS2589
("excessively deep") — annotate those handlers' input parameter.

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
snapshot . -d 4`, `tsx examples/bin.ts mcp`).
