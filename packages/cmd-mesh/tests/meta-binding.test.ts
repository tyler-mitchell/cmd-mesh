import { type } from "arktype"
import { describe, expect, it } from "vitest"
import { compileCommand } from "../src/compile.js"

// where does ArkType keep metadata when a default wraps a morph, and how
// is an array element reached? both decide whether the cli token path can
// find a parameter's binding and its element type.
describe("metadata behind a default wrapper", () => {
  it("reports which face carries the meta", () => {
    const t = type({
      depth: [["string.integer.parse", "@", { cli: "--depth, -d" }], "=", "2"]
    }) as any
    const prop = t.get("depth")
    console.log("prop.meta →", JSON.stringify(prop.meta))
    console.log("prop.in.meta →", JSON.stringify(prop.in.meta))
    console.log("prop.out.meta →", JSON.stringify(prop.out.meta))
    console.log("prop.out.exclude(undefined).meta →", JSON.stringify(prop.out.exclude("undefined").meta))
    console.log("prop.expression →", prop.expression)
  })

  it("reports how an array element is reached", () => {
    const t = type({ files: ["string[]", "@", { cli: "<...files>" }] }) as any
    const prop = t.get("files")
    console.log("array meta →", JSON.stringify(prop.meta))
    console.log("array expression →", prop.expression)
    const viaGet = (() => {
      try {
        return (prop.get(0) as any).expression
      } catch (e) {
        return `threw: ${e}`
      }
    })()
    console.log("array .get(0) →", viaGet)
  })

  it("reports whether the fluent spelling keeps meta across a morph", () => {
    const t = type({
      depth: type("string.integer.parse").configure({ cli: "--depth, -d" }).default("2")
    }) as any
    const prop = t.get("depth")
    console.log("fluent prop.meta →", JSON.stringify(prop.meta))
    console.log("fluent in.meta →", JSON.stringify(prop.in.meta))
    console.log("fluent out.exclude →", JSON.stringify(prop.out.exclude("undefined").meta))
    console.log("fluent parses →", JSON.stringify(t({})))
  })

  it("reports where a fluent .configure().default() keeps its metadata", () => {
    const fluent = type("string.integer.parse").configure({ cli: "--depth, -d" }).default("2") as any
    console.log("fluent own keys →", JSON.stringify(Object.keys(fluent)))
    console.log("fluent.meta →", JSON.stringify(fluent.meta))
    const inner = fluent.inner ?? fluent[" inner"]
    console.log("fluent.inner keys →", inner === undefined ? "none" : JSON.stringify(Object.keys(inner)))
    if (inner?.default !== undefined) console.log("inner.default →", JSON.stringify(inner.default))
    const base = inner?.["=" as never] ?? inner?.base ?? inner?.node
    console.log("base.meta →", base === undefined ? "none" : JSON.stringify(base.meta))
  })

  it("reports whether a defaulted boolean still reads as boolean", () => {
    const t = type({ verbose: [["boolean", "@", { cli: "--verbose, -v" }], "=", false] }) as any
    const prop = t.get("verbose")
    console.log("bool expression →", prop.expression)
    console.log("bool out.exclude expression →", prop.out.exclude("undefined").expression)
    console.log("bool extends boolean →", prop.out.exclude("undefined").extends("boolean"))
  })

  it.skip("shows what the compiler actually produced for depth", () => {
    const [cmd] = compileCommand("t", ["t"], {
      input: {
        depth: [["string.integer.parse", "@", { cli: "--depth, -d" }], "=", "2"]
      },
      run: () => 1
    } as never) as any
    const depth = cmd.parameters.find((p: any) => p.key === "depth")
    console.log("compiled binding →", JSON.stringify(depth.binding))
    expect(depth.binding.aliases).toContain("-d")
  })
})
