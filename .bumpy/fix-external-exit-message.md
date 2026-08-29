---
cmd-mesh: patch
---

An `ExternalExit` from a streamed command no longer ends in a dangling colon. A child run with `stdio: "inherit"` writes its own stderr to the terminal, so the captured text is empty and the message read `pnpm exited with 1:` with nothing after it. Captured stderr is also trimmed now.
