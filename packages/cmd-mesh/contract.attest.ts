// type-level proof of the contract's ergonomics: bare handlers receive
// inferred inputs, call surfaces make defaulted keys optional, and outputs
// flow from output contracts or handler returns. run with:
//   pnpm run test:types
import { attest, setup, teardown } from "@ark/attest"
import { mesh } from "./examples/mesh.js"
import { external, program } from "./src/index.js"

setup({
  shouldFormat: false,
  tsconfig: "./tsconfig.attest.json"
})

try {
  const p = program({
    name: "t",
    commands: {
      c: {
        input: {
          s: { type: "string", cli: "<s>" },
          n: { type: "string.integer.parse = '1'" },
          b: { type: "boolean", cli: "--b" },
          maybe: { type: "string" }
        },
        // bare handler: no annotations, inference must carry everything
        run: (input) => {
          attest(input.s).type.toString.snap("string")
          attest(input.n).type.toString.snap("number")
          attest(input.b).type.toString.snap("boolean")
          attest(input.maybe).type.toString.snap("string | undefined")
          return input.n
        }
      },
      out: {
        input: {
          xs: { type: "string", cli: "<...xs>" }
        },
        output: { total: "number" },
        run: (input) => ({ total: input.xs.length })
      },
      structured: {
        // object ArkType defs are first-class parameter types
        input: {
          conf: { type: { a: "string.integer.parse" } }
        },
        run: (input) => {
          attest(input.conf).type.toString.snap("{ a: number } | undefined")
          return input.conf
        }
      }
    }
  })

  // output contract wins over the handler return
  attest(p.out({ xs: ["a"] })).type.toString.snap("Promise<{ total: number }>")

  // handler return drives the output when no contract is declared
  attest(p.c({ s: "x" })).type.toString.snap("Promise<number>")

  // structured parameter: real output-domain object on the call surface
  // (the cli surface takes input-domain JSON tokens instead)
  attest(p.structured({ conf: { a: 1 } })).type.toString.snap("Promise<{ a: number } | undefined>")

  // object def + narrow together, plus a mounted external in the record
  const ext = external({
    name: "x",
    commands: { y: { input: { f: { type: "boolean", cli: "--f" } } } }
  })
  const p3 = program({
    name: "b3",
    commands: {
      s: {
        input: {
          tlsKey: { type: { a: "string" } }
        },
        narrow: (input, ctx) => input.tlsKey === undefined || ctx.mustBe("x"),
        run: (input) => input.tlsKey
      },
      ext
    }
  })
  // all-optional inputs make the argument itself optional
  attest({} as Parameters<typeof p3.s>[0]).type.toString.snap("{ readonly tlsKey?: { a: string } } | undefined")

  // the example program's real call surface
  attest({} as Parameters<typeof mesh.serve>[0]).type.toString.snap(`{
  readonly directory: string
  readonly port?: number
  readonly verbose?: boolean
  readonly tlsCert?: string
  readonly tlsKey?: { a: string }
}`)

  // negative space: the call surface enforces required keys and value
  // domains. type-level only — never invoked.
  const negativeSpace = () => {
    // @ts-expect-error — required positional `s` missing
    void p.c({})
    // @ts-expect-error — n is number on the value surface, not a token
    void p.c({ s: "x", n: "1" })
  }
  void negativeSpace
} finally {
  teardown()
}
