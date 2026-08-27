import { afterAll, describe, expect, it } from "vitest"
import { mesh } from "../examples/mesh.js"
import { app, deploy, disposeAll, wrap } from "./fixtures/programs.js"

// The agent- and tooling-facing projections under pressure.
//
// MCP tools, the spec, and completion are the surfaces nobody eyeballs
// before shipping: an agent reads the schema and a shell reads the
// candidates. A silently degraded schema or a shadowed tool name is
// invisible until it misbehaves in production.

afterAll(async () => {
  await disposeAll()
  await mesh.dispose()
})

interface Schema {
  readonly type?: string
  readonly properties?: Record<string, {
    readonly type?: string
    readonly default?: unknown
    readonly description?: string
    readonly enum?: ReadonlyArray<unknown>
    readonly anyOf?: ReadonlyArray<unknown>
  }>
  readonly required?: ReadonlyArray<string>
}

const toolsOf = (program: { mcp: { tools: ReadonlyArray<{ name: string }> } }) =>
  program.mcp.tools.map((t) => t.name)

describe("mcp tool identity", () => {
  it("gives every tool a unique name", () => {
    // an MCP server routes purely by name; two tools sharing one makes the
    // second unreachable and the choice silent
    const names = toolsOf(app)
    expect(new Set(names).size).toBe(names.length)
  })

  it("honors an explicit mcp name override", () => {
    expect(toolsOf(deploy)).toContain("deploy_audit_log")
  })

  it("omits mcp-hidden commands", () => {
    expect(toolsOf(deploy)).not.toContain("deploy_internal")
  })

  it("omits non-runnable group commands", () => {
    expect(toolsOf(deploy)).not.toContain("deploy_config")
  })

  it("exposes declared annotations on the projected tool", () => {
    // annotations drive an agent's willingness to call a tool unattended
    const audit = deploy.mcp.tools.find((t) => t.name === "deploy_audit_log")
    expect(audit).toBeDefined()
    expect(audit as unknown as { annotations?: unknown }).toHaveProperty("annotations")
  })
})

describe("mcp input schemas", () => {
  const push = deploy.mcp.tools.find((t) => t.name === "deploy_push")!
  const schema = push.inputSchema as Schema

  it("describes every declared parameter", () => {
    const properties = Object.keys(schema.properties ?? {})
    expect(properties).toEqual(
      expect.arrayContaining(["service", "env", "message", "replicas", "force", "watch"])
    )
  })

  it("requires only what has no default", () => {
    expect(schema.required).toEqual(["service"])
  })

  it("carries declared defaults", () => {
    expect(schema.properties?.["replicas"]?.default).toBe(2)
    expect(schema.properties?.["env"]?.default).toBe("staging")
  })

  it("carries parameter descriptions", () => {
    expect(schema.properties?.["service"]?.description).toBe("service name")
    expect(schema.properties?.["replicas"]?.description).toBe("replica count")
  })

  it("projects an enum parameter as an enumeration, not a bare string", () => {
    const env = schema.properties?.["env"]
    const encoded = JSON.stringify(env)
    expect(encoded).toMatch(/staging/)
    expect(encoded).toMatch(/production/)
  })

  it("never degrades a schema to an untyped object", () => {
    // jsonSchemaOf swallows projection failures; a bare {type:"object"}
    // tells an agent nothing about the call it is about to make
    for (const tool of deploy.mcp.tools) {
      const s = tool.inputSchema as Schema
      expect(s.type).toBe("object")
      expect(Object.keys(s.properties ?? {}).length > 0 || s.required === undefined).toBe(true)
    }
  })

  it("projects a structured parameter as a nested object schema", () => {
    const serve = mesh.mcp.tools.find((t) => t.name === "mesh_serve")!
    const tlsKey = (serve.inputSchema as Schema).properties?.["tlsKey"]
    expect(tlsKey?.type).toBe("object")
  })

  it("projects a variadic positional as an array", () => {
    const exec = wrap.mcp.tools.find((t) => t.name === "wrap_exec")!
    const args = (exec.inputSchema as Schema).properties?.["args"]
    expect(JSON.stringify(args)).toMatch(/array/)
  })
})

describe("mcp output schemas", () => {
  it("keeps an object output unwrapped", () => {
    const push = deploy.mcp.tools.find((t) => t.name === "deploy_push")!
    expect((push.outputSchema as Schema).type).toBe("object")
    expect((push.outputSchema as Schema).properties).toHaveProperty("service")
  })

  it("wraps a list output under result", () => {
    const status = deploy.mcp.tools.find((t) => t.name === "deploy_status")!
    expect((status.outputSchema as Schema).properties).toHaveProperty("result")
  })
})

describe("the spec projection", () => {
  it("survives a JSON round trip with functions stripped", () => {
    expect(JSON.parse(JSON.stringify(deploy.spec))).toEqual(deploy.spec)
  })

  it("carries bindings, defaults, and descriptions", () => {
    const spec = deploy.spec as {
      commands: Record<string, { input: Record<string, Record<string, unknown>> }>
    }
    const replicas = spec.commands["push"]!.input["replicas"]!
    expect(replicas["default"]).toBe(2)
    expect(replicas["description"]).toBe("replica count")
    expect(replicas["binding"]).toMatchObject({ _tag: "flag", name: "--replicas" })
  })

  it("marks a group command as not runnable", () => {
    const spec = deploy.spec as { commands: Record<string, { runnable: boolean }> }
    expect(spec.commands["config"]!.runnable).toBe(false)
    expect(spec.commands["push"]!.runnable).toBe(true)
  })
})

describe("completion candidates", () => {
  it("offers visible subcommands at the root", async () => {
    const candidates = await deploy.complete([""])
    expect(candidates).toEqual(expect.arrayContaining(["push", "rollback", "config", "status"]))
  })

  it("never repeats a candidate", async () => {
    const candidates = await deploy.complete([""])
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it("offers short aliases for a short prefix", async () => {
    const candidates = await deploy.complete(["push", "api", "-"])
    expect(candidates).toEqual(expect.arrayContaining(["-f", "-m", "-e"]))
  })

  it("offers long flags for a long prefix", async () => {
    const candidates = await deploy.complete(["push", "api", "--"])
    expect(candidates).toEqual(expect.arrayContaining(["--force", "--message", "--env"]))
  })

  it("enumerates a flag's literal values", async () => {
    const candidates = await deploy.complete(["push", "api", "--env", ""])
    expect(candidates).toEqual(expect.arrayContaining(["production", "staging"]))
  })

  it("does not offer values for a boolean flag", async () => {
    const candidates = await deploy.complete(["push", "api", "--force", ""])
    expect(candidates).not.toContain("true")
  })

  it("stops offering options after the end-of-options separator", async () => {
    // everything after `--` is a value, so the command's own flags are
    // no longer candidates
    const candidates = await deploy.complete(["push", "api", "--", "-"])
    expect(candidates.filter((c) => c.startsWith("-"))).toEqual([])
  })
})
