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
      [
        "string.integer.parse",
        "@",
        { cli: { usage: "--port, -p", env: `X_${n}_PORT` } }
      ],
      "=",
      "3000"
    ],
    level: [["'debug' | 'info' | 'warn'", "@", {}], "=", "info"],
    tags: [["string[]", "@", { cli: "--tag <tags...>" }], "=", () => []],
    verbose: [["boolean", "@", { cli: "--verbose, -v" }], "=", false]
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

/** the middle of several readings, because one reading measures the
 * machine's mood as much as the code — this file's own history has a
 * loaded run reporting 591ms for a change repetition put at ~30% */
const medianMs = (size: number): number => {
  const readings = Array.from({ length: 5 }, () => {
    const started = performance.now()
    declare(size)
    return performance.now() - started
  })
  return [...readings].sort((a, b) => a - b)[2] as number
}

describe("declaration compile cost", () => {
  it("stays linear in the number of commands", () => {
    // What would reopen lazy subcommand loading is SUPERLINEAR cost, and
    // a ratio says that directly: five times the commands should cost
    // about five times as much, where quadratic would be about
    // twenty-five. Load stretches both readings, so the ratio holds
    // where an absolute wall-clock budget flakes.
    const ratio = medianMs(50) / medianMs(10)
    expect(ratio).toBeLessThan(12)
  })

  it("stays interactive at CLI scale (50 five-parameter commands)", () => {
    const compiled = declare(50)
    expect(Object.keys(compiled.cli).length).toBeGreaterThan(0)
    // A catastrophic backstop, not a constant-factor pin: the solo
    // baseline is ~124ms at 50 commands, about 2.5ms each.
    expect(medianMs(50)).toBeLessThan(500)
  })
})
