# Reference

Lookup tables for the whole surface. The [README](../README.md) teaches;
this page lists.

## Module surface

| member | meaning |
| --- | --- |
| `module(input)` / `module.sub(input)` | the program itself: typed invocation, handler-synchronous (the argument is optional when every key is optional) |
| `module.args` | compiled value-boundary ArkType surface (`assert`/`allows`/`toJsonSchema`) |
| `module.main(argv?)` | the composed bin: head token `mcp` serves the MCP projection, anything else runs the CLI projection. Bare `main()` reads process argv and owns the exit code — a complete `bin.ts` is `await mytool.main()`. A program whose own vocabulary needs the word `mcp` uses `cli.run()` as its bin instead |
| `module.cli.run(argv?)` | the CLI projection alone: parse, route, run, render, resolve exit code; routes `--help`, `--version`, and the `complete` protocol |
| `module.cli.help(path?)` / `module.cli.complete(words)` | rendered help (usage, Arguments/Options with `[possible values: …]`, defaults, required markers, root Built-in row); completion candidates |
| `module.cli.interactive(path?)` | guided invocation: prompts derived from the compiled model, dispatched through the ordinary cli path |
| `module.mcp.tools` | the projected tool list (name, description, schemas, annotations) |
| `module.mcp.serve()` | the stdio MCP server (`@modelcontextprotocol/sdk`) |
| `module.mcp.server()` | the same server as a connectable instance for a caller-owned transport (an HTTP route, an in-memory test pair) |
| `module.spec` | the machine-readable self-description: a JSON-serializable tree of every command and parameter. Doc generators and UI generators consume this — never parse help text |

## Command fields

| field | meaning |
| --- | --- |
| `description` | one line, shown in help, tools, and prompts |
| `safety` | `"read"` (no side effects) · `"action"` (mutates) · `"destructive"` (hard to reverse). Projects to MCP `readOnlyHint`/`destructiveHint`, both always explicit; appears in the spec; verification probes may invoke only `read` |
| `input` | parameter map; keys are ArkType definitions or descriptors |
| `narrow` | cross-field invariant enforced on both boundaries |
| `output` | ArkType output contract → MCP `outputSchema` + `structuredContent` |
| `run` | the handler; receives parsed canonical values and `ctx` |
| `commands` | child commands; a mounted module nests under its key |
| `cli.alias` | alternative command names |
| `cli.examples` | invocation lines for the help Examples section |
| `cli.default` | child that runs when the group is invoked bare |
| `cli.hidden` / `mcp.hidden` | per-surface omission; parsing and validation still apply |
| `cli.render` | human-only presentation; `--json` and MCP unaffected |
| `mcp.name` | overrides the derived flattened tool name |
| `mcp.annotations` | verbatim MCP tool annotations; win over safety-derived hints |
| `mcp.examples` | `{ args, description? }[]` — schema-validated at compile time; projected into the tool description, JSON-Schema `examples`, and the spec |
| `successCodes` | external commands: exit codes that count as success |

## Parameter descriptors

A parameter is an ArkType definition, or a descriptor that adds
surface configuration to one. `short: "boolean"` is a complete
parameter: the flag `--short` is derived from the key. Use the
descriptor form only for what the key cannot express — a short alias, a
positional slot, an env fallback, a suggestion source.

| form | meaning |
| --- | --- |
| `"boolean"` · `"string.integer.parse = '2'"` | the whole parameter; the flag is derived `--kebab-case` from the key |
| `"<name>"` | required positional |
| `"[name]"` | optional positional |
| `"[...name]"` / `"<...name>"` | variadic (zero ok / at least one) |
| `"--flag, -f"` | flag with short alias |
| `"--tag <tags...>"` | repeatable flag → array |
| `cli: { usage, env, hidden }` | object form: usage plus env fallback (argv > env > default) and per-surface hiding |
| `suggest` | `"folders"` · `"filepaths"` · a const generator `(ctx: SuggestContext) => Promise<string[]>` |
| `mcp: { hidden }` | drop the parameter from the mcp tool schema; it still validates if supplied. The parameter must be optional or defaulted, or no agent can call the tool (CMSH1015) |
| no `cli` | derived `--flag`; union members tab-complete |

A parameter's `type` is any ArkType definition. Structured parameters
take real objects on the value boundary and a JSON token on the CLI, and
project full nested JSON Schemas to MCP.

## MCP surface

| item | meaning |
| --- | --- |
| tools | one per visible runnable command, name-collision-safe (`_2` suffixing) |
| resource `cmd-mesh://spec` | the complete spec descriptor as JSON |
| tool `<name>_spec` | the same descriptor for clients that only consume tools; a declared tool claiming the name wins |
| annotations | `readOnlyHint` and `destructiveHint`, both always explicit, derived from `safety` unless overridden |
| `structuredContent` | schema-conformant; non-object outputs wrapped under `result` |

## Exit codes

| code | meaning |
| --- | --- |
| `0` | success |
| `2` | usage errors (unknown command/flag, missing value, invalid input) — the message appends the routed command's usage line and a `--help` pointer |
| `1` | runtime failures |
| `130` | guided invocation cancelled |
| handler-owned | throw an error carrying `exitCode` for report-style exits (`diff`'s 1, a linter's severity); the message prints bare |

## ctx

| member | meaning |
| --- | --- |
| `ctx.exec(bin, args, options?)` | Effect process spawner behind a promise. Options: `cwd`, `env`, `timeoutMs`, `stdio: "inherit"`, `successCodes`, `preferLocal` (prepend the workspace `node_modules/.bin`; a no-op outside a repository) |
| `ctx.project` / `ctx.workspace` | `package-management`'s consumer surfaces, whole |
| `ctx.resources` | acquired program resources, typed from the declaration |
| `ctx.surface` | `"call"` · `"cli"` · `"mcp"` |

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
