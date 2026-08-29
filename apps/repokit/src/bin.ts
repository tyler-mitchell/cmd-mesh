#!/usr/bin/env node
// the one installed bin: `repokit mcp` serves agents, arguments run the
// cli, and a bare invocation at a terminal opens guided invocation
import { repokit } from "./repokit.js"

const argv = process.argv.slice(2)
if (argv.length === 0 && process.stdin.isTTY === true) {
  process.exitCode = await repokit.cli.interactive()
} else {
  await repokit.main()
}
