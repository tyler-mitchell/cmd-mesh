import { type } from "arktype"
import { describe, expect, it } from "vitest"

// Pins patches/arktype.patch — `default` in metadata applies as a default.
//
// Unpatched, ArkType has two fields named `default`: the one on the
// `optional` prop node (which `"="` and `.default()` build, and which
// fills a missing value) and `JsonSchema.UniversalMeta.default`, a
// documentation annotation the `"@"` tuple accepts. The patch makes
// parseProperty promote the second into the first, so a property can
// carry its annotations and its default in one object.
//
// If the patch is dropped, every test here fails.

describe("default in metadata applies as a default", () => {
  it("fills a missing key", () => {
    const t = type({ port: ["number", "@", { default: 3000 }] })
    expect(t({})).toEqual({ port: 3000 })
  })

  it("makes the key optional rather than required", () => {
    const t = type({ port: ["number", "@", { default: 3000 }] })
    const schema = t.toJsonSchema() as { required?: ReadonlyArray<string> }
    expect(schema.required).toBeUndefined()
  })

  it("agrees with the operator form", () => {
    const meta = type({ port: ["number", "@", { default: 3000 }] })
    const operator = type({ port: ["number", "=", 3000] })
    expect(meta({})).toEqual(operator({}))
    expect(meta({ port: 1 })).toEqual(operator({ port: 1 }))
  })

  it("keeps the rest of the metadata reachable", () => {
    const t = type({
      port: ["number", "@", { default: 3000, description: "the port" }]
    })
    const prop = t.get("port") as never as { readonly out: { exclude(s: string): { meta: unknown } } }
    expect(prop.out.exclude("undefined").meta).toMatchObject({ description: "the port" })
  })

  it("still validates a supplied value against the type", () => {
    const t = type({ port: ["number", "@", { default: 3000 }] })
    expect(t({ port: "nope" })).toBeInstanceOf(type.errors)
  })

  it("applies through a morph, defaulting on the input side", () => {
    const t = type({ n: ["string.integer.parse", "@", { default: "7" }] })
    expect(t({})).toEqual({ n: 7 })
    expect(t({ n: "9" })).toEqual({ n: 9 })
  })

  it("leaves a property with no metadata default untouched", () => {
    const t = type({ port: ["number", "@", { description: "the port" }] })
    expect(t({})).toBeInstanceOf(type.errors)
  })

  it("does not disturb the operator and optional tuple forms", () => {
    expect(type({ a: ["number", "=", 1] })({})).toEqual({ a: 1 })
    expect(type({ b: ["number", "?"] })({})).toEqual({})
  })

  it("leaves a plain string definition untouched", () => {
    expect(type({ a: "number = 2" })({})).toEqual({ a: 2 })
    expect(type({ b: "number" })({})).toBeInstanceOf(type.errors)
  })

  it("rejects a default the type does not accept, as the operator does", () => {
    expect(() => type({ port: ["number", "@", { default: "no" }] })).toThrow()
  })

  // the .d.ts half: `inferTupleExpression`'s "@" branch must produce
  // Default<T, V>, which is what `distill.In` turns into an optional key.
  // Types are proved in meta-default.attest.ts; this pins that the two
  // forms stay interchangeable at runtime, which is the same claim.
  it("matches the operator form's JSON Schema exactly", () => {
    const meta = type({ port: ["number", "@", { default: 3000 }], name: "string" })
    const operator = type({ port: ["number", "=", 3000], name: "string" })
    expect(meta.toJsonSchema()).toEqual(operator.toJsonSchema())
  })

  // the type half infers a metadata default but does not VALIDATE it
  // against the input domain, the way the "=" operator's own
  // `defaultFor<type.infer.In<…>>` check does. ArkType's runtime
  // assertion still runs, so the gap is late rather than unsound.
  it("still rejects a metadata default the input domain refuses", () => {
    expect(() => type({ n: ["string.integer.parse", "@", { default: 1 }] })).toThrow()
    expect(() => type({ n: ["number", "@", { default: "no" }] })).toThrow()
  })

  it("accepts a caller who omits the defaulted key", () => {
    const t = type({ port: ["number", "@", { default: 3000 }], name: "string" })
    expect(t.from({ name: "ada" })).toEqual({ name: "ada", port: 3000 })
  })
})
