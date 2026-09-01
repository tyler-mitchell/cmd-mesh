import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // the cost measurement runs alone through test:cost — wall clock
    // under parallel workers is noise. See tests/compile-cost.test.ts.
    exclude: ["tests/compile-cost.test.ts", "**/node_modules/**"]
    // no dep inlining: transforming the dependency's dist instantiates a
    // second copy of its internals beside the real one
  }
})
