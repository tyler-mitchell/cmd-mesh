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

## Safety hints and the spec projection

Every command declares `safety`; the MCP tools carry BOTH hints as
explicit booleans (`readOnlyHint`, `destructiveHint`) — an absent
destructiveHint reads as destructive to clients, so absence is a
defect. The server also serves the whole surface as resource
`cmd-mesh://spec` plus a paired `repokit_spec` read tool.

```sh
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node apps/repokit/dist/bin.js mcp | tail -1
```

Proof: every tool's `annotations` object carries both hint keys;
read-only operations (`search`, `ci_list`, `git_status`,
`release_status`) show `readOnlyHint: true`; the list includes
`repokit_spec` with `readOnlyHint: true`.

## Gotchas

The MCP probe leaves the server waiting on stdin after the reply —
pipe through `head -1` (or `tail -1` for a second request) so the
invocation terminates. Verification probes may invoke only
`safety: "read"` commands.
