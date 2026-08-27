---
name: release-package
description: Record and release package changes through the repository's local Bumpy workflow.
---

# Release packages

For a consumer-visible package change, follow
`node_modules/@varlock/bumpy/skills/add-change/SKILL.md` and commit its bump file
with the implementation on the checked-out working branch.

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
