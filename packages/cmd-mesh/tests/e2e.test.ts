// End to end.
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
    const { code, out } = await bin(["snapshot", "./src", "-d", "8", "--json"])
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ snapped: "./src", depth: 8, verbose: false })
  }, 30_000)

  it("exits with the usage code through bare main() when input is missing", async () => {
    const { code, err } = await bin(["snapshot"])
    expect(code).toBe(2)
    expect(err).toMatch(/directory/)
  }, 30_000)

  it("prints root help with the built-in completion row", async () => {
    const { code, out } = await bin(["--help"])
    expect(code).toBe(0)
    expect(out).toMatch(/Usage: mesh/)
    expect(out).toMatch(/complete <shell>/)
  }, 30_000)

  it("answers the completion protocol with live folder candidates", async () => {
    const { code, out } = await bin(["complete", "--", "snapshot", ""])
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
        expect.arrayContaining(["mesh_snapshot", "mesh_build", "mesh_cache_stat", "mesh_disk", "mesh_git_status"])
      )
    })
  }, 30_000)

  it("delivers tool annotations over the wire", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools()
      const snapshot = tools.find((t) => t.name === "mesh_snapshot")
      expect(snapshot).toBeDefined()
      // input schema arrives with documented properties, not a stub
      expect(JSON.stringify(snapshot!.inputSchema)).toMatch(/directory to snapshot/)
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
        name: "mesh_snapshot",
        arguments: { directory: "./src", signCert: "cert", signKey: { a: "key" } }
      })
      const text = (result.content as ReadonlyArray<{ readonly text: string }>)[0]?.text ?? ""
      expect(JSON.parse(text)).toMatchObject({ snapped: "./src", depth: 2 })
    })
  }, 30_000)

  it("surfaces a narrow rejection as a tool error, not a crash", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "mesh_snapshot",
        arguments: { directory: "./src", signCert: "cert-without-key" }
      })
      expect(result.isError).toBe(true)
      const text = (result.content as ReadonlyArray<{ readonly text: string }>)[0]?.text ?? ""
      expect(text).toMatch(/--sign-cert and --sign-key together/)
    })
  }, 30_000)

  it("executes a mounted external binary as a tool, wrapping its string output", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "mesh_git_status", arguments: { short: true } })
      expect(result.isError).not.toBe(true)
      // output contract "string" is non-object, so structuredContent
      // nests it under result to satisfy the mcp object requirement
      expect(result.structuredContent).toMatchObject({ result: expect.any(String) })
    })
  }, 30_000)

  it("rejects schema-invalid arguments as a tool error naming the key", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "mesh_snapshot",
        arguments: { directory: 42 }
      })
      expect(result.isError).toBe(true)
      const text = (result.content as ReadonlyArray<{ readonly text: string }>)[0]?.text ?? ""
      expect(text).toMatch(/directory/)
    })
  }, 30_000)

  it("answers an unknown tool name with a tool error, not a protocol failure", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "mesh_nonexistent", arguments: {} })
      expect(result.isError).toBe(true)
    })
  }, 30_000)

  it("returns valid empty content for a void tool", async () => {
    // the sdk schema: content [] is valid, text: undefined is not
    await withClient(async (client) => {
      const result = await client.callTool({ name: "mesh_cache_clear", arguments: {} })
      expect(result.isError).not.toBe(true)
      expect(result.content).toEqual([])
    })
  }, 30_000)

  it("serves concurrent tool calls on one connection", async () => {
    await withClient(async (client) => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => client.callTool({ name: "mesh_cache_stat", arguments: {} }))
      )
      results.forEach((r) => expect(r.structuredContent).toEqual({ entries: 0 }))
    })
  }, 30_000)
})

describe("the typed surface through mounts", () => {
  it("calls a nested subprogram command as a sync function", () => {
    expect(mesh.cache.stat()).toEqual({ entries: 0 })
  })

  it("calls a mounted external binary as a function", async () => {
    // the repo itself is the fixture: the porcelain branch header proves
    // git actually ran here with the declared flags
    await expect(mesh.git.status({ short: true, branch: true })).resolves.toMatch(/^## /)
  })

  it("runs a handler that shells out through ctx.exec", async () => {
    const result = (await mesh.disk()) as { readonly surface: string; readonly usage: string }
    expect(result.surface).toBe("call")
    expect(result.usage.length).toBeGreaterThan(0)
  })

  it("routes the cli through a mounted external", async () => {
    const { code, out } = await captureCli(() => mesh.cli.run(["git", "status", "--short", "--branch"]))
    expect(code).toBe(0)
    expect(out).toMatch(/^## /)
  })

  it("renders help for a mounted path", () => {
    expect(mesh.cli.help(["cache"])).toMatch(/stat/)
    expect(mesh.cli.help(["git"])).toMatch(/status/)
  })

  it("completes across the mount boundary", async () => {
    await expect(mesh.cli.complete(["git", ""])).resolves.toContain("status")
  })

  it("validates input through the args surface before calling", () => {
    expect(mesh.snapshot.args.allows({ directory: "./x" })).toBe(true)
    expect(mesh.snapshot.args.allows({ depth: "not-a-number" })).toBe(false)
    const schema = mesh.snapshot.args.toJsonSchema() as {
      type: string
      properties: Record<string, { description?: string }>
    }
    expect(schema.type).toBe("object")
    // one declaration, one documentation: the args schema carries the
    // same parameter docs the mcp tool schema does
    expect(schema.properties["directory"]?.description).toBe("directory to snapshot")
  })
})

describe("argv > env > default precedence, one chain", () => {
  it("falls back to the declared default", async () => {
    const result = await captureJson(() => mesh.cli.run(["snapshot", "./src", "--json"]))
    expect(result).toMatchObject({ depth: 2 })
  })

  it("env beats the default", async () => {
    process.env["MESH_DEPTH"] = "4"
    const result = await captureJson(() => mesh.cli.run(["snapshot", "./src", "--json"])).finally(() => {
      delete process.env["MESH_DEPTH"]
    })
    expect(result).toMatchObject({ depth: 4 })
  })

  it("argv beats env", async () => {
    process.env["MESH_DEPTH"] = "4"
    const result = await captureJson(() =>
      mesh.cli.run(["snapshot", "./src", "--depth", "5", "--json"])
    ).finally(() => {
      delete process.env["MESH_DEPTH"]
    })
    expect(result).toMatchObject({ depth: 5 })
  })

  it("rejects garbage regardless of which layer supplied it", async () => {
    process.env["MESH_DEPTH"] = "eight thousand"
    const { code, err } = await captureCli(() => mesh.cli.run(["snapshot", "./src"])).finally(() => {
      delete process.env["MESH_DEPTH"]
    })
    expect(code).toBe(2)
    expect(err).toMatch(/depth/)
  })
})

describe("narrow through the cli, both directions", () => {
  it("rejects the incoherent pair with the declared message", async () => {
    const { code, err } = await captureCli(() => mesh.cli.run(["snapshot", "./src", "--sign-cert", "c"]))
    expect(code).toBe(2)
    expect(err).toMatch(/--sign-cert and --sign-key together/)
  })

  it("accepts the pair, object def as a JSON token", async () => {
    const result = await captureJson(() =>
      mesh.cli.run(["snapshot", "./src", "--json", "--sign-cert", "c", "--sign-key", `{"a":"k"}`])
    )
    expect(result).toMatchObject({ snapped: "./src" })
  })
})
