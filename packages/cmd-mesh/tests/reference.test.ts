import { afterEach, describe, expect, it } from "vitest"
import { program, project, workspace } from "../src/index.js"
import type { Ctx } from "../src/index.js"
import { captureCli, captureJson } from "./fixtures/capture.js"

// The README's "Declaration reference" program, verbatim, with every
// claim the README makes about it asserted. Editing one side means
// editing the other.

const tool = program({
  name: "tool",
  version: "1.0.0",
  cli: { default: "dev" },
  input: {
    logLevel: ["'debug' | 'info'", "@", { cli: "--log-level", default: "info" }]
  },
  commands: {
    dev: {
      description: "start dev mode",
      cli: { alias: ["d"], examples: ["tool dev src/main.ts --port 8080"] },
      input: {
        entry: ["string", "@", { cli: "<entry>" }],
        "out?": ["string", "@", { cli: "[out]" }],
        files: ["string[]", "@", { cli: "[...files]", default: () => [] }],
        port: ["string.integer.parse", "@", {
          cli: { usage: "--port, -p", env: "TOOL_PORT" },
          default: "3000"
        }],
        tag: ["string[]", "@", { cli: "--tag <tags...>", default: () => [] }],
        "token?": ["string", "@", { cli: { usage: "--token", hidden: true }, mcp: { hidden: true } }],
        "level?": "'debug' | 'info' | 'warn'"
      },
      narrow: (input, ctx) =>
        input.out === input.entry ? ctx.mustBe("a distinct output path") : true,
      output: { url: "string", tags: "string[]", logLevel: "string" },
      run: (input) => ({
        url: `http://localhost:${input.port}`,
        tags: [...input.tag],
        logLevel: input.logLevel
      }),
      mcp: {
        name: "tool_serve",
        annotations: { readOnlyHint: true }
      }
    },
    render: {
      description: "custom human rendering",
      cli: { render: (output) => `→ ${output.url}` },
      output: { url: "string" },
      run: () => ({ url: "https://example.com" })
    }
  }
})

describe("the README reference program", () => {
  afterEach(() => {
    delete process.env["TOOL_PORT"]
  })

  it("is a typed function with parsed defaults", () => {
    expect(tool.dev({ entry: "src/main.ts" }))
      .toEqual({ url: "http://localhost:3000", tags: [], logLevel: "info" })
  })

  it("delivers the program-level option from either argv position", async () => {
    const before = await captureJson(() =>
      tool.cli.run(["--log-level", "debug", "dev", "src/main.ts", "--json"])
    )
    const after = await captureJson(() =>
      tool.cli.run(["dev", "src/main.ts", "--log-level", "debug", "--json"])
    )
    expect(before).toMatchObject({ logLevel: "debug" })
    expect(after).toMatchObject({ logLevel: "debug" })
    // and on the typed surface
    expect(tool.dev({ entry: "x", logLevel: "debug" })).toMatchObject({ logLevel: "debug" })
  })

  it("enforces the narrow invariant on the value boundary", () => {
    expect(() => tool.dev({ entry: "x", out: "x" })).toThrow(/distinct output/)
  })

  it("routes the alias", async () => {
    const result = await captureJson(() => tool.cli.run(["d", "src/main.ts", "--json"]))
    expect(result).toMatchObject({ url: "http://localhost:3000" })
  })

  it("runs the default child on a bare invocation", async () => {
    const result = await captureJson(() => tool.cli.run(["src/main.ts", "--json"]))
    expect(result).toMatchObject({ url: "http://localhost:3000" })
  })

  it("falls back to the declared environment variable", async () => {
    process.env["TOOL_PORT"] = "8080"
    const result = await captureJson(() => tool.cli.run(["dev", "src/main.ts", "--json"]))
    expect(result).toMatchObject({ url: "http://localhost:8080" })
  })

  it("collects the repeatable flag", async () => {
    const result = await captureJson(() =>
      tool.cli.run(["dev", "src/main.ts", "--json", "--tag", "a", "--tag", "b"])
    )
    expect(result).toMatchObject({ tags: ["a", "b"] })
  })

  it("hides --token from help but still parses it", async () => {
    expect(tool.cli.help(["dev"])).not.toMatch(/--token/)
    const { code } = await captureCli(() =>
      tool.cli.run(["dev", "src/main.ts", "--token", "secret"])
    )
    expect(code).toBe(0)
  })

  it("keeps --token out of the mcp tool schema", () => {
    const serve = tool.mcp.tools.find((t) => t.name === "tool_serve")!
    expect(serve.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
    expect(JSON.stringify(serve.inputSchema)).not.toMatch(/token/)
  })

  it("renders declared examples in help", () => {
    expect(tool.cli.help(["dev"])).toMatch(/Examples:\n  tool dev src\/main\.ts --port 8080/)
  })

  it("tab-completes the derived enum flag's members", async () => {
    await expect(tool.cli.complete(["dev", "--level", ""])).resolves.toContain("debug")
  })

  it("renders through the cli render hook for humans only", async () => {
    const human = await captureCli(() => tool.cli.run(["render"]))
    expect(human.out).toBe("→ https://example.com")
    const json = await captureJson(() => tool.cli.run(["render", "--json"]))
    expect(json).toEqual({ url: "https://example.com" })
  })
})

describe("unit-testing a handler that execs", () => {
  // a handler is a plain function and Ctx is structural — a hand-built
  // fake ctx is the whole mocking story, no framework seam required
  const list = async (input: { readonly dir: string }, ctx: Ctx) => {
    const result = await ctx.exec("git", ["ls-files", input.dir])
    return { files: result.stdout.split("\n").filter((line) => line !== "") }
  }

  it("runs against a fake ctx, recording the exec call", async () => {
    const calls: Array<ReadonlyArray<string>> = []
    const fake: Ctx = {
      surface: "call",
      resources: {},
      exec: async (bin, args) => {
        calls.push([bin, ...args])
        return { stdout: "a.ts\nb.ts\n", stderr: "", exitCode: 0 }
      },
      // a fake mocks what the test controls; the rest passes through
      project,
      workspace
    }
    expect(await list({ dir: "src" }, fake)).toEqual({ files: ["a.ts", "b.ts"] })
    expect(calls).toEqual([["git", "ls-files", "src"]])
  })

  it("mounts the same handler in a program and runs it for real", async () => {
    const repo = program({
      name: "repo",
      version: "0.0.0",
      commands: {
        list: {
          description: "list tracked files",
          input: { dir: ["string", "@", { cli: "<dir>" }] },
          output: { files: "string[]" },
          run: list
        }
      }
    })
    // the same function, now behind the real interpreter ctx: git
    // ls-files against this package's own tracked sources
    const result = await repo.list({ dir: "src" })
    expect(result.files).toContain("src/module.ts")
    expect(result.files).toContain("src/spec.ts")
  })
})
