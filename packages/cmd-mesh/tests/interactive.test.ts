import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// guided invocation through the REAL cli path: the mocked prompts only
// script a user's answers — command selection, typed values, cancels —
// and every assertion observes what actually dispatched: the handler's
// morphed input and the exit code runCli resolved.

const CANCEL = Symbol.for("clack:cancel")
const answers: Array<unknown> = []
const next = () => {
  if (answers.length === 0) throw new Error("prompt asked with no scripted answer")
  return Promise.resolve(answers.shift())
}

vi.mock("@clack/prompts", () => ({
  intro: () => undefined,
  outro: () => undefined,
  cancel: () => undefined,
  isCancel: (value: unknown) => value === CANCEL,
  select: next,
  confirm: next,
  text: next,
  autocomplete: next
}))

const { program } = await import("../src/index.js")

const seen: Array<unknown> = []

const tool = program({
  name: "tool",
  version: "1.0.0",
  commands: {
    build: {
      description: "bundle",
      input: {
        entry: { type: "string", cli: "<entry>" },
        port: { type: "string.integer.parse = '3000'", cli: "--port, -p" },
        level: { type: "'debug' | 'info' = 'info'" },
        verbose: { type: "boolean", cli: "--verbose, -v" }
      },
      output: { entry: "string", port: "number", level: "string", verbose: "boolean" },
      run: (input) => {
        seen.push(input)
        return input
      }
    },
    grep: {
      description: "search",
      input: {
        pattern: { type: "string", cli: "--pattern" }
      },
      output: { pattern: "string" },
      run: (input) => {
        seen.push(input)
        return { pattern: input.pattern ?? "" }
      }
    }
  }
})

const asTTY = (value: boolean) => {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true })
}

describe("cli.interactive", () => {
  beforeEach(() => {
    answers.length = 0
    seen.length = 0
    asTTY(true)
  })
  afterEach(() => {
    asTTY(true)
  })

  it("prompts each parameter and dispatches through the real cli boundary", async () => {
    answers.push(
      "entry.ts", // <entry> text
      "8080", // --port text, validated by string.integer.parse
      "debug", // level enum select
      true // --verbose confirm
    )
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(0)
    expect(seen).toEqual([{ entry: "entry.ts", port: 8080, level: "debug", verbose: true }])
  })

  it("applies defaults for skipped prompts", async () => {
    answers.push(
      "entry.ts", // <entry>
      "", // port skipped → default 3000 through the parse morph
      "info", // level
      false // verbose
    )
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(0)
    expect(seen).toEqual([{ entry: "entry.ts", port: 3000, level: "info", verbose: false }])
  })

  it("carries a hyphen-leading flag value through the ordinary form", async () => {
    answers.push("-x.*") // a declared flag consumes its next token unconditionally
    const code = await tool.cli.interactive(["grep"])
    expect(code).toBe(0)
    expect(seen).toEqual([{ pattern: "-x.*" }])
  })

  it("fences a hyphen-leading positional behind end-of-options", async () => {
    answers.push(
      "-entry.ts", // <entry> — unfenced this would read as an unknown flag
      "",
      "info",
      false
    )
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(0)
    expect(seen).toEqual([{ entry: "-entry.ts", port: 3000, level: "info", verbose: false }])
  })

  it("cancelling exits 130 without dispatching", async () => {
    answers.push(CANCEL)
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(130)
    expect(seen).toEqual([])
  })

  it("refuses without a terminal", async () => {
    asTTY(false)
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(1)
    expect(seen).toEqual([])
  })
})
