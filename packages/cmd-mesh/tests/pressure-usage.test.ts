// Usage under pressure.
//
// Every test here is a flow a real consumer runs, end to end: the shipped
// example program driven through its actual bin (the zero-plumbing
// `await mesh.main()` entry), a real MCP client handshake over stdio, the
// typed function surface through mounts (subprogram and external), and
// the argv > env > default precedence chain. Nothing synthetic — this is
// the README path.

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { mesh } from "../examples/mesh.js"
import { captureCli, captureJson } from "./fixtures/capture.js"

const run = promisify(execFile)
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..")

const bin = async (
  args: ReadonlyArray<string>,
  env?: Readonly<Record<string, string>>
): Promise<{ readonly code: number; readonly out: string; readonly err: string }> => {
  try {
    const { stdout, stderr } = await run("pnpm", ["exec", "tsx", "examples/bin.ts", ...args], {
      cwd: pkgDir,
      env: { ...process.env, ...env }
    })
    return { code: 0, out: stdout, err: stderr }
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failed.code ?? 1, out: failed.stdout ?? "", err: failed.stderr ?? "" }
  }
}

describe("the shipped bin, spawned like a user would", () => {
  it("runs a command with positional, short flag, and --json", async () => {
    const { code, out } = await bin(["serve", "./src", "-p", "8123", "--json"])
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ served: "./src", port: 8123, verbose: false })
  }, 30_000)

  it("exits non-zero through bare main() when input is missing", async () => {
    const { code, err } = await bin(["serve"])
    expect(code).toBe(1)
    expect(err).toMatch(/directory/)
  }, 30_000)

  it("prints root help with the built-in rows", async () => {
    const { code, out } = await bin(["--help"])
    expect(code).toBe(0)
    expect(out).toMatch(/Usage: mesh/)
    expect(out).toMatch(/mcp/)
    expect(out).toMatch(/complete <shell>/)
  }, 30_000)

  it("answers the completion protocol with live folder candidates", async () => {
    const { code, out } = await bin(["complete", "--", "serve", ""])
    expect(code).toBe(0)
    expect(out).toMatch(/src\//)
    expect(out).toMatch(/^:\d+$/m)
  }, 30_000)
})

describe("a real MCP client over stdio", () => {
  const withClient = async <A>(use: (client: Client) => Promise<A>): Promise<A> => {
    const client = new Client({ name: "pressure-usage", version: "0.0.0" })
    const transport = new StdioClientTransport({
      command: "pnpm",
      args: ["exec", "tsx", "examples/bin.ts", "mcp"],
      cwd: pkgDir
    })
    await client.connect(transport)
    try {
      return await use(client)
    } finally {
      await client.close()
    }
  }

  it("lists every projection of the program, mounted external included", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).toEqual(
        expect.arrayContaining(["mesh_serve", "mesh_build", "mesh_cache_stat", "mesh_disk", "mesh_git_status"])
      )
    })
  }, 30_000)

  it("calls a tool and returns schema-conformant structuredContent", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "mesh_cache_stat", arguments: {} })
      expect(result.structuredContent).toEqual({ entries: 0 })
    })
  }, 30_000)

  it("takes real object values on the value boundary, not JSON tokens", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "mesh_serve",
        arguments: { directory: "./src", tlsCert: "cert", tlsKey: { a: "key" } }
      })
      const text = (result.content as ReadonlyArray<{ readonly text: string }>)[0]?.text ?? ""
      expect(JSON.parse(text)).toMatchObject({ served: "./src", port: 3000 })
    })
  }, 30_000)

  it("surfaces a narrow rejection as a tool error, not a crash", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "mesh_serve",
        arguments: { directory: "./src", tlsCert: "cert-without-key" }
      })
      expect(result.isError).toBe(true)
      const text = (result.content as ReadonlyArray<{ readonly text: string }>)[0]?.text ?? ""
      expect(text).toMatch(/--tls-cert and --tls-key together/)
    })
  }, 30_000)
})

describe("the typed surface through mounts", () => {
  it("calls a nested subprogram command as a function", async () => {
    await expect(mesh.cache.stat()).resolves.toEqual({ entries: 0 })
  })

  it("calls a mounted external binary as a function", async () => {
    // the repo itself is the fixture: git status in cwd
    await expect(mesh.git.status({ short: true })).resolves.toEqual(expect.any(String))
  })

  it("runs a handler that shells out through ctx.exec", async () => {
    const result = (await mesh.disk()) as { readonly surface: string; readonly usage: string }
    expect(result.surface).toBe("call")
    expect(result.usage.length).toBeGreaterThan(0)
  })

  it("routes the cli through a mounted external", async () => {
    const { code, out } = await captureCli(() => mesh.main(["git", "status", "--short"]))
    expect(code).toBe(0)
    expect(typeof out).toBe("string")
  })

  it("renders help for a mounted path", () => {
    expect(mesh.help(["cache"])).toMatch(/stat/)
    expect(mesh.help(["git"])).toMatch(/status/)
  })

  it("completes across the mount boundary", async () => {
    await expect(mesh.complete(["git", ""])).resolves.toContain("status")
  })

  it("validates input through the args surface before calling", () => {
    expect(mesh.serve.args.allows({ directory: "./x" })).toBe(true)
    expect(mesh.serve.args.allows({ port: "not-a-number" })).toBe(false)
    expect(mesh.serve.args.toJsonSchema()).toMatchObject({ type: "object" })
  })
})

describe("argv > env > default precedence, one chain", () => {
  it("falls back to the declared default", async () => {
    const result = await captureJson(() => mesh.main(["serve", "./src", "--json"]))
    expect(result).toMatchObject({ port: 3000 })
  })

  it("env beats the default", async () => {
    process.env["MESH_PORT"] = "4000"
    const result = await captureJson(() => mesh.main(["serve", "./src", "--json"])).finally(() => {
      delete process.env["MESH_PORT"]
    })
    expect(result).toMatchObject({ port: 4000 })
  })

  it("argv beats env", async () => {
    process.env["MESH_PORT"] = "4000"
    const result = await captureJson(() =>
      mesh.main(["serve", "./src", "--port", "5000", "--json"])
    ).finally(() => {
      delete process.env["MESH_PORT"]
    })
    expect(result).toMatchObject({ port: 5000 })
  })

  it("rejects garbage regardless of which layer supplied it", async () => {
    process.env["MESH_PORT"] = "eight thousand"
    const { code, err } = await captureCli(() => mesh.main(["serve", "./src"])).finally(() => {
      delete process.env["MESH_PORT"]
    })
    expect(code).toBe(1)
    expect(err).toMatch(/port/)
  })
})

describe("narrow through the cli, both directions", () => {
  it("rejects the incoherent pair with the declared message", async () => {
    const { code, err } = await captureCli(() => mesh.main(["serve", "./src", "--tls-cert", "c"]))
    expect(code).toBe(1)
    expect(err).toMatch(/--tls-cert and --tls-key together/)
  })

  it("accepts the pair, object def as a JSON token", async () => {
    const result = await captureJson(() =>
      mesh.main(["serve", "./src", "--json", "--tls-cert", "c", "--tls-key", `{"a":"k"}`])
    )
    expect(result).toMatchObject({ served: "./src" })
  })
})
