---
name: verify-repokit
description: Drive the real repokit bin (CLI and MCP) to prove repository-surface behavior with captured evidence. Use before claiming any repokit or repo-ops change works, and whenever a verification of the operational surface is needed.
---

# Verify repokit

repokit is this repository's operational command surface: a cmd-mesh
program projected as a CLI bin, an MCP server, and typed functions.
Proving a change means driving the built bin, not the test suite alone.

## Launch

There is no server to keep alive; build once, then each drive is one
invocation:

```sh
pnpm --filter repo-ops run build && pnpm --filter repokit run build
```

Ready when both `tsc` runs exit 0.

## Doctor

One read-only check that the instance is worth driving:

```sh
node apps/repokit/dist/bin.js --help
```

Healthy: exit 0 and the command list shows `search`, `todos`,
`packages`, `check`, `ci`, `release`, `deps`, `git`. If `release` or
`git` are missing, repo-ops did not build or link.

## Drive

Real commands against the real repository, from the repo root:

```sh
node apps/repokit/dist/bin.js packages
node apps/repokit/dist/bin.js search "repositoryOperations" -g "packages/**/*.ts"
node apps/repokit/dist/bin.js git status --short
node apps/repokit/dist/bin.js release status
node apps/repokit/dist/bin.js ci list
```

`release status` proves the workspace-local `bumpy` resolves through
preferLocal (exit 1 from bumpy with nothing pending is a report, not a
failure — the JSON on stdout is the proof). For the MCP surface:

```sh
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}\n' | node apps/repokit/dist/bin.js mcp | head -1
```

Healthy: one JSON-RPC result naming the server.

## Evidence

Capture stdout and exit codes into `docs/audit/verify-evidence/`
(gitignored with the rest of docs/audit): one file per drive, named
`<command>-<date>.txt`. A proof exercises the real user path — the
built bin — never internal functions; the vitest suites are the deeper
layer, not a substitute for a bin drive.

## Cleanup

Nothing to tear down; drives are single invocations. Evidence files
stay — cleanup never removes proof.

## Feature map

`features/` holds one file per user-facing feature; its README is the
index. A proof that drives one convenient entry point is incomplete
when the map lists others.
