# repokit

The `cmd-mesh` dogfood: real repository operations declared once,
consumed as a CLI, an MCP server, and a typed library. Handlers are written
the way a consumer writes them — plain async functions over the promise
surface, no Effect — because exercising the published contract is the point.

```sh
pnpm --filter repokit dev -- search "pattern" -g "packages/**/*.ts"
pnpm --filter repokit dev -- todos --assignee tyler
pnpm --filter repokit dev -- release patch --dry-run
pnpm --filter repokit dev -- completion zsh   # installable tab completion
pnpm --filter repokit dev -- mcp              # the same bin as an MCP server
```

Commands: `check <filter>` runs a package script with live streamed output
(`stdio: "inherit"` + `timeoutMs`); `search` and `todos` run
`git grep --untracked` anchored at the repository toplevel (structured `{file, line, text}` results — rendered as
grep-style rows for humans, `structuredContent` for agents); `context`
(cli-hidden, agents only) reports branch/commits/dirty state; `release`
(mcp-hidden, humans only) bumps a manifest version with `--dry-run`
planning and enum-completed `<bump>`.

Build a real bin with `pnpm --filter repokit build` → `dist/bin.js`
(`repokit` via the package `bin` field). Claude registration:
`claude mcp add repokit -- node <path>/dist/bin.js mcp`.

Design notes fed back into core from building this: leading `--` tolerance
in argv (pnpm forwards args that way), `ctx.exec` cwd anchoring
(`ExecOptions.cwd`), `git grep` exit-code semantics (1 = no match) as the
reason `ctx.exec` reports exit codes instead of throwing, grep-row CLI
rendering, and enum-driven completion.
