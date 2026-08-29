---
name: repo-ops
description: Drive a repository's release procedure, CI runs, dependabot PRs, and git through typed repo-ops commands instead of raw shell. Use when releasing with Bumpy, watching or rerunning CI, merging dependency PRs, verifying a published package, or running git status/log/diff/add/commit/push/pull in a repository that mounts repo-ops (repokit and siblings).
---

# repo-ops

The closed-distribution repository operations as mountable cmd-mesh
programs: one declaration each for the Bumpy release procedure, CI
runs, dependabot PRs, and the git binary.

## Mount and call

```ts
import { repositoryOperations } from "repo-ops"

const { release, ci, deps, git } = repositoryOperations({ package: "cmd-mesh" })

const status = await git.status({ short: true })      // typed external call
await ci.list({})                                     // recent workflow runs
```

Mounted into a program, the same declarations become CLI subcommands
and MCP tools:

```ts
const kit = program({ name: "kit", commands: { release, ci, deps, git } })
// kit release status · kit ci list · kit deps merge 42 · kit git status -s
```

## The release procedure

```sh
kit release check              # every changed package has a bump (read)
kit release status             # pending bumps and planned versions (read)
kit release push               # push the daily branch (action)
kit release pr                 # show the open version PR (read)
kit release merge              # queue the version PR squash merge (action)
kit release registry-version   # published version on npm (read)
kit release preflight --probe scripts/verify-published.mjs
                               # pack + prove the tarball installs and runs (read)
kit release verify --probe scripts/verify-published.mjs
                               # prove the PUBLISHED version installs, runs,
                               # carries npm provenance, has a GitHub Release (read)
kit release promote pr|create|merge   # the main → release promotion PR
```

`release add` is interactive and cli-only. `release status` treats
bumpy's exit 1 (nothing pending) as a report, not a failure.

## Safety is declared on every operation

```ts
safety: "read"    // list, status, logs, pr, registry-version, preflight, verify,
                  // git status/log/diff — agents and verification call freely
safety: "action"  // merge, push, rerun, cancel, dispatch, sync,
                  // git add/commit/push/pull — call deliberately
```

Verification probes call only `read` operations. The MCP projection
carries both hints explicitly on every tool.

## Streams are cli-only

`ci watch`, `ci logs`, and `release add` stream to the terminal
(`stdio: inherit`) and are `mcp: { hidden: true }` — streaming would
corrupt the MCP transport. Agents use `ci list` and the read
operations instead.

## Every process run resolves workspace binaries

Handlers run through `ctx.exec` with `preferLocal: true` and the
workspace root as cwd, so `bumpy`, `gh`, and package binaries resolve
from `node_modules/.bin` regardless of how the process started.
