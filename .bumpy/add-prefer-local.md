---
cmd-mesh: minor
---

Added ExecOptions.preferLocal: prepend the enclosing workspace's node_modules/.bin to PATH so workspace-local binaries resolve regardless of how the process was started; a no-op outside any repository.
