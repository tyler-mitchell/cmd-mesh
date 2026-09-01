import { afterEach, describe, expect, it } from "vitest"
import { ExecFailure, getPath, program, readFile, toolkit } from "../src/index.js"
import type { Ctx, ParameterSpec } from "../src/index.js"
import { captureCli, captureJson } from "./fixtures/capture.js"

const documentedCtxMembers = [
  "exec",
  "surface",
      "project",
      "workspace",
      "resources",
      "definePackage",
      "findDependencyInPackageJson",
      "findResolvedModulePath",
      "getConfigFormat",
      "getFolderByPackageName",
      "getGitRootFolder",
      "getPackageFolder",
      "getPath",
      "getWorkspaceFolder",
      "importMap",
      "importer",
      "isConfigFormat",
      "isDependencyInPackageJson",
      "isPackageDependency",
      "isPackageModuleFound",
      "isWritable",
      "modifyConfig",
      "modifyConfigFile",
      "modifyJSON",
      "modifyJSONFile",
      "readFile",
      "readFileSafely",
      "resolveConfigSource",
      "resolveModule",
      "resolveModulePath",
      "resolvePackageModulePath",
      "writeFile"
] as const satisfies ReadonlyArray<keyof Ctx>

const ctxCoverage: Exclude<keyof Ctx, typeof documentedCtxMembers[number]> extends never
  ? true
  : never = true

// One program exercising every claim the bundled reference makes about a
// declaration: notation forms, env fallback, defaults, aliases, the
// default child, hidden parameters, render hooks, completion, and the
// numeric-parameter union. A row in that document without a case here
// is a promise nothing keeps.
//
// It once mirrored a "Declaration reference" program in the README
// verbatim; that program is gone, so this pins the DOCUMENTED CONTRACT
// rather than a copy of a code block.

const tool = program({
  name: "tool",
  version: "1.0.0",
  cli: { default: "dev" },
  input: {
    logLevel: [["'debug' | 'info'", "@", { cli: "--log-level" }], "=", "info"]
  },
  commands: {
    dev: {
      description: "start dev mode",
      cli: { alias: ["d"], examples: ["tool dev src/main.ts --port 8080"] },
      input: {
        entry: ["string", "@", { cli: "<entry>" }],
        "out?": ["string", "@", { cli: "[out]" }],
        files: [["string[]", "@", { cli: "[...files]" }], "=", () => []],
        port: [["string.integer.parse", "@", { cli: { usage: "--port, -p", env: "TOOL_PORT" } }], "=", "3000"],
        tag: [["string[]", "@", { cli: "--tag <tags...>" }], "=", () => []],
        "token?": ["string", "@", { cli: { usage: "--token", hidden: true }, mcp: { hidden: true } }],
        "level?": "'debug' | 'info' | 'warn'",
        // the reference's numeric-parameter idiom: argv carries a
        // string, an agent's JSON carries a number, both reach the
        // handler as a number
        retries: [["string.integer.parse | number.integer", "@", { cli: "--retries" }], "=", "0"],
        // the reference lists these as ArkType's own metadata, "read
        // directly" — so they must reach the projected schema
        "profile?": ["string", "@", {
          cli: "--profile",
          suggest: "filepaths",
          examples: ["prod", "staging"],
          deprecated: true
        }]
      },
      narrow: (input, ctx) =>
        input.out === input.entry ? ctx.mustBe("a distinct output path") : true,
      output: { url: "string", tags: "string[]", logLevel: "string", retries: "number" },
      run: (input) => ({
        url: `http://localhost:${input.port}`,
        tags: [...input.tag],
        logLevel: input.logLevel,
        retries: input.retries
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
      // retries: 0 — the union's default is a string and still parses
      .toEqual({ url: "http://localhost:3000", tags: [], logLevel: "info", retries: 0 })
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

  // the reference documents this idiom for every numeric parameter, so
  // a regression here is a regression in what the docs promise
  it("takes a numeric parameter from argv and from a typed call alike", async () => {
    // argv only ever carries strings: the morph branch parses it
    const fromArgv = await captureJson(() =>
      tool.cli.run(["dev", "src/main.ts", "--retries", "3", "--json"])
    )
    expect(fromArgv).toMatchObject({ retries: 3 })

    // a caller with values in hand passes the number itself
    expect(tool.dev({ entry: "x", retries: 3 })).toMatchObject({ retries: 3 })
    // and the morph's own input side still works there
    expect(tool.dev({ entry: "x", retries: "3" })).toMatchObject({ retries: 3 })
  })

  it("projects arktype's own metadata into the agent's schema", () => {
    const serve = tool.mcp.tools.find((t) => t.name === "tool_serve")!
    const profile = (serve.inputSchema as {
      properties: Record<string, Record<string, unknown>>
    }).properties["profile"]!
    // the reference calls these "read directly", which is only true if
    // they survive the projection
    expect(profile["examples"]).toEqual(["prod", "staging"])
    expect(profile["deprecated"]).toBe(true)
  })

  it("completes a parameter from its declared suggestion source", async () => {
    // `suggest: "filepaths"` lists the working directory
    const words = await tool.cli.complete(["dev", "--profile", ""])
    expect(words.length).toBeGreaterThan(0)
  })

  // The header above claims every documented metadata row has a case
  // here. That claim was written twice by hand and was wrong twice, so
  // it is checked instead of trusted: the reference is the input.
  it("has a case for every metadata row the reference documents", () => {
    const reference = readFile(
      getPath("<package_folder>/skills/cmd-mesh/references/reference.md")
    )
    const table = reference.slice(
      reference.indexOf("| metadata | meaning |"),
      reference.indexOf("| notation | meaning |")
    )
    // only the table's FIRST column: prose and code fences between the
    // two tables also carry backticks, which is what this originally
    // tripped over. `mcp: { hidden }` names the `mcp` key, so just the
    // leading identifier is compared.
    const documented = table
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .flatMap((line) => [...line.split("|")[1]!.matchAll(/`([a-z][\w]*)/g)])
      .map((match) => match[1]!)
    expect(documented.length).toBeGreaterThan(4)

    const source = readFile(getPath("<package_folder>/tests/reference.test.ts"))
    const missing = documented.filter((key) => !source.includes(`${key}:`))
    expect(missing, "documented in reference.md, never declared here").toEqual([])
  })

  it("documents every handler context member", () => {
    const reference = readFile(
      getPath("<package_folder>/skills/cmd-mesh/references/reference.md")
    )
    const missing = documentedCtxMembers.filter(
      (member) => !reference.includes(`| \`ctx.${member}\``)
    )
    expect(ctxCoverage).toBe(true)
    expect(missing, "public Ctx member missing from the bundled reference").toEqual([])
  })

  it("ships a CLI-first Agent Skill with current declaration syntax", () => {
    const skill = readFile(getPath("<package_folder>/skills/cmd-mesh/SKILL.md"))
    expect(skill).toMatch(/^---\nname: cmd-mesh\n/)
    expect(skill).toContain("Create a CLI by default")
    expect(skill).toContain("Do not start an MCP server")
    expect(skill).toContain('["string", "@", { cli: "<file>"')
    expect(skill).not.toContain('{ type: "string"')
  })

  // The notation table's sibling check. Asserted against the COMPILED
  // spec rather than the source text: a form is covered when a real
  // parameter has that shape, not when a string appears in this file.
  it("declares a parameter for every notation form the reference documents", () => {
    // a spec node is identified by its `path`, not a name
    const dev = tool.spec.commands.find((c) => c.path.at(-1) === "dev")!
    const has = (predicate: (p: ParameterSpec) => boolean) => dev.parameters.some(predicate)

    const forms = {
      "<name> required positional": (p: ParameterSpec) =>
        p.kind === "positional" && p.required,
      "[name] optional positional": (p: ParameterSpec) =>
        p.kind === "positional" && !p.required && !p.variadic,
      "[...name] variadic positional": (p: ParameterSpec) =>
        p.kind === "positional" && p.variadic,
      "--flag, -f short alias": (p: ParameterSpec) =>
        p.kind === "flag" && p.usage.includes(", -"),
      "--tag <tags...> repeatable": (p: ParameterSpec) =>
        p.kind === "flag" && p.variadic,
      "omitted, derived kebab-case flag": (p: ParameterSpec) =>
        p.kind === "flag" && p.usage === `--${p.key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
    }
    const uncovered = Object.entries(forms).filter(([, predicate]) => !has(predicate)).map(([n]) => n)
    expect(uncovered, "notation documented in reference.md, no parameter here").toEqual([])
  })

  it("rejects a numeric parameter that is neither", () => {
    // @ts-expect-error — a boolean matches neither branch of the union
    expect(() => tool.dev({ entry: "x", retries: true })).toThrow(/retries/)
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

// The commonest thing that goes wrong when a handler shells out: the
// binary is not there. What a user reads must name the binary, not the
// spawner's internals.
describe("a binary that is not installed", () => {
  const runner = program({
    name: "runner",
    commands: {
      go: {
        description: "run a binary that does not exist",
        run: (_input, ctx) => ctx.exec("definitely-not-a-real-binary", [])
      }
    }
  })

  it("says what is missing rather than naming the spawner", async () => {
    const { err, code } = await captureCli(() => runner.cli.run(["go"]))
    expect(code).toBe(1)
    expect(err).toContain("definitely-not-a-real-binary is not installed, or not on PATH")
    // the platform's own wrapper helps nobody decide what to do
    expect(err).not.toContain("PlatformError")
    expect(err).not.toContain("ChildProcess.spawn")
  })

  it("still reports the cause when the failure is not a missing binary", () => {
    const other = new ExecFailure({ bin: "git", args: [], cause: "broken pipe" })
    expect(other.message).toBe("failed to execute git: broken pipe")
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
      ...toolkit,
      surface: "call",
      resources: {},
      exec: async (bin, args) => {
        calls.push([bin, ...args])
        return { stdout: "a.ts\nb.ts\n", stderr: "", exitCode: 0 }
      }
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
