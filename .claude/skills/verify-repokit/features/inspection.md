# Inspection commands

Read-only repository views: `search` (git grep, structured rows),
`todos` (TODO/FIXME collection), `packages` (workspace list via
ctx.workspace), `context` (cli-hidden agent orientation).

## Sub-features

Glob narrowing (`search -g`), assignee filter (`todos -a`),
`--json` machine output on every command.

## How to get to it (user POV)

`repokit search <pattern>`, `repokit todos`, `repokit packages`;
`context` only over MCP or typed calls.

## Driving it

```sh
node apps/repokit/dist/bin.js packages
node apps/repokit/dist/bin.js search "repositoryOperations" -g "packages/**/*.ts"
node apps/repokit/dist/bin.js todos
```

## What proves it

`packages` lists cmd-mesh, repo-ops, repokit with
relative dirs; `search` returns file:line rows from real tracked files;
exit 0. Empty search results exit 0 with no rows (grep exit-1
semantics are declared, not failures).

## Gotchas

`search` requires the positional pattern — bare `repokit search` is a
usage error, exit 2 (that itself is a routing proof).
