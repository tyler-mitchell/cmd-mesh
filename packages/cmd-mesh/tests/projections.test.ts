import { describe, expect, it } from "vitest"
import { compileCommand } from "../src/compile.js"
import { candidatesFor } from "../src/completion.js"
import { collectTools } from "../src/mcp.js"
import { renderResult } from "../src/render.js"

// the projection layers, tested against a purpose-built compiled tree.

const root = compileCommand("tool", ["tool"], {
  commands: {
    release: {
      description: "bump",
      input: {
        bump: { type: "'patch' | 'minor' | 'major'", cli: "<bump>" },
        pkg: { type: "string = './package.json'", suggest: "filepaths", cli: "--pkg" },
        dryRun: { type: "boolean", cli: "--dry-run, -n" }
      },
      output: { from: "string", to: "string" },
      run: () => ({ from: "0.0.0", to: "0.0.1" })
    },
    list: {
      description: "list things",
      output: [{ name: "string" }, "[]"],
      run: () => [{ name: "a" }]
    },
    secret: {
      description: "cli hidden",
      cli: { hidden: true },
      run: () => "s"
    }
  }
} as never)

describe("completion candidates", () => {
  it("lists visible subcommands at the root", () => {
    expect(candidatesFor(root, [""])).toEqual(["release", "list"])
  })

  it("completes enum positionals from the ArkType union", () => {
    expect(candidatesFor(root, ["release", ""])).toContain("major")
    expect(candidatesFor(root, ["release", "m"])).toEqual(["major", "minor"])
    expect(candidatesFor(root, ["release", "pa"])).toEqual(["patch"])
  })

  it("offers flags with aliases and boolean negation", () => {
    const candidates = candidatesFor(root, ["release", "--"])
    expect(candidates).toContain("--pkg")
    expect(candidates).toContain("--dry-run")
    expect(candidates).toContain("--no-dry-run")
  })

  it("emits named-source directives for flag values", () => {
    expect(candidatesFor(root, ["release", "--pkg", ""])).toEqual([":files"])
  })

  it("stops offering a consumed positional", () => {
    expect(candidatesFor(root, ["release", "patch", ""])).not.toContain("major")
  })
})

describe("mcp tools", () => {
  const tools = collectTools(root)
  const byName = new Map(tools.map((t) => [t.tool.name, t]))

  it("wraps non-object output schemas under result", () => {
    const list = byName.get("tool_list")!
    expect(list.wrapOutput).toBe(true)
    expect((list.tool.outputSchema as { properties: object }).properties).toHaveProperty("result")
  })

  it("keeps object output schemas unwrapped", () => {
    const release = byName.get("tool_release")!
    expect(release.wrapOutput).toBe(false)
    expect((release.tool.outputSchema as { required: ReadonlyArray<string> }).required)
      .toEqual(["from", "to"])
  })
})

describe("cli rendering", () => {
  it("renders arrays of flat records as aligned rows", () => {
    const rendered = renderResult([
      { file: "a.ts", line: 1, text: "one" },
      { file: "longer/path.ts", line: 22, text: "two" }
    ])
    expect(rendered).toBe("a.ts            1   one\nlonger/path.ts  22  two")
  })

  it("keeps strings raw and objects as json", () => {
    expect(renderResult("plain")).toBe("plain")
    expect(renderResult({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2))
  })
})
