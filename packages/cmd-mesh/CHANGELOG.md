# Changelog


## 0.2.0
<sub>2026-08-27</sub>

- *(minor)*
  Hardened the CLI grammar against a 220-test pressure suite and rebuilt shell completion on @bomb.sh/tab (zsh, bash, fish, powershell via the `complete` protocol, replacing `completion`/`__complete`). Bare `main()` is now a complete bin entry; flags are position-free; boolean flags accept =true/false/yes/no/on/off; external argv reconstruction fences flag-like positional values behind `--`.

## 0.1.0
<sub>2026-08-27</sub>

- *(minor)*
  Initial release: declarative program model with ArkType-typed inputs, direct invocation, CLI with shell completion, MCP server projection, and external binary wrapping.
