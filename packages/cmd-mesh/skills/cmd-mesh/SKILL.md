---
name: cmd-mesh
description: Build, extend, test, or review TypeScript command programs with cmd-mesh. Use when the user says to use cmd-mesh, needs a typed CLI, wraps a binary, exposes typed functions as commands, or replaces custom argument parsing. Create a CLI by default. Use the MCP projection only when the user explicitly asks for MCP, agent tools, or MCP client registration.
license: MIT
compatibility: Requires Node.js 22 or later and TypeScript.
metadata:
  package: cmd-mesh
---

# cmd-mesh

Build one typed program. Derive direct function calls, a CLI, and a machine-readable specification from that program.

Create a CLI by default. Do not start an MCP server or change an MCP client configuration unless the user explicitly requests MCP.

## Start with one complete program

Create `src/docs.ts`:

```ts
import { program } from "cmd-mesh"

export const docs = program({
  name: "docs",
  version: "1.0.0",
  commands: {
    excerpt: {
      description: "read the first lines of a text file",
      safety: "read",
      input: {
        file: [
          "string",
          "@",
          {
            description: "an existing text file",
            suggest: "filepaths",
            cli: "<file>"
          }
        ],
        lines: [
          [
            "string.integer.parse | number.integer",
            "@",
            {
              description: "a positive line count",
              cli: "--lines, -n"
            }
          ],
          "=",
          "20"
        ]
      },
      output: {
        file: "string",
        excerpt: "string"
      },
      run: ({ file, lines }, ctx) => ({
        file,
        excerpt: ctx.readFile(file).split("\n").slice(0, lines).join("\n")
      })
    }
  }
})
```

Create `src/bin.ts`:

```ts
import { docs } from "./docs.js"

await docs.main() // Runs the CLI. MCP starts only for an explicit `docs mcp` invocation.
```

Add the binary to `package.json`:

```json
{
  "bin": {
    "docs": "./dist/bin.js"
  }
}
```

The generated command forms are:

```sh
docs excerpt README.md --lines 12
docs --help
```

The same declaration gives typed calls and specification data:

```ts
const result = docs.excerpt({ file: "README.md", lines: 12 })
docs.spec
```

## Use ArkType definitions directly

Each `input` or `output` value is an ArkType definition. Put CLI and MCP bindings in ArkType metadata with the `"@"` tuple.

```ts
input: {
  verbose: "boolean",
  file: ["string", "@", { cli: "<file>", suggest: "filepaths" }],
  format: [["'json' | 'text'", "@", { cli: "--format, -f" }], "=", "text"],
  count: [["string.integer.parse | number.integer", "@", { cli: "--count" }], "=", "10"],
  "label?": ["string", "@", { cli: "--label" }]
}
```

Use these rules:

- Use a bare ArkType definition when the key can define the flag.
- Use `"<name>"` for a required positional value.
- Use `"[name]"` for an optional positional value.
- Use `"<...names>"` with an array definition for a required variadic value.
- Use `"[...names]"` with an array definition for an optional variadic value.
- Use `string.integer.parse | number.integer` for a number that arrives from CLI text or MCP JSON.
- Put defaults in ArkType's native `[definition, "=", value]` tuple. The value must match the input side of a morph.
- Do not create a second parameter descriptor model.

## Declare safety and output

Give each runnable command a safety class:

```ts
safety: "read"         // No side effects.
safety: "action"       // Changes state.
safety: "destructive"  // A reversal is difficult.
```

Declare an `output` contract for structured results. MCP uses it as `outputSchema`, and direct calls keep the inferred result type.

## Wrap an existing binary

Use `external()` when another executable owns the behavior:

```ts
import { external } from "cmd-mesh"

export const git = external({
  name: "git",
  commands: {
    status: {
      description: "show working tree status",
      safety: "read",
      input: {
        short: [["boolean", "@", { cli: "--short, -s" }], "=", false],
        "pathspec?": ["string[]", "@", { cli: "[...pathspec]" }]
      },
      output: "string"
    },
    commit: {
      description: "record staged changes",
      safety: "action",
      input: {
        message: ["string", "@", { cli: "--message, -m" }]
      },
      output: "string"
    }
  }
})

const status = await git.status({ short: true })
```

Keep one external program in one file. Declare `successCodes` when the binary uses a nonzero exit code as a valid result.

For a large binary, generate a draft and then curate it:

```sh
repokit external draft git --out src/git.ts
repokit external draft git remote --depth 2 --out src/git.ts
```

The generator cannot infer safety. Set `safety`, narrow generated string types, and remove commands that the application does not need.

## Run a process from a handler

Use `ctx.exec`. Do not import `node:child_process`.

```ts
run: async ({ pattern }, ctx) => {
  const result = await ctx.exec("rg", [pattern], {
    preferLocal: true,
    successCodes: [0, 1]
  })

  return { matches: result.stdout.split("\n").filter(Boolean) }
}
```

Omit `successCodes` when the handler must inspect `exitCode` as data. Use `stdio: "inherit"` only for terminal streaming.

## Use the handler context

`ctx` contains the interpreter-owned capabilities for one invocation:

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

Use all context members from their owning boundary:

- Use `ctx.exec` for child processes. It returns `stdout`, `stderr`, and `exitCode`.
- Use `ctx.getPath` for package, workspace, Git, current-directory, and user-home paths.
- Use the focused folder helpers when only a package, workspace, Git, or named-package root is needed.
- Use `ctx.readFile`, `ctx.readFileSafely`, and `ctx.writeFile` for text files.
- Use `ctx.modifyJSON` and `ctx.modifyJSONFile` for comment-preserving JSON or JSONC edits.
- Use `ctx.resolveConfigSource`, `ctx.modifyConfig`, and `ctx.modifyConfigFile` for JSON, JSONC, JSON5, YAML, or TOML.
- Use `ctx.getConfigFormat` and `ctx.isWritable` for file capability checks.
- Use the dependency predicates to distinguish a declared dependency from an installed module.
- Use `ctx.importer` or `ctx.importMap` with `ctx.definePackage` for typed import and optional install-on-missing behavior.
- Use the module resolvers to locate packages or candidate module identifiers without importing them.
- Use `ctx.project(source)` for one package manifest, package manager, TypeScript paths, and ignore patterns.
- Use `ctx.workspace` for the workspace root, package list, package graph, package names, and project lookup.
- Use `ctx.resources` for resources declared on the program.
- Use `ctx.surface` only when behavior must differ between `"call"`, `"cli"`, and `"mcp"`.

Read `references/reference.md#ctx` before adding a custom process, package, or workspace helper.

Use the same stateless operations outside a handler through one import:

```ts
import { toolkit } from "cmd-mesh"

const source = toolkit.readFile("package.json")
toolkit.writeFile("tmp/report.txt", source)
toolkit.modifyJSONFile("tsconfig.json", {
  "compilerOptions.strict": { value: true }
})

const modules = await toolkit.importMap({
  prettier: toolkit.definePackage({ name: "prettier", dev: true })
})
```

`toolkit` is the object that cmd-mesh spreads into `Ctx`. A direct import and a handler use the same function implementations.

## Compose programs and resources

Mount a complete program under one command key:

```ts
import { program } from "cmd-mesh"
import { git } from "./git.js"

export const repository = program({
  name: "repository",
  commands: {
    git,
    health: {
      description: "report repository health",
      safety: "read",
      output: { ok: "boolean" },
      run: () => ({ ok: true })
    }
  }
})
```

Declare shared resources at the program root:

```ts
const service = program({
  name: "service",
  resources: {
    db: {
      acquire: () => openDatabase(),
      release: (db) => db.close()
    }
  },
  commands: {
    count: {
      description: "count records",
      safety: "read",
      output: "number",
      run: (_input, ctx) => ctx.resources.db.count()
    }
  }
})
```

cmd-mesh acquires resources before each handler and releases them in reverse order after success or failure.

## Add MCP only when the user requests it

Do not run `docs mcp`, `docs mcp install`, or `docs mcp install --dev` during ordinary CLI work.

Before an MCP call, read `cmd-mesh://spec` or call `<program>_spec`. The specification includes schemas, safety, examples, and the command tree.

Add `mcp.examples` only when the arguments pass the command input schema. Hide a command with `mcp: { hidden: true }` when agents must not call it.

```ts
mcp: {
  examples: [
    {
      args: { file: "README.md", lines: 12 },
      description: "read the start of the project README"
    }
  ]
}
```

Use the built-in client registration:

```sh
docs mcp install
docs mcp install codex
docs mcp uninstall codex
```

Use `module.mcp.server()` only when the application owns a transport other than stdio.

## Test the program at its real seams

Call the typed function for handler behavior:

```ts
import { expect, it } from "vitest"
import { docs } from "../src/docs.js"

it("reads the requested line count", () => {
  expect(docs.excerpt({ file: "README.md", lines: 2 }).excerpt).toContain("cmd-mesh")
})
```

Use `cli.run(argv)` for CLI parsing and routing. It returns an exit code and does not call `process.exit`.

Spread `toolkit` into a hand-built `Ctx` fake:

```ts
import { toolkit } from "cmd-mesh"
import type { Ctx } from "cmd-mesh"

const fake: Ctx = {
  ...toolkit,
  surface: "call",
  resources: {},
  exec: async () => ({ stdout: "", stderr: "", exitCode: 0 })
}
```

Use an in-memory MCP transport only when the MCP projection itself needs a test. Do not route every handler test through CLI or MCP.

## Read detailed references only when needed

- Read `references/reference.md` for every field, parameter form, exit code, and `ctx` member.
- Read `references/errors.md` when a declaration reports `CMSH1xxx`.
- Inspect `module.spec` for the compiled contract. Do not parse help text.

Prefer the direct `program()`, `external()`, `ctx.exec`, mounting, resource, and MCP affordances shown here. Do not add parallel argument parsers, process wrappers, or schema models.
