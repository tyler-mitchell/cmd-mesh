#!/usr/bin/env node
// the one installed bin: cli for humans, `repokit mcp` for agents
import { repokit } from "./repokit.js"

process.exitCode = await repokit.main(process.argv.slice(2))
await repokit.dispose()
