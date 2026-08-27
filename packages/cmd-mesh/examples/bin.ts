// cli entry point for the example program:
//   pnpm exec tsx examples/bin.ts serve ./public -p 8080
//   pnpm exec tsx examples/bin.ts mcp        ← the same bin is the mcp server
import { mesh } from "./mesh.js"

await mesh.main()
