import { describe, expect, it } from "vitest"
import { git, mesh } from "../examples/mesh.js"

// the public surface: the typed program itself, plus its two projections.

describe("the typed program", () => {
  it("keeps a sync handler synchronous — no promise involved", () => {
    const result = mesh.snapshot({ directory: "./public" })
    expect(result).toEqual({ snapped: "./public", depth: 2, verbose: false })
  })

  it("applies ArkType input-side defaults through their morphs", () => {
    expect(mesh.snapshot({ directory: "./public" })).toEqual({
      snapped: "./public",
      depth: 2,
      verbose: false
    })
  })

  it("accepts explicit value-domain input", () => {
    expect(mesh.snapshot({ directory: ".", depth: "4", verbose: true })).toEqual({
      snapped: ".",
      depth: 4,
      verbose: true
    })
  })

  it("throws on value-domain type violations", () => {
    expect(() => mesh.snapshot({ directory: 1 as never })).toThrow(/directory/)
  })

  it("runs command-level narrow across fields", () => {
    expect(() => mesh.snapshot({ directory: ".", signCert: "cert.pem" }))
      .toThrow(/--sign-cert and --sign-key together/)
    expect(mesh.snapshot({ directory: ".", signCert: "c", signKey: { a: "k" } }))
      .toMatchObject({ snapped: "." })
  })

  it("accepts structured (object-def) parameters as real values", () => {
    expect(() => mesh.snapshot({ directory: ".", signCert: "c", signKey: { a: 1 as never } }))
      .toThrow(/signKey/)
  })

  it("collects variadics and validates the output contract", () => {
    expect(mesh.build({ entries: ["a.ts", "b.ts"] })).toEqual({
      bundled: ["a.ts", "b.ts"],
      into: "dist"
    })
  })

  it("throws on an empty required variadic", () => {
    expect(() => mesh.build({ entries: [] })).toThrow(/entries/)
  })

  it("exposes nested subcommands as functions", () => {
    expect(mesh.cache.stat()).toEqual({ entries: 0 })
  })

  it("keeps an async handler asynchronous", async () => {
    const pending = mesh.disk()
    expect(pending).toBeInstanceOf(Promise)
    const result = (await pending) as { surface: string; usage: string }
    expect(result.surface).toBe("call")
    expect(result.usage).toMatch(/\d/)
  })
})

describe("external commands", () => {
  it("runs the binary through the spawner and applies the stdout contract", async () => {
    // --branch guarantees observable content even in a clean tree: the
    // porcelain header line names the current branch
    const status = await git.status({ short: true, branch: true })
    expect(status).toMatch(/^## /)
  })

  it("stays callable when mounted inside a program", async () => {
    await expect(mesh.git.status({ short: true, branch: true })).resolves.toMatch(/^## /)
  })

  it("fails typed on nonzero exit", async () => {
    const { external } = await import("../src/index.js")
    const lister = external({
      name: "ls",
      commands: {
        show: {
          input: { path: ["string", "@", { cli: "<path>" }] }
        }
      }
    })
    await expect(lister.show({ path: "/definitely-not-here-xyz" }))
      .rejects.toThrow(/exited with/)
  })
})

describe("the cli projection", () => {
  it("routes subcommands, flags, aliases, and variadics", async () => {
    expect(await mesh.cli.run(["build", "a.ts", "b.ts", "--out-dir", "out"])).toBe(0)
    expect(await mesh.cli.run(["snapshot", "./public", "-d", "9", "-v"])).toBe(0)
  })

  it("takes structured parameters as JSON tokens", async () => {
    expect(await mesh.cli.run(["snapshot", ".", "--sign-cert", "c", "--sign-key", "{\"a\":\"k\"}"])).toBe(0)
    expect(await mesh.cli.run(["snapshot", ".", "--sign-cert", "c", "--sign-key", "{\"a\":1}"])).toBe(2)
  })

  it("exits with the usage code on invalid input and unknown flags", async () => {
    expect(await mesh.cli.run(["snapshot"])).toBe(2)
    expect(await mesh.cli.run(["snapshot", ".", "--nope"])).toBe(2)
  })

  it("falls back to declared env variables", async () => {
    process.env["MESH_DEPTH"] = "7"
    expect(await mesh.cli.run(["snapshot", "./public"])).toBe(0)
    delete process.env["MESH_DEPTH"]
  })

  it("renders help and version with exit 0", async () => {
    expect(await mesh.cli.run(["--help"])).toBe(0)
    expect(await mesh.cli.run(["snapshot", "--help"])).toBe(0)
    expect(await mesh.cli.run(["--version"])).toBe(0)
  })

  it("emits a completion script under the program name programmatically", async () => {
    const { captureCli } = await import("./fixtures/capture.js")
    const { out } = await captureCli(() => mesh.cli.run(["complete", "zsh"]))
    expect(out).toMatch(/^#compdef mesh/)
  })

  it("completes subcommands and flags", async () => {
    await expect(mesh.cli.complete([""])).resolves.toContain("snapshot")
    await expect(mesh.cli.complete(["snapshot", "--d"])).resolves.toEqual(["--depth"])
  })
})

describe("the repository toolkit re-exports", () => {
  it("edits jsonc in memory, comments preserved", async () => {
    const { modifyJSON } = await import("../src/index.js")
    const { data, error } = modifyJSON({
      json: { text: "{\n  // keep me\n  \"a\": 1\n}" },
      edits: { "b.c": { value: 2 } }
    })
    expect(error).toBeUndefined()
    expect(data!.text).toContain("// keep me")
    expect(data!.data).toEqual({ a: 1, b: { c: 2 } })
  })

  it("resolves alias-grammar paths to this package", async () => {
    const { getPath } = await import("../src/index.js")
    const packageDir = getPath({ to: ["<package_folder>"] })
    expect(packageDir.endsWith("packages/cmd-mesh")).toBe(true)
  })

  it("writes a file through missing directories", async () => {
    const { readFile, toolkit, writeFile } = await import("../src/index.js")
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const root = mkdtempSync(join(tmpdir(), "cmd-mesh-create-file-"))
    try {
      const target = join(root, "deep", "nested", "note.txt")
      toolkit.writeFile(target, "made whole")
      expect(readFileSync(target, "utf8")).toBe("made whole")
      expect(toolkit.readFile).toBe(readFile)
      expect(toolkit.writeFile).toBe(writeFile)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("gives handlers the same toolkit used by direct imports", async () => {
    const { program, toolkit } = await import("../src/index.js")
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const root = mkdtempSync(join(tmpdir(), "cmd-mesh-toolkit-"))
    const file = join(root, "nested", "config.jsonc")
    const files = program({
      name: "files",
      commands: {
        roundtrip: {
          description: "write and edit a config",
          safety: "action",
          output: { source: "string", sameRead: "boolean", sameWrite: "boolean" },
          run: (_input, ctx) => {
            ctx.writeFile(file, "{\n  // keep\n  \"a\": 1\n}\n")
            const result = ctx.modifyJSONFile(file, { "b.c": { value: 2 } })
            if (result.error !== undefined) throw result.error
            return {
              source: ctx.readFile(file),
              sameRead: ctx.readFile === toolkit.readFile,
              sameWrite: ctx.writeFile === toolkit.writeFile
            }
          }
        }
      }
    })

    try {
      const result = files.roundtrip()
      expect(result.source).toContain("// keep")
      expect(toolkit.resolveConfigSource({ text: result.source, format: "jsonc" }, "data"))
        .toEqual({ a: 1, b: { c: 2 } })
      expect(result.sameRead).toBe(true)
      expect(result.sameWrite).toBe(true)
      expect(toolkit.readFileSafely(join(root, "missing.txt"))).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("the mcp projection", () => {
  it("derives mcp tools with full json schemas", () => {
    const names = mesh.mcp.tools.map((t) => t.name)
    expect(names).toEqual([
      "mesh_snapshot",
      "mesh_build",
      "mesh_cache_stat",
      "mesh_cache_clear",
      "mesh_disk",
      "mesh_git_status"
    ])
    const snapshot = mesh.mcp.tools[0]!.inputSchema as {
      properties: Record<string, { default?: unknown }>
      required: ReadonlyArray<string>
    }
    expect(snapshot.required).toEqual(["directory"])
    expect(snapshot.properties["depth"]!.default).toBe(2)
  })

  it("keeps mcp-hidden and non-runnable commands out of the tool list", () => {
    expect(mesh.mcp.tools.map((t) => t.name)).not.toContain("mesh_cache")
    expect(mesh.mcp.tools.map((t) => t.name)).not.toContain("mesh_git")
  })

  it("includes merged program-level options in a command's args", async () => {
    const { program } = await import("../src/index.js")
    const audited = program({
      name: "audited2",
      version: "0.0.0",
      input: { registry: [["string", "@", { cli: "--registry" }], "=", "https://npm.dev"] },
      commands: {
        add: {
          description: "add",
          input: { pkg: ["string", "@", { cli: "<pkg>" }] },
          output: { ok: "boolean" },
          run: () => ({ ok: true })
        }
      }
    })
    expect(audited.add.args.allows({ pkg: "x", registry: "https://r" })).toBe(true)
    expect(audited.add.args.allows({ pkg: "x", registry: 5 })).toBe(false)
    expect(JSON.stringify(audited.add.args.toJsonSchema())).toMatch(/registry/)
  })

  it("exposes the compiled value-boundary type as args", () => {
    expect(mesh.snapshot.args.allows({ directory: "." })).toBe(true)
    expect(mesh.snapshot.args.allows({ directory: 5 })).toBe(false)
    const schema = mesh.snapshot.args.toJsonSchema() as {
      required: ReadonlyArray<string>
      properties: Record<string, { type?: string }>
    }
    expect(schema.required).toEqual(["directory"])
    expect(schema.properties["signKey"]!.type).toBe("object")
  })
})
