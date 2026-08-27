# Pressure findings

The suites in `tests/pressure-*.test.ts` drive the package the way a consumer
does — a deployer, a task runner, a passthrough wrapper, a wrapped binary —
and assert the behavior the contract promises. 28 of those assertions fail
against the current interpreter. Each one below names the invocation, the
observed result, and the line that produces it.

Counts at the time of writing: 153 tests, 125 passing, 28 failing. The 45
pre-existing tests all still pass.

## Critical

### 1 · Mounted program modules are silently dropped

```ts
const cache = program({ name: "cache", commands: { clear: { run: () => ({ cleared: true }) } } })
const host = program({ name: "host", commands: { cache } })

await host.cache.clear()   // TypeError: host.cache.clear is not a function
host.mcp.tools             // []
```

`isMounted` (`src/compile.ts:288`) guards with `Predicate.isObject`, which is
`typeof x === "object"` — false for a function. `program()` returns a callable
module (`src/module.ts:161`), so the marker is never seen and the child is
compiled as an ordinary declaration with no `input`, no `run`, and no
`commands`. `external()` returns a plain object, which is why mounting a
binary works and mounting a program does not.

`tests/pressure-lifecycle.test.ts` proves the marker itself is present, so the
fault is the guard, not the module.

This also disables the escape hatch the README prescribes for the one-level
inline inference limit: "the fix is to mount a subprogram".

### 2 · Environment fallback never reaches the handler

```sh
MESH_PORT=4444 mesh serve ./public     # port is 3000
```

`applyEnv` (`src/argv.ts:165`) reads through `Config.option(Config.string(...))`
and discards every failure with `Effect.orElseSucceed(() => acc)`. The lookup
does not resolve from `process.env` under the module's runtime, so the fallback
silently produces nothing for every parameter that declares `cli.env`.

The existing test at `tests/public.test.ts:96` sets `MESH_PORT` and asserts
only `main(...) === 0`, which holds whether or not the variable is read. The
feature has been dead behind a passing assertion.

### 3 · A short-only boolean flag clears itself

```sh
deploy push api -w      # watch === false
```

`flagTable` derives the negation token as
`String.replace("--", "--no-")(name)` (`src/argv.ts:54`). A flag declared
`cli: "-w"` has no `--`, so the negation key is `-w` — the flag's own token.
`scan` consults negations before the flag table (`src/argv.ts:128`), so the
flag's own spelling sets it to `false`.

Long-form flags are unaffected: `-f` works because its primary name is
`--force` and the negation is `--no-force`.

## High

### 4 · A declared `--no-*` flag loses to another flag's derived negation

```sh
bake run web --no-cache    # noCache === false, cache === false
```

`--cache` derives `--no-cache`; the separately declared `--no-cache` parameter
never receives the token. `commandIssues` (`src/compile.ts:154`) checks only
flag-table collisions, so the declaration compiles clean.

### 5 · `--flag=value` is rejected for booleans

```sh
deploy push api --force=false   # exit 1: force must be boolean (was "false")
```

The `=` branch (`src/argv.ts:112`) stores the raw string before the boolean
branch is reached, and the token type for a boolean is `boolean` with a
`false` default (`src/compile.ts:259`).

### 6 · A boolean with an ArkType default stops binding by presence

```ts
quiet: { type: "boolean = false", cli: "--quiet, -q" }
```

```sh
bake run web --quiet    # exit 1: flag --quiet expects a value
```

`isBoolean` is computed as `inner.extends("boolean")` (`src/compile.ts:219`).
For a defaulted definition `inner` is the default wrapper, the check is false,
and the parameter becomes value-taking.

### 7 · Reserved tokens are matched by value anywhere in argv

```sh
deploy push api -m --json          # prints help-free JSON; message is lost
deploy push api -m --help          # prints help
wrap exec node -- --help --json    # forwards neither
deploy --json push api             # exit 1: unexpected argument "push"
```

`hasHelpToken` (`src/argv.ts:182`) scans every token including flag values and
everything after `--`. `--json` is detected and filtered by equality across the
whole remaining token list (`src/argv.ts:221`). A passthrough wrapper cannot
forward `--help` to the tool it wraps, and a release note cannot contain the
text `--json`.

The pre-subcommand case fails differently: `--json` is stripped, then `push` is
scanned at the root, which declares no positionals.

### 8 · Reserved subcommands hijack a root positional

```sh
tasks mcp           # serves MCP instead of running the task named "mcp"
tasks completion    # prints a zsh script
tasks __complete    # prints completion candidates
```

`routeArgv` (`src/argv.ts:195`) tests `Array.head(argv)` against `mcp`,
`__complete`, and `completion`, guarding only on `root.children` — never on
`root.parameters`. `__complete` has no guard at all.

### 9 · `main()` rejects instead of resolving to an exit code

```ts
await fragile.main(["badRender"])   // rejects: Error: render exploded
await fragile.main(["badNarrow", "x"])  // rejects: Error: narrow exploded
```

`Effect.catch` (`src/module.ts:129`) handles the typed error channel. A throw
inside `cli.render` (`src/module.ts:121`) or inside a `narrow` predicate —
which runs in ArkType traversal under `parseWith`'s `Effect.suspend`
(`src/invoke.ts:16`) — is a defect and escapes to `runtime.runPromise`. The
declared signature is `main(argv): Promise<number>`; a host that awaits it for
an exit status gets an unhandled rejection.

Handler throws and rejections are caught correctly; only the presentation and
predicate hooks escape.

### 10 · MCP tool names collide silently

```ts
commands: {
  cache_clear: { run: () => ({ via: "flat" }) },
  cache: { commands: { clear: { run: () => ({ via: "nested" }) } } }
}
```

Both flatten to `app_cache_clear` (`src/mcp.ts:20`). `mcp.tools` lists the name
twice and `serveMcp`'s `Record.fromEntries` (`src/mcp.ts:126`) keeps whichever
came last, so one command becomes unreachable and the choice is invisible.

### 11 · External command keys are not kebab-cased for the binary

```ts
external({ name: "git", commands: { revParse: { input: { rev: { cli: "<rev>" } } } } })
```

```
git: 'revParse' is not a git command.
```

`compileExternalCommand` (`src/compile.ts:389`) uses `childName` verbatim as
the argv token. Derived flag names kebab-case (`src/compile.ts:108`); command
names do not. The only spelling that reaches the binary correctly is
`"rev-parse"`, which forfeits dot access on the module.

## Medium

### 12 · Nested unknown subcommands report the wrong error

```sh
deploy config shwo
# UnexpectedArgument: unexpected argument "shwo"
# expected: unknown command "shwo" — did you mean show?
```

The `CommandNotFound` guard (`src/argv.ts:223`) fires only when the routed
command is the root. Every deeper group falls through to positional scanning.
Root-level typos and flag typos both produce correct suggestions.

### 13 · `required: true` is ignored on boolean flags

```ts
yes: { type: "boolean", required: true, cli: "--yes" }
```

```sh
deploy rollback api --to r1   # exit 0, confirmed: false
```

Both entry builders take the `isBoolean && !defaulted` branch before any
requiredness handling (`src/compile.ts:259`, `src/compile.ts:272`). A
confirmation gate silently defaults to unconfirmed. Either enforce it or
reject the combination at declaration time.

### 14 · Declared MCP annotations never reach `mcp.tools`

`McpTool` (`src/types.ts:250`) has no `annotations` field, and `module.ts:171`
projects only `t.tool`. Annotations do reach a served `ListTools` response
(`src/mcp.ts:136`), so the projection and the server disagree about what a tool
is.

### 15 · Externals cannot express options that precede the subcommand

```sh
git -C /repo status --short     # unexpressible
```

`ExternalDecl` (`src/types.ts:213`) has no root `input`, and the compiled
external root carries `parameters: []` (`src/compile.ts:407`). Declaring the
option on the subcommand produces `git status -C /repo --short`, which git
rejects with exit 129.

Flag/positional order within a subcommand follows declaration order, so
declaring flags before positionals produces correct argv — worth documenting,
since the wrong order is silent until the binary complains.

### 16 · External declaration validation stops at the first broken command

Two malformed commands in one `external()` report only the first. Each child
calls `compileCommand`, which throws its own aggregate immediately
(`src/compile.ts:383`), so sibling issues never accumulate. `program()`
aggregates correctly across its whole tree.

### 17 · `external()` has no way to release its runtime

`external()` allocates a `ManagedRuntime` (`src/module.ts:192`) and returns an
object with no `dispose`. A long-lived host leaks one runtime per external
module. `program()` exposes `dispose()`.

## Low

### 18 · A command with no result prints `undefined`

`renderResult(undefined)` returns the value `undefined` from
`JSON.stringify` (`src/render.ts:144`), which `Console.log` prints as the word.

### 19 · Completion offers options after `--`

`candidatesFor` (`src/completion.ts:125`) never interprets the end-of-options
separator, so `deploy push api -- -<TAB>` still offers `--force`.

### 20 · `help(path)` silently falls back to the parent

`helpFor` (`src/module.ts:153`) resolves an unknown segment with
`Option.getOrElse(() => cmd)`, so `help(["config", "nope"])` returns the help
for `config`. A consumer building a help UI cannot distinguish a typo from a
hit.

## Notes on behavior that held

- Token and value boundaries agree on defaults, parsed integers, enums,
  long-form booleans, variadics, and structured JSON-token parameters.
- `narrow` and output contracts are enforced identically on both boundaries.
- Concurrency is clean: 50 parallel command invocations and 12 parallel child
  processes stay independent.
- A megabyte of child stdout is captured without truncation; `timeoutMs` kills
  the child; `cwd` is honored; a nonzero exit is reported rather than thrown.
- `cli.env` is deliberately absent from the value boundary — direct and MCP
  calls do not consult the environment. That asymmetry is pinned by a passing
  test; finding 2 is about the CLI path, where it is advertised and dead.
