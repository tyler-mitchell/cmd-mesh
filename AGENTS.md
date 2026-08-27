<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.

<!--VITE PLUS END-->

# Agent Workflow

## Shared branches

- Daily branch: `main`
- Bumpy base branch: `release`
- Generated version PR: `bumpy/version-packages`

The human owns the checked-out branch. Agents never create, switch, rename, delete,
reset, or replace branches unless the human explicitly requests that exact
operation. If a session starts on another branch, continue there and report the
difference; never “correct” it by switching.

## Daily changes

- Work and commit on the currently checked-out branch.
- Stage only files owned by the current task; preserve parallel agents’ changes.
- Inspect the index before committing. When another agent already staged files,
  use `git commit --only -- <task-owned paths>` and leave those staged entries
  untouched.
- If Git reports `index.lock`, wait for the other Git operation; never delete it.
- A request to `commit` authorizes a local commit only.
- A request to `push` authorizes pushing the currently checked-out branch and
  its complete unpushed commit set.
- Consumer-visible package changes include one maintained Bumpy bump file.
- Follow `node_modules/@varlock/bumpy/skills/add-change/SKILL.md` for bump level
  and changelog text.
- Do not create task-specific branches or worktrees.

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
2. Create or update the ordinary `main → release` pull
   request and merge it after required checks pass.
3. Run `pnpm run release:pr` once. If the PR is absent, return to useful work;
   GitHub owns the pending workflow.
4. When the PR exists, run
   `pnpm run release:merge` to queue it for auto-merge.
5. Return to useful work. GitHub owns publication and public verification.

If the version PR is behind `release`, run `pnpm run release:update`
once and let required checks rerun. Never loop over status checks.

Never version packages, edit generated changelogs, publish locally, dispatch
release workflows, poll CI, or read successful-job logs.

## Synchronization

After publication, synchronize `main` forward from
`release` only when the worktree is clean and no parallel agent has
uncommitted work. Never rebase or force-push shared commits, and never switch
branches to synchronize.

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
