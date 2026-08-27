---
cmd-mesh: minor
---

Hardened the CLI grammar against a 220-test pressure suite and rebuilt shell completion on @bomb.sh/tab (zsh, bash, fish, powershell via the `complete` protocol, replacing `completion`/`__complete`). Bare `main()` is now a complete bin entry; flags are position-free; boolean flags accept =true/false/yes/no/on/off; external argv reconstruction fences flag-like positional values behind `--`.
