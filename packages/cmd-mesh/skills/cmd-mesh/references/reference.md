# Reference

The [README](../../../README.md) teaches the main workflow. This page lists the complete public contract.

## Module surface

| member | meaning |
| --- | --- |
| `module(input)` / `module.sub(input)` | the program itself: typed invocation, handler-synchronous (the argument is optional when every key is optional). A command whose input is ONE required parameter also takes that value bare — `git.commit("message")`. A plain-object value keeps only the record form, because the two would be ambiguous |
| `module.args` | compiled value-boundary ArkType surface (`assert`/`allows`/`toJsonSchema`) |
| `module.cmd.argv(input)` | externals only: the argv this command would emit, without spawning. The same reconstruction the spawn runs, so a test asserts the real tokens a wrapped binary receives |
| `module.main(argv?)` | the composed bin: head token `mcp` serves the MCP projection, `mcp install [client]` registers it with an editor, `mcp uninstall [client]` removes it again, anything else runs the CLI projection. Its help names those three rows; `cli.run()`'s does not, having no MCP surface. Bare `main()` reads process argv and owns the exit code — a complete `bin.ts` is `await mytool.main()`. A program whose own vocabulary needs the word `mcp` uses `cli.run()` as its bin instead |
| `module.cli.run(argv?)` | the CLI projection alone: parse, route, run, render, resolve exit code; routes `--help`, `--version`, and the `complete` protocol |
| `module.cli.help(path?)` / `module.cli.complete(words)` | rendered help (usage, Arguments/Options with `[possible values: …]`, defaults, required markers, root Built-in row); completion candidates |
| `module.cli.interactive(path?)` | guided invocation: prompts derived from the compiled model, dispatched through the ordinary cli path |
| `module.mcp.tools` | the projected tool list (name, description, schemas, annotations) |
| `module.mcp.serve()` | the stdio MCP server (`@modelcontextprotocol/sdk`). While serving, stdout is the transport, so `console.log`/`info`/`debug` from handlers are routed to stderr — a handler logs as it normally would without corrupting the stream. Resolves when the client disconnects, so the bin exits `0` |
| `module.mcp.server()` | the same server as a connectable instance for a caller-owned transport (an HTTP route, an in-memory test pair) |
| `module.spec` | the machine-readable self-description: a JSON-serializable tree of every command and parameter. Doc generators and UI generators consume this — never parse help text |

## Command fields

| field | meaning |
| --- | --- |
| `description` | one line, shown in help, tools, and prompts |
| `safety` | `"read"` (no side effects) · `"action"` (mutates) · `"destructive"` (hard to reverse). Projects to MCP `readOnlyHint`/`destructiveHint`, both always explicit; appears in the spec; verification probes may invoke only `read` |
| `input` | Parameter map. Values are ArkType definitions with optional surface metadata |
| `narrow` | cross-field invariant enforced on both boundaries |
| `output` | ArkType output contract → MCP `outputSchema` + `structuredContent` |
| `run` | The handler receives parsed canonical values and `ctx` |
| `commands` | Child commands. A mounted module nests under its key |
| `cli.alias` | alternative command names |
| `cli.examples` | invocation lines for the help Examples section |
| `cli.default` | child that runs when the group is invoked bare |
| `cli.hidden` / `mcp.hidden` | Per-surface omission. Parsing and validation still apply |
| `cli.render` | Human-only presentation. `--json` and MCP are unchanged |
| `mcp.server` | program level only: how a client should RUN the server — `env`, `toolTimeoutMs`, `startupTimeoutMs`, `eager` (connect at startup), `sandbox` (restrict filesystem and network), `prompts` (values the client asks for instead of reading from the environment, referenced from `env` as `${input:<id>}`). Declared once in these units and projected into each client's own spelling by `mcp install`; a client with no equivalent receives nothing for it |
| `mcp.name` | overrides the derived flattened tool name |
| `mcp.annotations` | Verbatim MCP tool annotations that override safety-derived hints |
| `mcp.examples` | `{ args, description? }[]`, validated at compile time and projected into tool descriptions, JSON Schema, and the specification |
| `successCodes` | external commands: exit codes that count as success |

## Parameters

A parameter IS an ArkType definition. `short: "boolean"` is a complete
parameter: the flag `--short` is derived from the key. Surface bindings
ride in ArkType metadata, through the `"@"` tuple, for what the type and
the key cannot express — a short alias, a positional slot, an env
fallback, a suggestion source.

```ts
input: {
  directory: ["string", "@", { cli: "<directory>", suggest: "folders" }],
  depth: [["string.integer.parse", "@", { cli: "--depth, -d" }], "=", "2"],
  "note?": "string"
}
```

A definition shared between commands comes from `type.module`, so the
parameter stays a plain ArkType definition:

```ts
const app = type.module({ Level: "'low' | 'high'" })
input: { level: [app.Level, "@", { cli: "--level" }] }
```

ArkType owns the domain, optionality, defaults and morphs. A key is
required unless it ends in `?` or carries a default. A variadic states
its own array (`"string[]"`), so the notation says only how it is
spelled. Defaults apply on the INPUT side: a morph's default is a value
its input domain accepts.

| metadata | meaning |
| --- | --- |
| `cli` | the argv notation, or `{ usage, env, hidden }` — env is the fallback (argv > env > default) |
| `mcp: { hidden }` | drop the parameter from the mcp tool schema; it still validates if supplied. The parameter must be optional or defaulted, or no agent can call the tool (CMSH1015) |
| `suggest` | `"folders"` · `"filepaths"` · a const generator `(ctx: SuggestContext) => Promise<string[]>` |
| `description` · `examples` · `deprecated` | ArkType's own metadata, read directly |

A `description` is ArkType's expected-value phrase. It renders as `<key> must be <description> (was …)`.
Write what a caller must send. Use `"a commit count"` so a failed call tells an agent how
to fix itself. `"limit to n commits"` becomes `count must be limit to n
commits`, which teaches nothing.

A numeric parameter takes a union, because its two boundaries carry
different types: argv only ever holds strings, while an agent sending
JSON sends a number.

```ts
depth: ["string.integer.parse | number.integer", "@", { cli: "--depth" }]
```

`--depth 2` parses through the morph, `{ "depth": 2 }` matches the
number branch, and both reach the handler as `2`. Declaring only the
morph rejects an agent's number; declaring only `number.integer`
rejects argv.

| notation | meaning |
| --- | --- |
| `"<name>"` | required positional |
| `"[name]"` | optional positional |
| `"[...name]"` / `"<...name>"` | variadic — pair with `"string[]"` or `"string[] >= 1"` |
| `"--flag, -f"` | flag with short alias |
| `"--tag <tags...>"` | repeatable flag — pair with `"string[]"` |
| omitted | derived `--kebab-case` flag; union members tab-complete |

Structured parameters take real objects on the value boundary and a JSON
token on the CLI, and project full nested JSON Schemas to MCP.

Because the declaration is ArkType's own, an unresolvable keyword, an
unknown metadata key, a misspelled `mcp.hidden`, or a value outside a
declared union is a TypeScript error at the declaration site. This holds
for `external()` as well as `program()`, including a nested subcommand's
own `input` and `output`.

## MCP surface

| item | meaning |
| --- | --- |
| tools | one per visible runnable command, name-collision-safe (`_2` suffixing) |
| resource `cmd-mesh://spec` | the complete spec descriptor as JSON |
| tool `<name>_spec` | the same descriptor for clients that only consume tools; a declared tool claiming the name wins |
| annotations | `readOnlyHint` and `destructiveHint`, both always explicit on every tool, derived from `safety` unless overridden. A command that declares no `safety` is treated as `action` — clients read an ABSENT `destructiveHint` as true, so an undeclared command would otherwise look destructive |
| `structuredContent` | schema-conformant; non-object outputs wrapped under `result` |
| undeclared arguments | dropped before the handler — an agent may send any key it invents, so a tool call carries only the parameters the command declares. The cli rejects an undeclared flag outright |

## Exit codes

| code | meaning |
| --- | --- |
| `0` | success |
| `2` | usage errors (unknown command/flag, missing value, invalid input) — the message appends the routed command's usage line and a `--help` pointer |
| `1` | runtime failures |
| `130` | guided invocation cancelled |
| handler-owned | throw an error carrying `exitCode` for report-style exits (`diff`'s 1, a linter's severity); the message prints bare |

## ctx

Every handler receives the capabilities for its current invocation:

```ts
run: async ({ packageName }, ctx) => {
  const root = ctx.workspace.workspaceRootDir()
  const current = ctx.project("<package_folder>")
  const manager = await current.findPackageManager()
  const result = await ctx.exec(manager.id, ["why", packageName], {
    cwd: root,
    preferLocal: true,
    stdin: "ignore",
    timeoutMs: 30_000,
    successCodes: [0]
  })

  return {
    packageName: current.packageName ?? "unknown",
    surface: ctx.surface,
    report: result.stdout
  }
}
```

| member | meaning |
| --- | --- |
| `ctx.definePackage` | Describe a package for typed dynamic import and optional install-on-missing behavior |
| `ctx.exec` | Spawn one child process through Effect's scoped process service |
| `ctx.findDependencyInPackageJson` | Find dependency entries across selected dependency groups in a supplied manifest |
| `ctx.findResolvedModulePath` | Resolve the first available module identifier from a candidate list |
| `ctx.getConfigFormat` | Infer a supported configuration format from a file extension |
| `ctx.getFolderByPackageName` | Find a workspace package directory from its manifest name |
| `ctx.getGitRootFolder` | Find the enclosing Git worktree root |
| `ctx.getPackageFolder` | Find the nearest package directory |
| `ctx.getPath` | Resolve package, workspace, Git, current-directory, or user-home paths |
| `ctx.getWorkspaceFolder` | Find the workspace root, with a Git-root fallback |
| `ctx.importMap` | Import a keyed module record and install missing described packages by default |
| `ctx.importer` | Import an ordered module tuple and install missing described packages by default |
| `ctx.isConfigFormat` | Test whether a string names a supported configuration format |
| `ctx.isDependencyInPackageJson` | Test a supplied manifest for a dependency in selected dependency groups |
| `ctx.isPackageDependency` | Test the nearest manifest for one or more dependencies |
| `ctx.isPackageModuleFound` | Test whether package resolution can find a package |
| `ctx.isWritable` | Test whether the process can write a path |
| `ctx.modifyConfig` | Edit JSON, JSONC, JSON5, YAML, or TOML in memory |
| `ctx.modifyConfigFile` | Edit a JSON, JSONC, JSON5, YAML, or TOML file |
| `ctx.modifyJSON` | Edit JSON or JSONC in memory while retaining untouched text |
| `ctx.modifyJSONFile` | Edit a JSON or JSONC file while retaining untouched text |
| `ctx.project` | Read one package and its package-manager capabilities |
| `ctx.readFile` | Read a text file and throw when it is absent |
| `ctx.readFileSafely` | Read a text file or return `undefined` when it is absent |
| `ctx.resolveConfigSource` | Parse or serialize a supported configuration source |
| `ctx.resolveModule` | Await a module and unwrap its default export when present |
| `ctx.resolveModulePath` | Resolve a module identifier or module-relative path |
| `ctx.resolvePackageModulePath` | Resolve a package through its manifest or public entry |
| `ctx.workspace` | Read the enclosing workspace and its packages |
| `ctx.writeFile` | Write a text file and create missing parent directories |
| `ctx.resources` | Access the resources acquired for this invocation |
| `ctx.surface` | Identify the entry path: `"call"`, `"cli"`, or `"mcp"` |

### File, path, and configuration operations

```ts
const packageFile = ctx.getPath("<package_folder>/package.json")
const source = ctx.readFile(packageFile)

ctx.writeFile("tmp/package-copy.json", source)

ctx.modifyJSONFile(packageFile, {
  "scripts.check": { value: "pnpm run typecheck && pnpm run test" }
})

const data = ctx.resolveConfigSource({ filepath: packageFile }, "data")
const format = ctx.getConfigFormat(packageFile)
```

`ctx.modifyJSON` and `ctx.modifyJSONFile` edit only the changed JSON or JSONC text. Comments, key order, and surrounding whitespace remain.

`ctx.modifyConfig` and `ctx.modifyConfigFile` use the same edit vocabulary for five formats. YAML and TOML edits parse and serialize the complete file, so comments do not remain.

Use the same functions outside a handler:

```ts
import { toolkit } from "cmd-mesh"

const text = toolkit.readFile("README.md")
toolkit.writeFile("tmp/README.md", text)
```

`toolkit` is the stateless part of `Ctx`. cmd-mesh spreads this object into every handler and suggestion context.

### Dependencies and dynamic modules

```ts
const declared = ctx.isPackageDependency(["typescript", "vitest"])
const installed = ctx.isPackageModuleFound("vitest")
const resolved = ctx.resolvePackageModulePath("vitest")

const [prettier] = await ctx.importer([
  ctx.definePackage({ name: "prettier", dev: true })
])

const modules = await ctx.importMap({
  prettier: ctx.definePackage({ name: "prettier", dev: true })
})
```

`isPackageDependency` examines the nearest package manifest. `isPackageModuleFound` examines module resolution. These answers can differ.

`importer` retains tuple order. `importMap` retains record keys. Both install missing described packages unless their options disable installation.

### `ctx.exec`

```ts
const result = await ctx.exec(bin, args, options)
```

The function returns:

```ts
interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}
```

| option | meaning |
| --- | --- |
| `cwd` | Run the child in this directory |
| `env` | Add or replace environment variables while retaining the parent environment |
| `stdio: "capture"` | Collect stdout and stderr in the result. This value is the default |
| `stdio: "inherit"` | Stream the child to the terminal. The result contains empty output strings |
| `stdin: "pipe"` | Keep the input pipe open. This value is the default |
| `stdin: "ignore"` | Give the child end-of-input immediately |
| `timeoutMs` | Stop the child after this duration and throw `ExecFailure` |
| `successCodes` | Throw `ExternalExit` when the exit code is outside this set |
| `preferLocal` | Prepend the workspace `node_modules/.bin` directory to `PATH` |

Without `successCodes`, every exit code is data. Inspect `result.exitCode` in the handler.

With `successCodes`, an exit code outside the set throws `ExternalExit`. A spawn or timeout error throws `ExecFailure`.

### `ctx.project`

```ts
const current = ctx.project("<package_folder>")
const byName = ctx.project({ packageName: "cmd-mesh" })
```

| member | meaning |
| --- | --- |
| `packageJson` | The package manifest read at construction time |
| `getPackageJson()` | Read the package manifest again |
| `packageJsonPath` | The absolute manifest path |
| `packageName` | The manifest name |
| `projectDir` | The absolute package directory |
| `findPackageManager()` | Find the active package manager |
| `detectPackageManagers()` | Find available package managers |
| `detectLockfilePackageManagers()` | Find package managers from lockfiles |
| `detectGlobalPackageManagers()` | Find package managers installed globally |
| `globalVersions()` | Read global package-manager versions |
| `mapPackageManagers()` | Apply one operation to the permitted package managers |
| `filterPackageManagers()` | Keep package managers that satisfy a predicate |
| `findDependencyInPackageJson()` | Find dependency entries and their dependency groups |
| `isDependencyInPackageJson()` | Test whether the manifest declares a dependency |
| `tsconfig.paths` | TypeScript path aliases from the package configuration |
| `gitignore.patterns` | Ignore patterns that apply to the package |
| `gitignore.data` | Parsed ignore data |

The package manager value owns install, remove, script, and command operations. Use it instead of spelling package-manager commands by hand.

### `ctx.workspace`

```ts
const root = ctx.workspace.workspaceRootDir()
const packages = ctx.workspace.packageList({ includeRoot: true })
const graph = ctx.workspace.packageGraph()
const names = ctx.workspace.packageNames()
const packageProject = ctx.workspace.getProject({ packageName: "cmd-mesh" })
```

| member | meaning |
| --- | --- |
| `workspaceRootDir()` | Return the workspace root, with the Git root as fallback |
| `packageList()` | Return package information as a list |
| `packageGraph()` | Return package information by package name |
| `packageNames()` | Return package names |
| `getProject()` | Return the same project interface as `ctx.project` |

### `ctx.resources` and `ctx.surface`

`ctx.resources` has the values from the program's `resources` declaration. The type follows the resource keys.

`ctx.surface` is `"call"`, `"cli"`, or `"mcp"`. Keep handler behavior independent of this value unless the entry path changes the required result.

## Argv conventions

```sh
mesh snapshot ./public --depth=4      # = syntax, long or short (-d=4)
mesh --verbose snapshot ./public      # flags are position-free
mesh snapshot ./public --verbose=off  # boolean literals: true/false, yes/no, on/off, 1/0
mesh build --no-minify src/a.ts       # --no-x negates any long boolean
MESH_DEPTH=4 mesh snapshot ./public   # argv > env > default, one token type validates all three
mesh run -- --help                    # after --, every token is a value
```

An external's positional value starting with `-` is fenced behind `--` in
the reconstructed argv, so argv injection into `git rev-parse` and
friends is structurally off.

## Failure classes

`InvalidInput`, `HandlerFailure`, `InvalidOutput`, `ExternalExit`,
`ExecFailure`, `CommandNotFound`, `UnknownFlag`, `MissingFlagValue`,
`UnexpectedArgument`, `NoRunnableCommand`, `InvalidDeclaration` — tagged
classes, catchable by type. Validation is eager and synchronous on every
surface; handler and output failures follow the handler's synchrony.
