import { describe, expect, it } from "vitest"
import { program } from "../src/index.js"

// The lazy-subcommand-loading deferral hinges on one number: what a
// program() call actually costs at realistic scale. ArkType compiles
// two types per command (token and value boundary) at declaration time,
// which is the whole motivation anyone would have for lazy loading.
// This measurement decides the deferral with evidence instead of vibes.

const command = (n: number) => ({
  description: `command ${n}`,
  input: {
    entry: { type: "string", cli: "<entry>" },
    port: { type: "string.integer.parse = '3000'", cli: { usage: "--port, -p", env: `X_${n}_PORT` } },
    level: { type: "'debug' | 'info' | 'warn' = 'info'" },
    tags: { type: "string", cli: "--tag <tags...>" },
    verbose: { type: "boolean", cli: "--verbose, -v" }
  },
  output: { url: "string", tags: "string[]" },
  run: (input: { entry: string; port: number; tags: string[] }) => ({
    url: input.entry,
    tags: input.tags
  })
})

const declare = (size: number) =>
  program({
    name: `bench${size}`,
    version: "0.0.0",
    description: "compile-cost subject",
    commands: Object.fromEntries(
      Array.from({ length: size }, (_, n) => [`cmd${n}`, command(n)])
    )
  })

describe("declaration compile cost", () => {
  it("stays interactive at CLI scale (50 five-parameter commands)", () => {
    const started = performance.now()
    const compiled = declare(50)
    const elapsed = performance.now() - started
    expect(Object.keys(compiled.cli).length).toBeGreaterThan(0)
    // Solo measurement: ~2.5ms per command (125ms at 50). The pin is an
    // order-of-magnitude tripwire, not a precise budget — wall-clock
    // under parallel suite workers runs several times slower than a
    // cold CLI start, and only a regression that would genuinely
    // reopen lazy loading (10x) should fail it.
    expect(elapsed).toBeLessThan(1000)
    console.info(`program(): 5 commands ${time(5)}ms · 20 ${time(20)}ms · 50 ${elapsed.toFixed(1)}ms`)
  })
})

const time = (size: number) => {
  const started = performance.now()
  declare(size)
  return (performance.now() - started).toFixed(1)
}
