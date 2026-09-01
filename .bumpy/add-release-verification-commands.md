---
repo-ops: minor
---

The release program gained `preflight` (pack the package and prove the tarball installs and runs from a scratch consumer) and `verify` (prove the published version installs, runs, carries npm provenance, and has a GitHub Release), both `safety: "read"` with an optional `--probe` module. The repository's standalone verification scripts are replaced by these commands.
