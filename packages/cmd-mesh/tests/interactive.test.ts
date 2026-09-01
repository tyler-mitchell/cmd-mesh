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

interface TextOptions {
  readonly message: string
  readonly validate?: (value: string | undefined) => string | undefined
}
const textPrompts: Array<TextOptions> = []
const recordText = (options: TextOptions) => {
  textPrompts.push(options)
  return next()
}

vi.mock("@clack/prompts", () => ({
  intro: () => undefined,
  outro: () => undefined,
  cancel: () => undefined,
  isCancel: (value: unknown) => value === CANCEL,
  select: next,
  confirm: next,
  text: recordText,
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
        entry: ["string", "@", { cli: "<entry>" }],
        port: ["string.integer.parse", "@", { cli: "--port, -p", default: "3000" }],
        // the numeric idiom the reference teaches: a prompt only ever
        // yields a string, so the union must not weaken its validation
        retries: ["string.integer.parse | number.integer", "@", {
          cli: "--retries",
          default: "0"
        }],
        level: ["'debug' | 'info'", "@", { default: "info" }],
        verbose: ["boolean", "@", { cli: "--verbose, -v", default: false }]
      },
      output: {
        entry: "string",
        port: "number",
        retries: "number",
        level: "string",
        verbose: "boolean"
      },
      run: (input) => {
        seen.push(input)
        return input
      }
    },
    grep: {
      description: "search",
      input: {
        pattern: ["string", "@", { cli: "--pattern" }]
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
    textPrompts.length = 0
    asTTY(true)
  })

  it("refuses an empty submission for a required positional", async () => {
    answers.push("entry.ts", "", "info", false)
    await tool.cli.interactive(["build"])
    const entry = textPrompts.find((options) => options.message.includes("entry"))!
    expect(entry.validate?.("")).toBe("required")
  })

  it("accepts an empty submission for a defaulted flag", async () => {
    answers.push("entry.ts", "", "", "info", false)
    await tool.cli.interactive(["build"])
    const port = textPrompts.find((options) => options.message.includes("--port"))!
    expect(port.validate?.("")).toBeUndefined()
  })

  // a prompt yields a string even when the parameter also accepts a
  // number, so the union must not let a prompt take what argv could not
  it("still rejects a non-numeric answer for a union parameter", async () => {
    answers.push("entry.ts", "", "", "info", false)
    await tool.cli.interactive(["build"])
    const retries = textPrompts.find((options) => options.message.includes("--retries"))!
    expect(retries.validate?.("abc")).toBeTruthy()
    expect(retries.validate?.("4")).toBeUndefined()
  })

  it("dispatches a union parameter answered as text", async () => {
    answers.push("entry.ts", "", "5", "info", false)
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(0)
    // the handler receives a number, whichever branch matched
    expect(seen.at(-1)).toMatchObject({ retries: 5 })
  })
  afterEach(() => {
    asTTY(true)
  })

  it("prompts each parameter and dispatches through the real cli boundary", async () => {
    answers.push(
      "entry.ts", // <entry> text
      "8080", // --port text, validated by string.integer.parse
      "2", // --retries text, validated by the numeric union
      "debug", // level enum select
      true // --verbose confirm
    )
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(0)
    expect(seen).toEqual([
      { entry: "entry.ts", port: 8080, retries: 2, level: "debug", verbose: true }
    ])
  })

  it("applies defaults for skipped prompts", async () => {
    answers.push(
      "entry.ts", // <entry>
      "", // port skipped → default 3000 through the parse morph
      "", // retries skipped → default 0 through the union's morph branch
      "info", // level
      false // verbose
    )
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(0)
    expect(seen).toEqual([
      { entry: "entry.ts", port: 3000, retries: 0, level: "info", verbose: false }
    ])
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
      "",
      "info",
      false
    )
    const code = await tool.cli.interactive(["build"])
    expect(code).toBe(0)
    expect(seen).toEqual([
      { entry: "-entry.ts", port: 3000, retries: 0, level: "info", verbose: false }
    ])
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
