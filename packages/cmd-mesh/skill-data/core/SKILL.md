---
name: cmd-mesh
description: Build typed command programs with cmd-mesh. One declaration produces typed functions, a full CLI (help, completion, guided prompts), and an MCP server. Use when writing a CLI, wrapping a binary like git as a typed surface, exposing commands to agents over MCP, or replacing hand-rolled argument parsing in TypeScript automation.
---

# cmd-mesh

One declaration, three surfaces: typed in-process calls, a real CLI, and an MCP server for agents.

## Declare once, use everywhere

```ts
import { program } from "cmd-mesh"

const app = program({
  name: "notes",
  version: "1.0.0",
  commands: {
    add: {
      description: "add a note",
      safety: "action",
      input: {
        text: { type: "string", description: "note body", cli: "<text>" },
        tag: { type: "string", cli: "--tag, -t" }
      },
      output: { id: "string" },
      run: (input) => ({ id: save(input.text, input.tag) })
    }
  }
})

const { id } = await app.add({ text: "ship it" })  // typed function call
await app.cli.run()                                 // argv CLI: notes add "ship it" -t work
await app.mcp.serve()                               // stdio MCP server for agents
app.spec                                            // the whole surface as one JSON descriptor
```

`input` keys are ArkType definitions; the `cli` binding decides positional (`<text>`) versus flag (`--tag, -t`). `run` receives parsed, canonical values — never raw strings.

A bare definition is a complete parameter — `input: { force: "boolean", tag: "string" }` derives the flags `--force` and `--tag`. Reach for the `{ type, cli }` descriptor only for what the key cannot express: a short alias, a positional slot, an env fallback, a suggestion source.

## Wrap a binary as a typed surface

```ts
import { external } from "cmd-mesh"

export const git = external({
  name: "git",
  description: "the git binary as a typed surface",
  commands: {
    status: {
      description: "working tree status",
      safety: "read",
      input: { short: { type: "boolean", cli: "--short, -s" } },
      output: "string"
    },
    commit: {
      description: "record a commit",
      safety: "action",
      input: {
        message: { type: "string", required: true, cli: "--message, -m" }
      },
      output: "string"
    }
  }
})

const out = await git.commit({ message: "fix: parser" })  // spawns `git commit -m "fix: parser"`
```

One file per program, one command per verb. A `git grep`-style exit 1 is declared with `successCodes: [0, 1]` on the command.

## Run processes from handlers

```ts
run: (_input, ctx) =>
  ctx.exec("gh", ["run", "list", "--limit", "10"], {
    preferLocal: true,        // resolve workspace node_modules/.bin first
    stdio: "inherit"          // stream to the terminal; omit to capture
  }).then((result) => result.stdout)
```

`ctx.exec` is the sanctioned process runner. Never import `node:child_process` in a handler.

## Safety is a contract, not metadata

```ts
safety: "read"         // no side effects — agents and verification may call freely
safety: "action"       // mutates state — call deliberately
safety: "destructive"  // hard to reverse — agent clients prompt before invoking
```

Safety projects to MCP annotations with both hints explicit, appears in `app.spec`, and marks what automated verification may invoke: verification probes call `read` commands only.

## Plan from the spec, not by probing

An agent connected over MCP reads the whole surface before calling anything:

- resource `cmd-mesh://spec` — the complete descriptor (schemas, safety, examples)
- tool `<name>_spec` — the same descriptor for clients that only consume tools

Declared examples travel with each tool:

```ts
mcp: {
  examples: [
    { args: { text: "ship it", tag: "work" }, description: "a tagged note" }
  ]
}
```

Examples are schema-validated at compile time — a lying example is a declaration error.

## Compose programs by mounting

```ts
import { ci } from "repo-ops"

const kit = program({
  name: "kit",
  commands: {
    ci,                       // mounts the whole program as a subtree: kit ci list
    hello: { run: () => "hi" }
  }
})
```

Mounting nests under the key, so tool and command names can never collide.

## Serve MCP over your own transport

```ts
const server = app.mcp.server()   // a connectable @modelcontextprotocol/sdk Server
await server.connect(myTransport) // HTTP route, in-memory test pair, anything
```

`app.mcp.serve()` is the stdio production path; `app.mcp.server()` hands the same server to a caller-owned transport.

## Bare invocation is guided

Running the CLI with no arguments at a terminal opens interactive guided invocation (prompts derived from the same declaration). No extra code.
