# Operational contract (release, ci, deps)

The closed-distribution procedure as mounted repo-ops modules; root
package.json scripts delegate here, so the bin IS the contract.

## Sub-features

`release` add/check/status/push/pr/merge/update/registry-version/sync
plus `release promote pr|create|merge`; `ci`
list/watch/logs/rerun/cancel/dispatch; `deps` list/merge/close/sync.

## How to get to it (user POV)

`pnpm run release:status` (delegating script) or
`node apps/repokit/dist/bin.js release status` directly — both must
behave identically.

## Driving it

```sh
node apps/repokit/dist/bin.js release status
node apps/repokit/dist/bin.js release registry-version
node apps/repokit/dist/bin.js ci list
node apps/repokit/dist/bin.js deps list
```

## What proves it

`release status` emits bumpy's JSON even when nothing is pending
(bumpy exits 1 as a report; declared via successCodes);
`registry-version` prints the published cmd-mesh version;
`ci list` shows real workflow runs. All through the workspace-local
binaries resolved by preferLocal — a direct `node` invocation (no
pnpm PATH) is the stronger proof than a script invocation.

## Gotchas

Mutating commands (push, merge, dispatch) are real distribution
operations — drive them only inside an actual release, never as
verification probes.
