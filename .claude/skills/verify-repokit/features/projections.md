# Projections: MCP, guided invocation, completions

One declaration, three invocation styles beyond plain argv.

## Sub-features

`repokit mcp` (stdio MCP server; cli-hidden commands appear as tools,
mcp-hidden ones do not); bare `repokit` at a TTY opens guided
invocation (cancel exits 130; non-TTY prints usage); `repokit
complete <shell>` emits installable completion scripts.

## How to get to it (user POV)

`claude mcp add repokit -- node <path>/dist/bin.js mcp`; or just run
`repokit` with no arguments in a terminal.

## Driving it

```sh
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}\n' | node apps/repokit/dist/bin.js mcp | head -1
node apps/repokit/dist/bin.js complete zsh | head -3
```

## What proves it

The MCP drive returns one initialize result naming the server; the
completion script opens with a zsh compdef header. Guided invocation
needs a real TTY — the mocked-clack suite
(packages/cmd-mesh/tests/interactive.test.ts) is its witness layer;
do not fake a TTY here.

## Gotchas

The MCP probe leaves the server waiting on stdin after the reply —
pipe through `head -1` so the invocation terminates.
