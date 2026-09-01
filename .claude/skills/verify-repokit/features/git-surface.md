# Git as a typed external surface

`repo-ops/src/git.ts` declares the git binary once; it projects as
`repokit git <cmd>` on the CLI, `repokit.git.<cmd>()` typed calls, and
MCP tools.

## Sub-features

status, log, diff, add, commit (required -m), push, pull — the curated
daily vocabulary; anything beyond it is a ctx.exec call site detail.

## How to get to it (user POV)

`repokit git status --short`, `repokit git log --oneline -n 3`; typed:
`await repokit.git.commit({ message: "..." })`.

## Driving it

```sh
node apps/repokit/dist/bin.js git status --short
node apps/repokit/dist/bin.js git log --oneline -n 3
```

## What proves it

Output matches the real `git` output for this repository; argv
reconstruction (flags before positionals, repeated flags per value) is
pinned in packages/cmd-mesh/tests/external.test.ts.

## Gotchas

`git commit`/`push` mutate the repository — reserve for real work.
`git add` takes variadic positionals; an empty call is a usage error.
