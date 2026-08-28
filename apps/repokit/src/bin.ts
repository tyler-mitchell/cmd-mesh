#!/usr/bin/env node
// the one installed bin: cli for humans, `repokit mcp` for agents
import { repokit } from "./repokit.js"

await repokit.main()
