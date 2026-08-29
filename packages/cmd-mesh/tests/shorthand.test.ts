import { describe, expect, it } from "vitest"
import { program } from "../src/index.js"

// A command whose input is one required parameter takes that value
// bare. The record form always works; the shorthand is an addition.

const tool = program({
  name: "tool",
  version: "1.0.0",
  commands: {
    greet: {
      input: { name: ["string", "@", { cli: "<name>" }] },
      run: (input) => `hello ${input.name}`
    },
    commit: {
      input: {
        message: ["string", "@", { cli: "--message, -m" }],
        all: ["boolean", "@", { cli: "--all, -a", default: false }]
      },
      run: (input) => ({ message: input.message, all: input.all })
    },
    add: {
      input: { paths: ["string[] >= 1", "@", { cli: "<...paths>" }] },
      run: (input) => [...input.paths]
    },
    depth: {
      input: { level: ["string.integer.parse", "@", { cli: "<level>" }] },
      run: (input) => input.level + 1
    },
    move: {
      input: {
        from: ["string", "@", { cli: "<from>" }],
        to: ["string", "@", { cli: "<to>" }]
      },
      run: (input) => `${input.from} -> ${input.to}`
    },
    configure: {
      input: { conf: [{ retries: "number.integer" }, "@", { cli: "--conf" }] },
      run: (input) => input.conf.retries
    },
    status: {
      input: { short: ["boolean", "@", { cli: "--short", default: false }] },
      run: (input) => input.short
    }
  }
})

describe("the shorthand call form", () => {
  it("takes the lone required parameter bare", () => {
    expect(tool.greet("ada")).toBe("hello ada")
  })

  it("agrees with the record form", () => {
    expect(tool.greet("ada")).toBe(tool.greet({ name: "ada" }))
  })

  it("applies the other parameters' defaults", () => {
    expect(tool.commit("fix: typings")).toEqual({ message: "fix: typings", all: false })
  })

  it("still accepts the record form with those parameters set", () => {
    expect(tool.commit({ message: "fix", all: true })).toEqual({ message: "fix", all: true })
  })

  it("takes an array value bare", () => {
    expect(tool.add(["a.ts", "b.ts"])).toEqual(["a.ts", "b.ts"])
  })

  it("runs the parameter's own morph on the bare value", () => {
    // the call surface is the morph's INPUT side, so the bare value is
    // the string the morph parses
    expect(tool.depth("4")).toBe(5)
  })

  it("rejects a bare value outside the morph's input domain", () => {
    // @ts-expect-error — the input side of string.integer.parse is a string
    expect(() => tool.depth(4)).toThrow()
  })

  it("validates the bare value against the parameter's domain", () => {
    // @ts-expect-error — the domain is a string
    expect(() => tool.greet(7)).toThrow()
  })

  it("enforces the array's element contract", () => {
    // @ts-expect-error — the elements are strings
    expect(() => tool.add([7])).toThrow()
  })

  it("reads a plain object as the input record, never as a bare value", () => {
    expect(tool.configure({ conf: { retries: 2 } })).toBe(2)
  })

  it("keeps the record form for two required parameters", () => {
    expect(tool.move({ from: "a", to: "b" })).toBe("a -> b")
  })

  it("keeps a bare-callable command reachable with no argument when it has none required", () => {
    expect(tool.status()).toBe(false)
  })

  it("leaves the cli surface unchanged", async () => {
    expect(tool.cli.help(["greet"])).toMatch(/<name>/)
  })
})
