# Agent Workflow

## Autonomous operation

When an autonomous mission is active (an advance gate, a goal, or an
explicit self-drive instruction), the agent holds standing decision
authority in this repository. Releases, publishes, deletions and
demolitions, dependency changes, API and contract changes, new
packages, and roadmap additions are the agent's own decisions under
the mission. The agent waits ONLY on: spending money beyond
established tooling, repositories or accounts the user explicitly
marked hands-off, and destruction of data that exists nowhere else.
Writing "awaiting your ruling" or requesting permission for work
outside that reserved list is a named failure. Deference is churn;
asking is idling.

The work queue is `docs/internal/backlog.md`: the top unblocked item is
always the next work. When the queue is empty, derive the next
functional item from the repository's state, append it, and begin it.
Producing substantially the same completion or holding statement two
turns in a row is prohibited; a prior turn's own "this is blocked"
classification is never evidence — re-derive from the repository.

## Shared branches

- Daily branch: `main`
- Bumpy base branch: `release`
- Generated version PR: `bumpy/version-packages`

The human owns the checked-out branch. Agents never create, switch, rename, delete,
reset, or replace branches unless the human explicitly requests that exact
operation. If a session starts on another branch, continue there and report the
difference; never “correct” it by switching.

## Closed distribution commands

Every CI, repository setup, branch promotion, release, trust, publication,
verification, and recovery operation uses a named root `package.json` script,
invoked bare (`pnpm run <script>` plus the script's own arguments) — never
piped, grepped, wrapped, timed out, fed input, or looped. Never run the
underlying `gh`, `bumpy`, `fledgling`, `npm`, or distribution-related `git`
command directly, and never improvise a shell pipeline, watcher, wrapper, or
alternate command. If the required operation has no script, stop before
performing it and repair the project command contract first. Never assert
that the user must perform a step: the agent runs everything, and a genuinely
blocked command is reported as the specific gate (a login prompt or a runtime
permission), not converted into a user task. Read-only Git inspection and
local commits remain ordinary development actions.

## Daily changes

- Work and commit on the currently checked-out branch.
- Stage only files owned by the current task; preserve parallel agents’ changes.
- Inspect the index before committing. When another agent already staged files,
  use `git commit --only -- <task-owned paths>` and leave those staged entries
  untouched.
- If Git reports `index.lock`, wait for the other Git operation; never delete it.
- A request to `commit` authorizes a local commit only.
- A request to `push` authorizes pushing the currently checked-out branch and
  its complete unpushed commit set through the applicable named script.
- Consumer-visible package changes include one maintained Bumpy bump file.
- Follow `node_modules/@varlock/bumpy/skills/add-change/SKILL.md` for bump level
  and changelog text.
- Do not create task-specific branches or worktrees.

## Bump lifecycle

Bumps are authored during change development, never reconstructed just before
release. The first consumer-visible commit for a logical change creates one
bump file through `pnpm run release:add -- ...`; later commits for that same
change update the same file. An unrelated logical change gets its own bump
file.

Commit the implementation, tests, generated consumer docs, and bump file
together. Use patch for compatible fixes, minor for compatible capabilities,
and major for breaking public contracts. Name only directly changed packages;
Bumpy owns fixed-group and dependency propagation. Root shared changes name
every affected public package explicitly. Internal changes that require a
version but no changelog use `$changelog: false` through the bundled add-change
guidance.

Before every commit, decide whether the task-owned diff changes published
behavior, API, runtime dependencies, executables, generated artifacts, or
consumer documentation. If it does, the bump belongs in that commit. A release
request consumes pending bump files; it never creates them retroactively.

Before pushing the daily branch, report every commit not yet on
`origin/main`. Bump files accumulate there; pushing it does not
invoke Bumpy's release workflow.

If the push is rejected because the remote advanced, never force-push or rebase.
When the worktree is clean and no parallel agent has uncommitted work, merge
`origin/main` into the checked-out daily branch, then push once.

## Release

Only an explicit `release` request authorizes integrating the daily branch into
the Bumpy base branch and merging the generated version PR.

1. If intended commits remain local, perform the normal push flow.
2. Run `pnpm run release:push`.
3. Run `pnpm run release:promote:pr` once. If absent, run
   `pnpm run release:promote:create` once.
4. Run `pnpm run release:promote:merge` once. It queues a merge commit so the
   long-lived branches retain shared ancestry. Return to useful work.
5. After GitHub reports that merge, run `pnpm run release:pr` once. If absent,
   return to useful work; GitHub owns the pending workflow.
6. When the version PR exists, run `pnpm run release:merge` once. It queues the
   generated PR for squash auto-merge.
7. Return to useful work. GitHub owns publication and public verification.

If the version PR is behind `release`, run `pnpm run release:update`
once and let required checks rerun. Never loop over status checks.

Never version packages, edit generated changelogs, publish locally, dispatch
release workflows, poll CI, or read successful-job logs.

## Synchronization

After publication, synchronize `main` forward from
`release` only when the worktree is clean and no parallel agent has
uncommitted work. Run `pnpm run release:sync`, then
`pnpm run release:sync:push`. When `release:sync` refuses because history
diverged (normal after the squash-merged version PR when the working branch
advanced), run `pnpm run release:sync:merge`, then `release:sync:push`.
Never rebase, force-push, or switch branches to synchronize.

Complete that synchronization before the next daily change and confirm Bumpy's
consumed bump files are absent. Address review findings in code; resolve the
thread only after the correction makes it outdated.

# Command Mesh implementation rules

Binding for every agent implementing in this repository.

## Effect TS praxis

- All internal implementation code is Effect TS v4 (the `effect` package, v4
  line), 100%. This is praxis, not preference: consistency and precedent for
  every agent that works here — especially lower-reasoning ones — outrank
  local simplicity. "Plain JS would be simpler here" is never a valid reason
  to deviate.
- No raw JavaScript control flow or builtins in implementation code: no
  `for`/`while` loops, no `Array.prototype` methods (`map`, `filter`,
  `reduce`, ...), no `Object.keys`/`values`/`entries`, no `Promise.*`, no
  `try`/`catch`, no `switch` or nested ternaries. Use the Effect equivalents —
  `Array`, `Record`, `Struct`, `Iterable`, `String`, `Option`, `Result`,
  `Match`, `Predicate`, `Function`, `Effect.forEach`, `Effect.try`,
  `Effect.tryPromise`. There is ALWAYS an Effect means; find it before
  writing a line.
- Write Effect code with `Effect.gen` and `Effect.fn("name")` (never
  functions returning `Effect.gen`). Services via `Context.Service` with
  static layers; composition via `Layer.provide`/`provideMerge`; errors as
  tagged errors handled with `Effect.catchTag`/`catchTags`.
- Survey Effect's module surface before building anything; never hand-roll
  what an Effect module already provides. Consider commonly overlooked
  modules (`Graph`, `Match`, `Trie`, `Chunk`, `PubSub`, `Stream`) when the
  shape fits. Authoritative docs: the Effect repo's `ai-docs` / `LLMS.md`.
- Consumers are NEVER required to use Effect. Every public surface speaks
  plain values and Promises; `ManagedRuntime` bridges at the boundary.
  Effect types must not leak into public signatures.
- Schema and validation are ArkType, not Effect Schema. Effect Schema is not
  used for domain or consumer data, ever. Internal tagged errors use the
  non-Schema error constructors (`Data.TaggedError`).
- Process execution goes through `effect/unstable/process` (`ChildProcess` +
  `ChildProcessSpawner`), never `node:child_process` directly.

## Attaching repokit's MCP for development

Attach repokit by running its SOURCE entrypoint under `mcp-reloader`, so
an edit is one `reload` call away instead of a host restart:

```jsonc
// .mcp.json — gitignored: it carries this machine's own absolute paths
{
  "mcpServers": {
    "repokit": {
      "command": "<repo>/node_modules/.bin/mcp-reloader",
      "args": ["--cwd", "<repo>/apps/repokit",
               "--", "node", "--import", "tsx",
               "--conditions=development", "src/bin.ts", "mcp"]
    }
  }
}
```

The backend's tools surface unchanged and one extra tool appears:
`reload`. After editing any of repokit, repo-ops or cmd-mesh, call
`reload`, then call the tools normally — the connection stays up.

`reload` swaps the implementation behind the tools a session already
has. ADDING a command is different: the reload reports it in
`toolsAdded` and the backend serves it, but a client attached before it
existed cannot call it — measured 2026-08-30, the call answered "No
such tool available". Editing is one `reload`; a new command still
needs a restart.

No `--build` is passed, because the launch line already runs source.

`--conditions=development` is what makes that reach the OTHER packages.
cmd-mesh and repo-ops each declare a `development` export condition
pointing at `src`, so under that flag repokit imports their source
rather than their `dist`. Without it only repokit's own edits land, and
a cmd-mesh change stays invisible until every package downstream of it
rebuilds — the dist tripwire. The condition is inert for published
consumers, who never pass the flag.

`--cwd` is repokit's own directory so `tsx` resolves from there, and the
backend after `--` must be a direct executable — `mcp-reloader` cannot
wrap an `npm`/shell wrapper. Call `reload` only when the server is idle;
it re-spawns the backend, so a call in flight fails.

Recreate the file with `node apps/repokit/dist/bin.js mcp install claude`
for the plain (non-reloading) form, then edit in the wrapper.
