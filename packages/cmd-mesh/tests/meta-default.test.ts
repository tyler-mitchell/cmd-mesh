import { type } from "arktype"
import { describe, expect, it } from "vitest"
import { program } from "../src/index.js"

// `default` is a declared ArkType metadata key (NodeMeta extends
// JsonSchema.UniversalMeta, which has `default?: t`). this pins whether it
// BEHAVES as a default at the value boundary, or is only an annotation.
describe("default beside a binding in one metadata object", () => {
  const tool = program({
    name: "md",
    commands: {
      go: {
        input: {
          depth: ["string.integer.parse", "@", { cli: "--depth, -d", default: "2" }],
          loud: ["boolean", "@", { cli: "--loud, -l", default: false }],
          who: ["string", "@", { cli: "<who>" }]
        },
        run: (input) => input
      }
    }
  })

  it("applies the default and keeps the binding", async () => {
    expect(tool.go({ who: "ada" })).toEqual({ who: "ada", depth: 2, loud: false })
    expect(await tool.cli.run(["go", "ada", "-d", "7", "-l"])).toBe(0)
  })

  it("infers the same optionality the operator form gives", () => {
    // `who` required, the defaulted keys omittable — a type error here
    // would mean the type level and the runtime disagree
    expect(tool.go({ who: "x", depth: "9" })).toEqual({ who: "x", depth: 9, loud: false })
  })
})

describe("default as metadata", () => {
  it("says what meta.default does to a missing key", () => {
    const withMetaDefault = type({ port: ["number", "@", { default: 3000 }] })
    const result = withMetaDefault({})
    console.log("meta.default on missing key →", JSON.stringify(result))
    console.log("meta.default node meta →", JSON.stringify((withMetaDefault.get("port") as any).meta))

    const withOperator = type({ port: [["number", "@", { cli: "--port" }], "=", 3000] })
    console.log("'=' operator on missing key →", JSON.stringify(withOperator({})))

    // the decisive comparison: do the two forms agree?
    expect(JSON.stringify(withOperator({}))).toBe(JSON.stringify({ port: 3000 }))
  })

  it("says whether meta.default changes optionality in JSON Schema", () => {
    const meta = type({ port: ["number", "@", { default: 3000 }] })
    const operator = type({ port: ["number", "=", 3000] })
    console.log("meta form schema →", JSON.stringify(meta.toJsonSchema()))
    console.log("operator form schema →", JSON.stringify(operator.toJsonSchema()))
  })
})
