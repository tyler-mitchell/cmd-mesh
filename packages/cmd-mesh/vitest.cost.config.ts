import { defineConfig } from "vitest/config"

// the cost measurement alone, with no other worker competing for cpu.
// a wall-clock budget is only meaningful when nothing else runs.
export default defineConfig({
  test: {
    include: ["tests/compile-cost.test.ts"],
    fileParallelism: false
  }
})
