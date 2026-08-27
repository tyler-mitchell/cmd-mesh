---
name: release-package
description: Record and release package changes through the repository's local Bumpy workflow.
---

# Release packages

For a consumer-visible package change, follow
`node_modules/@varlock/bumpy/skills/add-change/SKILL.md` and commit its bump file
with the implementation on the human-owned base branch. Pushing that branch makes
Bumpy create or update `bumpy/version-packages`; it does not publish.

An explicit release request authorizes:

```sh
pnpm run release:merge
```

The command enables auto-merge; required checks gate the merge. Return to useful
work. GitHub owns publication and public verification. Inspect the workflow only
when GitHub reports failure. Never version, publish, dispatch, or poll locally.
