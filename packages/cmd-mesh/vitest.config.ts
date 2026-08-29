import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // no dep inlining: transforming the dependency's dist instantiates a
    // second copy of its internals beside the real one
  }
})
