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
    entry: ["string", "@", { cli: "<entry>" }],
    port: [
      "string.integer.parse",
      "@",
      { cli: { usage: "--port, -p", env: `X_${n}_PORT` }, default: "3000" }
    ],
    level: ["'debug' | 'info' | 'warn'", "@", { default: "info" }],
    tags: ["string[]", "@", { cli: "--tag <tags...>", default: () => [] }],
    verbose: ["boolean", "@", { cli: "--verbose, -v", default: false }]
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
    // a factory-built declaration is not a literal, so its tuples widen
    // and contract inference cannot apply. this measures RUNTIME compile
    // cost, where the tuples are intact, so the cast loses nothing.
    commands: Object.fromEntries(
      Array.from({ length: size }, (_, n) => [`cmd${n}`, command(n)])
    ) as never
  })

describe("declaration compile cost", () => {
  it("stays interactive at CLI scale (50 five-parameter commands)", () => {
    const started = performance.now()
    const compiled = declare(50)
    const elapsed = performance.now() - started
    expect(Object.keys(compiled.cli).length).toBeGreaterThan(0)
    // This file runs alone through test:cost, so the budget can be real.
    // Solo baseline is ~124ms at 50 commands, about 2.5ms per command,
    // measured over repeated runs rather than one reading.
    //
    // The earlier pin was 2500ms because this ran inside the parallel
    // suite, where contention reached ~1330ms. Running alone removes
    // that noise. A single wall-clock reading is still unreliable: one
    // taken on a loaded machine read 591ms for a change that repeated
    // runs put at ~30%. Trust this number only in repetition.
    //
    // The pin catches a structural regression — the kind that would
    // reopen lazy subcommand loading — not a small constant factor.
    expect(elapsed).toBeLessThan(500)
    console.info(`program(): 5 commands ${time(5)}ms · 20 ${time(20)}ms · 50 ${elapsed.toFixed(1)}ms`)
  })
})

const time = (size: number) => {
  const started = performance.now()
  declare(size)
  return (performance.now() - started).toFixed(1)
}
