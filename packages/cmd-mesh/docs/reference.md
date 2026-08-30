# Reference

Lookup tables for the whole surface. The [README](../README.md) teaches;
this page lists.

## Module surface

| member | meaning |
| --- | --- |
| `module(input)` / `module.sub(input)` | the program itself: typed invocation, handler-synchronous (the argument is optional when every key is optional). A command whose input is ONE required parameter also takes that value bare — `git.commit("message")`. A plain-object value keeps only the record form, because the two would be ambiguous |
| `module.args` | compiled value-boundary ArkType surface (`assert`/`allows`/`toJsonSchema`) |
| `module.cmd.argv(input)` | externals only: the argv this command would emit, without spawning. The same reconstruction the spawn runs, so a test asserts the real tokens a wrapped binary receives |
| `module.main(argv?)` | the composed bin: head token `mcp` serves the MCP projection, `mcp install [client]` registers it with an editor, anything else runs the CLI projection. Its help names those two rows; `cli.run()`'s does not, having no MCP surface. Bare `main()` reads process argv and owns the exit code — a complete `bin.ts` is `await mytool.main()`. A program whose own vocabulary needs the word `mcp` uses `cli.run()` as its bin instead |
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
| `mcp.server` | program level only: how a client should RUN the server — `env`, `toolTimeoutMs`, `startupTimeoutMs`, `eager` (connect at startup), `sandbox` (restrict filesystem and network). Declared once in these units and projected into each client's own spelling by `mcp install`; a client with no equivalent receives nothing for it |
| `mcp.name` | overrides the derived flattened tool name |
| `mcp.annotations` | verbatim MCP tool annotations; win over safety-derived hints |
| `mcp.examples` | `{ args, description? }[]` — schema-validated at compile time; projected into the tool description, JSON-Schema `examples`, and the spec |
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
  depth: ["string.integer.parse", "@", { cli: "--depth, -d", default: "2" }],
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
| `description` · `examples` · `default` · `deprecated` | ArkType's own metadata, read directly |

A `description` is ArkType's EXPECTED-value phrase, not a docstring: it
renders as `<key> must be <description> (was …)`. Write what a caller
should send — `"a commit count"` — so a failed call tells an agent how
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

| member | meaning |
| --- | --- |
| `ctx.exec(bin, args, options?)` | Effect process spawner behind a promise. Options: `cwd`, `env`, `timeoutMs`, `stdio: "inherit"`, `stdin: "ignore"` (the child sees end-of-input at once, instead of waiting on a pipe nothing writes to), `successCodes`, `preferLocal` (prepend the workspace `node_modules/.bin`; a no-op outside a repository) |
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
