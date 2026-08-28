// cli entry point for the example program:
//   pnpm exec tsx examples/bin.ts snapshot ./public -d 4
//   pnpm exec tsx examples/bin.ts mcp        ← the same bin serves mcp
import { mesh } from "./mesh.js"

await mesh.main()
