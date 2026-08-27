import { afterAll, describe, expect, it } from "vitest"
import { git, mesh } from "../examples/mesh.js"

// the public promise surface: what consumers actually touch.

afterAll(() => mesh.dispose())

describe("direct invocation", () => {
  it("applies ArkType input-side defaults through their morphs", async () => {
    const result = await mesh.serve({ directory: "./public" })
    expect(result).toEqual({ served: "./public", port: 3000, verbose: false })
  })

  it("accepts explicit value-domain input", async () => {
    const result = await mesh.serve({ directory: ".", port: 8080, verbose: true })
    expect(result).toEqual({ served: ".", port: 8080, verbose: true })
  })

  it("rejects value-domain type violations", async () => {
    await expect(mesh.serve({ directory: 1 as never })).rejects.toThrow(/directory/)
  })

  it("runs command-level narrow across fields", async () => {
    await expect(mesh.serve({ directory: ".", tlsCert: "cert.pem" }))
      .rejects.toThrow(/--tls-cert and --tls-key together/)
    await expect(mesh.serve({ directory: ".", tlsCert: "c", tlsKey: { a: "k" } }))
      .resolves.toMatchObject({ served: "." })
  })

  it("accepts structured (object-def) parameters as real values", async () => {
    await expect(mesh.serve({ directory: ".", tlsCert: "c", tlsKey: { a: 1 as never } }))
      .rejects.toThrow(/tlsKey/)
  })

  it("collects variadics and validates the output contract", async () => {
    const result = await mesh.build({ entries: ["a.ts", "b.ts"] })
    expect(result).toEqual({ bundled: ["a.ts", "b.ts"], into: "dist" })
  })

  it("rejects an empty required variadic", async () => {
    await expect(mesh.build({ entries: [] })).rejects.toThrow(/entries/)
  })

  it("exposes nested subcommands as functions", async () => {
    await expect(mesh.cache.stat()).resolves.toEqual({ entries: 0 })
  })

  it("hands handlers a working ctx.exec", async () => {
    const result = await mesh.disk() as { surface: string; usage: string }
    expect(result.surface).toBe("call")
    expect(result.usage).toMatch(/\d/)
  })
})

describe("external commands", () => {
  it("runs the binary through the spawner and applies the stdout contract", async () => {
    const status = await git.status({ short: true })
    expect(typeof status).toBe("string")
  })

  it("stays callable when mounted inside a program", async () => {
    await expect(mesh.git.status({ short: true })).resolves.toBeTypeOf("string")
  })

  it("fails typed on nonzero exit", async () => {
    const { external } = await import("../src/index.js")
    const lister = external({
      name: "ls",
      commands: {
        show: {
          input: { path: { type: "string", cli: "<path>" } }
        }
      }
    })
    await expect(lister.show({ path: "/definitely-not-here-xyz" }))
      .rejects.toThrow(/exited with/)
  })
})

describe("cli projection", () => {
  it("routes subcommands, flags, aliases, and variadics", async () => {
    expect(await mesh.main(["build", "a.ts", "b.ts", "--out-dir", "out"])).toBe(0)
    expect(await mesh.main(["serve", "./public", "-p", "9999", "-v"])).toBe(0)
  })

  it("takes structured parameters as JSON tokens", async () => {
    expect(await mesh.main(["serve", ".", "--tls-cert", "c", "--tls-key", "{\"a\":\"k\"}"])).toBe(0)
    expect(await mesh.main(["serve", ".", "--tls-cert", "c", "--tls-key", "{\"a\":1}"])).toBe(1)
  })

  it("exits 1 on invalid input and unknown flags", async () => {
    expect(await mesh.main(["serve"])).toBe(1)
    expect(await mesh.main(["serve", ".", "--nope"])).toBe(1)
  })

  it("falls back to declared env variables", async () => {
    process.env["MESH_PORT"] = "4444"
    expect(await mesh.main(["serve", "./public"])).toBe(0)
    delete process.env["MESH_PORT"]
  })

  it("renders help and version with exit 0", async () => {
    expect(await mesh.main(["--help"])).toBe(0)
    expect(await mesh.main(["serve", "--help"])).toBe(0)
    expect(await mesh.main(["--version"])).toBe(0)
  })
})

describe("projections", () => {
  it("derives mcp tools with full json schemas", () => {
    const names = mesh.mcp.tools.map((t) => t.name)
    expect(names).toEqual(["mesh_serve", "mesh_build", "mesh_cache_stat", "mesh_disk", "mesh_git_status"])
    const serve = mesh.mcp.tools[0]!.inputSchema as {
      properties: Record<string, { default?: unknown }>
      required: ReadonlyArray<string>
    }
    expect(serve.required).toEqual(["directory"])
    expect(serve.properties["port"]!.default).toBe(3000)
  })

  it("keeps mcp-hidden and non-runnable commands out of the tool list", () => {
    expect(mesh.mcp.tools.map((t) => t.name)).not.toContain("mesh_cache")
    expect(mesh.mcp.tools.map((t) => t.name)).not.toContain("mesh_git")
  })

  it("emits the declaration as pure data", () => {
    expect(JSON.parse(JSON.stringify(mesh.spec))).toEqual(mesh.spec)
  })

  it("completes subcommands and flags", async () => {
    await expect(mesh.complete([""])).resolves.toContain("serve")
    await expect(mesh.complete(["serve", "--p"])).resolves.toEqual(["--port"])
  })

  it("exposes the compiled value-boundary type as args", () => {
    expect(mesh.serve.args.allows({ directory: "." })).toBe(true)
    expect(mesh.serve.args.allows({ directory: 5 })).toBe(false)
    const schema = mesh.serve.args.toJsonSchema() as {
      required: ReadonlyArray<string>
      properties: Record<string, { type?: string }>
    }
    expect(schema.required).toEqual(["directory"])
    expect(schema.properties["tlsKey"]!.type).toBe("object")
  })
})
