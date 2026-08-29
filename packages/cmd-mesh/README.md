# `cmd-mesh`

Declare a command program once and get four surfaces from the one
declaration: plain typed functions, a full CLI, an MCP server for
agents, and a machine-readable spec. External binaries wrap into the
same model.

```ts
import { external, program } from "cmd-mesh"

const git = external({
  name: "git",
  commands: {
    status: {
      description: "working tree status",
      safety: "read",
      input: { short: ["boolean", "@", { cli: "--short, -s", default: false }] },
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
      safety: "action",
      input: {
        // a parameter IS an ArkType definition; surface bindings ride in
        // its metadata, so ArkType owns the domain, optionality and defaults
        directory: ["string", "@", { suggest: "folders", cli: "<directory>" }],
        depth: [
          "string.integer.parse",
          "@",
          { cli: { usage: "--depth, -d", env: "MESH_DEPTH" }, default: "2" }
        ],
        verbose: ["boolean", "@", { cli: "--verbose, -v", default: false }]
      },
      run: (input) => ({ snapped: input.directory, depth: input.depth })
      //     ^ inferred: { directory: string; depth: number; verbose: boolean }
    },
    git // a module mounts by reference — nesting mechanism for programs too
  }
})
```

The typed functions ARE the program; every other surface is a
projection:

```ts
mesh.snapshot({ directory: "./public" })  // the program itself: a sync handler
                                          //   is a sync function — no promise
mesh.snapshot("./public")                 // one required parameter takes its
                                          //   value bare

// bin.ts — the complete entry point; the word `mcp` serves agents,
// everything else is the cli. one line, zero plumbing.
await mesh.main()

// claude mcp config: { "command": "mesh-bin", "args": ["mcp"] }
//   → tools mesh_snapshot, mesh_git_status with ArkType-projected JSON Schemas

mesh.spec  // the whole surface as one JSON descriptor — doc generators
           //   and UIs consume this, never help text
```

A parameter is an ArkType definition. `verbose: "boolean"` is complete on
its own — the flag `--verbose` comes from the key. The `{ type, cli }`
form above adds what a key cannot express: a short alias, a positional
slot, an env fallback, a suggestion source.

The complete lookup tables — every command field, parameter form, ctx
member, exit code, and argv convention — live in
[docs/reference.md](./docs/reference.md). The package ships an agent
skill at `skill-data/core/SKILL.md`; agents discover usage from the
installed tarball.

## Safety is a contract

```ts
safety: "read"         // no side effects — agents and verification call freely
safety: "action"       // mutates state — call deliberately
safety: "destructive"  // hard to reverse — agent clients prompt first
```

Safety validates at compile time, appears in the spec, and projects to
MCP `readOnlyHint`/`destructiveHint` with both hints always explicit —
clients treat an absent `destructiveHint` as true, so partial hints
would read as destructive. Verification probes invoke only `read`
commands.

## Agents plan from the spec

The MCP projection serves the spec both ways: resource `cmd-mesh://spec`
and a paired `<name>_spec` tool for clients that only consume tools.
Declared examples travel with each tool and are schema-validated at
compile time — a lying example is a declaration error:

```ts
mcp: {
  examples: [
    { args: { directory: "./public", depth: 4 }, description: "a bounded snapshot" }
  ]
}
```

## Installing the server in a client

A cmd-mesh program is a stdio server: the bin plus the argument `mcp`.
`mcp install` registers it, keeping everything the config already holds:

```sh
mesh mcp install           # the client this project already uses
mesh mcp install codex     # or name one
```

| client | file | key |
| --- | --- | --- |
| Claude Code | `.mcp.json` | `mcpServers` |
| Cursor | `.cursor/mcp.json` | `mcpServers` |
| VSCode | `.vscode/mcp.json` | `servers`, and the entry names `type: "stdio"` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |
| Codex | `~/.codex/config.toml` | `mcp_servers` |

Bare `mcp install` only ever picks a client whose config lives in this
project. Windsurf and Codex keep theirs in your home directory, so they
are named outright rather than detected — a project command should not
edit settings outside the project on its own.

Before wiring a client, run the server by hand — `mesh mcp` reads
JSON-RPC on stdin, and closing stdin exits `0`. A client that starts
the bin and later closes it leaves no orphan process.

Serve stdio in production, or hand the same server to your own
transport:

```ts
await mesh.mcp.serve()                  // stdio

const server = mesh.mcp.server()        // @modelcontextprotocol/sdk Server
await server.connect(myTransport)       // HTTP route, in-memory test pair
```

## Program resources

Declared acquire/release pairs run around every handler invocation on
all three surfaces — acquired before the handler, typed on
`ctx.resources`, released in reverse order whether the handler succeeds
or throws:

```ts
const tool = program({
  name: "tool",
  resources: {
    db: {
      acquire: () => openDb(),
      release: (db) => db.close()
    }
  },
  commands: {
    stats: {
      safety: "read",
      output: "number",
      run: (_input, ctx) => ctx.resources.db.count()
    }
  }
})
```

## Running processes

```ts
// report mode (default): exit codes are data — branch on them.
const probe = await ctx.exec("which", [candidate])
if (probe.exitCode === 0) return probe.stdout.trim()

// succeed-or-throw: declare the success set; any other exit throws
// ExternalExit with the child's stderr. NEVER hand-roll this wrapper.
await ctx.exec("pnpm", ["run", "build"], { cwd, stdio: "inherit", successCodes: [0] })

// workspace-local binaries resolve regardless of how the process started
await ctx.exec("vitest", ["run"], { preferLocal: true })
```

`ctx.project` and `ctx.workspace` are
[`package-management`](https://npmjs.com/package/package-management)'s
own consumer surfaces, exposed whole — repository questions without
spawning and parsing:

```ts
run: async (input, ctx) => {
  const self = ctx.project("<package_folder>")   // manifest, mtime-cached
  self.packageJson.version
  const pm = await self.findPackageManager()      // lockfile-detected
  await pm.installPackage(["left-pad"])           // injection-guarded, batched
}
```

The same library's path-anchored utilities re-export from `cmd-mesh`
directly for use outside any invocation:

```ts
import { getPath, modifyJSONFile } from "cmd-mesh"

getPath("<workspace_folder>/node_modules/.bin")   // absolute local-bin path
modifyJSONFile("tsconfig.json", { "compilerOptions.strict": { value: true } })
//   ^ comment-preserving JSONC edits, dot paths, sequential-edit safe
```

## Testing a mesh program

The typed functions are the test seam — call them directly, no argv, no
process, no capture machinery:

```ts
expect(tool.dev({ entry: "src/main.ts" })).toEqual({ url: "http://localhost:3000" })
expect(() => tool.dev({ entry: "x", out: "x" })).toThrow(/distinct output/)
```

`cli.run(argv)` is pure toward the process — it returns the exit code
and never calls `process.exit`. A handler is a plain function and `Ctx`
is structural, so hoist it and test against a hand-built ctx:

```ts
import type { Ctx } from "cmd-mesh"

const list = async (input: { readonly dir: string }, ctx: Ctx) => {
  const result = await ctx.exec("git", ["ls-files", input.dir])
  return { files: result.stdout.split("\n").filter(Boolean) }
}
// in the declaration: run: list
// in the test: await list({ dir: "src" }, { surface: "call", exec: fakeExec })
```

The MCP surface tests the same way over an in-memory pair:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await tool.mcp.server().connect(serverTransport)
const client = new Client({ name: "test", version: "0.0.0" })
await client.connect(clientTransport)
await client.callTool({ name: "tool_stats", arguments: {} })
```

## The two boundaries

Each command compiles to two ArkType types:

- **token boundary** (`argv`): CLI strings in, values out — morphs parse
  (`string.integer.parse`), ArkType input-side defaults apply
  (`= '2'`), booleans come from flag presence/`--no-x` negation.
- **value boundary** (direct calls and MCP): canonical values in
  (`depth: 4`), defaults evaluated through their morphs at compile time,
  same command-level `narrow` cross-field invariants.

Both feed the same handler. `module.args` exposes the value-boundary
type (`assert`/`allows`/`toJsonSchema`).

## Synchrony

A sync handler compiles to a sync function; only a handler that returns
a promise compiles to an async one — the return type tells you which.
Input validation is eager and synchronous on every surface. Failures are
exported tagged classes (`InvalidInput`, `HandlerFailure`,
`InvalidOutput`, `ExternalExit`, …), catchable by type.

## Declaration validation

`program()`/`external()` validate the whole declaration at compile time
and throw one `InvalidDeclaration` listing every problem with its
command/parameter path — unparsable ArkType defs, flag collisions,
variadic positionals that aren't last, unknown safety values, examples
that fail their own schema:

```
invalid declaration:
  tool broken · bad: ParseError: 'not.a.keyword' is unresolvable
  tool broken: flag --same is claimed by flag and other
```

## Guided invocation

`cli.interactive(path?)` walks the same compiled model as prompts:
select a command, answer one typed prompt per parameter — each prompt
validated by the parameter's own token morph, so a prompt can never
accept what the parser would reject — preview the equivalent command
line, dispatch through the ordinary cli path. A bin that wants bare
terminal invocations to open it routes them itself:

```ts
const argv = process.argv.slice(2)
if (argv.length === 0 && process.stdin.isTTY === true) {
  process.exitCode = await tool.cli.interactive()
} else {
  await tool.main()
}
```

## Shell completion

Completion runs on [`@bomb.sh/tab`](https://github.com/bombshell-dev/tab)
— the Cobra-protocol engine used by Cloudflare, Nuxt, Astro, and
Vitest. The same declaration answers zsh, bash, fish, and powershell:

```sh
mesh complete zsh              # print an installable script
mesh complete -- snapshot --d  # what the shell calls back into
```

Candidates are computed live: ArkType unions enumerate, `suggest:
"folders" | "filepaths"` lists the working directory, and a declared
generator resolves real branch names on demand. Generator failures
degrade to static candidates; completion never errors.

## Internals

- Effect TS v4 throughout. Nothing Effect-shaped leaks: the public
  surface is plain values and Promises via `ManagedRuntime`.
- Process execution is `effect/unstable/process`
  (`ChildProcessSpawner`): scoped interruption-safe children, streamed
  output, typed exit codes.
- Validation is ArkType only. Errors are `Data.TaggedError` classes.

## Validation

```sh
pnpm --filter cmd-mesh run typecheck
pnpm --filter cmd-mesh run test        # vitest: public surface + interpreter internals
pnpm --filter cmd-mesh run test:types  # @ark/attest inference proofs
```

[examples/demo.ts](./examples/demo.ts) drives every surface for real;
[examples/bin.ts](./examples/bin.ts) is a working bin (`tsx examples/bin.ts
snapshot . -d 4`, `tsx examples/bin.ts mcp`).
