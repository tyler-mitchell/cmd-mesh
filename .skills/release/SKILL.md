---
name: release-package
description: Record and release package changes through the repository's local Bumpy workflow.
---

# Release packages

Use only the repository's named root scripts for every release operation.
Never run their underlying `gh`, `bumpy`, `npm`, `fledgling`, or `git` commands
directly. A missing command is a project setup defect and must be added before
release continues.

For a consumer-visible package change, follow
`node_modules/@varlock/bumpy/skills/add-change/SKILL.md` and commit its bump file
with the implementation on the checked-out working branch. Pushing the working
branch only accumulates bump files; Bumpy creates or updates
`bumpy/version-packages` when the promotion merge reaches the base branch, and
nothing publishes until that generated PR merges.

An explicit release request authorizes this exact sequence:

```sh
pnpm run release:push
pnpm run release:promote:pr
pnpm run release:promote:create # only when the previous command found no PR
pnpm run release:promote:merge
```

Return to useful work. After GitHub reports the promotion merge:

```sh
pnpm run release:pr
pnpm run release:merge
```

Run `release:merge` only when `release:pr` returned the version PR. Required
checks gate both merges. GitHub owns publication and public verification. After
publication, on the clean working branch run `release:sync` and
`release:sync:push`. Inspect workflows only after failure. Never version,
publish, dispatch, or poll locally.
