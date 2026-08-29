import { type } from "arktype"
import { describe, expect, it } from "vitest"
import { mesh } from "../examples/mesh.js"
import { program } from "../src/index.js"

// the cli token path under the ArkType-shaped contract: flags with
// aliases, boolean presence, variadics, and an external's own flags.
describe("the fluent default spelling", () => {
  // `.configure(...).default(v)` returns the very tuple [base, "=", v],
  // so a declaration may use either spelling.
  const fluent = program({
    name: "fl",
    commands: {
      go: {
        input: {
          depth: type("string.integer.parse").configure({ cli: "--depth, -d" }).default("2"),
          loud: type("boolean").configure({ cli: "--loud, -l" }).default(false)
        },
        run: (input: { readonly depth: number; readonly loud: boolean }) => input
      }
    }
  })

  it("keeps the alias reachable through a fluent default", async () => {
    expect(await fluent.cli.run(["go", "-d", "5", "-l"])).toBe(0)
  })

  it("applies the fluent default when the flag is absent", () => {
    expect(fluent.go({})).toEqual({ depth: 2, loud: false })
  })
})

describe("cli token path", () => {
  it("reports the compiled boundaries for snapshot", () => {
    const compiled = (mesh as any)[Symbol.for("cmd-mesh/mounted")]
    const snapshot = compiled.children.snapshot
    console.log("valueType →", snapshot.valueType.expression)
    console.log("schemaType →", snapshot.schemaType.expression)
    const attempt = (label: string, f: () => unknown) => {
      try {
        console.log(label, JSON.stringify(f()))
      } catch (e) {
        console.log(label, `threw: ${e}`)
      }
    }
    attempt("schema(in) →", () => snapshot.schemaType.in.toJsonSchema())
  })

  it("keeps this package's surface bindings out of the agent schema", () => {
    const tool = mesh.mcp.tools.find((t) => t.name === "mesh_snapshot")
    const props = (tool!.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties
    expect(Object.keys(props.depth!)).not.toContain("argv")
    expect(Object.keys(props.depth!)).not.toContain("env")
    expect(Object.keys(props.directory!)).not.toContain("suggest")
    // the facts an agent DOES need survive
    expect(props.depth!.description).toBe("traversal depth")
    expect(props.depth!.default).toBe(2)
  })

  it("parses a short alias, a value flag and a boolean flag together", async () => {
    const code = await mesh.cli.run(["snapshot", "./public", "-d", "4", "-v"])
    expect(code).toBe(0)
  })

  it("parses an external's boolean flags", async () => {
    const code = await mesh.cli.run(["git", "status", "--short"])
    expect(code).toBe(0)
  })

  it("collects a variadic positional", async () => {
    expect(await mesh.cli.run(["build", "a.ts", "b.ts", "--out-dir", "out"])).toBe(0)
  })

  it("still rejects a missing required positional", async () => {
    expect(await mesh.cli.run(["snapshot"])).toBe(2)
  })
})
