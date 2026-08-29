// type-level proof of the contract: `input` and `output` are ArkType
// definitions, so ArkType's own inference IS the boundary model — its
// input side is what a caller may supply, its output side what a handler
// receives. run with: pnpm run test:types
import { attest, setup, teardown } from "@ark/attest"
import { program } from "./src/index.js"

setup({
  shouldFormat: false,
  tsconfig: "./tsconfig.attest.json"
})

try {
  const p = program({
    name: "t",
    commands: {
      // the ordinary shape: a positional, a flag with an alias, an
      // optional key, and a morph that parses its argv token
      greet: {
        input: {
          who: ["string", "@", { cli: "<who>" }],
          loud: [["boolean", "@", { cli: "--loud, -l" }], "=", false],
          times: [["string.integer.parse", "@", { cli: "--times, -n" }], "=", "1"],
          "note?": ["string", "@", { cli: "--note" }]
        },
        run: (input) => {
          attest(input.who).type.toString.snap("string")
          attest(input.loud).type.toString.snap("boolean")
          attest(input.times).type.toString.snap("number")
          attest(input.note).type.toString.snap("string | undefined")
          return input.times
        }
      },
      // a variadic positional says so in its own definition
      count: {
        input: {
          files: ["string[]", "@", { cli: "<...files>" }]
        },
        output: { total: "number" },
        run: (input) => ({ total: input.files.length })
      },
      // a structured parameter is an ordinary nested ArkType object
      configure: {
        input: {
          conf: [{ retries: "number.integer", label: "string" }, "@", { cli: "--conf" }]
        },
        run: (input) => {
          attest(input.conf).type.toString.snap("{ retries: number; label: string }")
          return input.conf.retries
        }
      }
    }
  })

  // the call surface is ArkType's INPUT side: defaulted and optional keys
  // may be omitted, and a morph accepts its own input domain
  attest(p.greet({ who: "ada" })).type.toString.snap("number")
  attest(p.greet({ who: "ada", times: "3", loud: true })).type.toString.snap("number")

  // an output contract decides the result type
  attest(p.count({ files: ["a"] })).type.toString.snap("{ total: number }")

  // a structured parameter crosses the value boundary as a real value
  attest(p.configure({ conf: { retries: 2, label: "x" } })).type.toString.snap("number")

  // rejections. these are type-level only — never invoked, since a call
  // that fails to typecheck would still run and throw at the boundary.
  const rejected = () => {
    // @ts-expect-error — `who` is required at the call boundary
    p.greet({})
    // @ts-expect-error — a morph's input domain is a string, not a number
    p.greet({ who: "ada", times: 3 })

    // ArkType validates the definition itself, in place
    program({
      name: "bad",
      // @ts-expect-error — 'not.a.keyword' is unresolvable
      commands: { c: { input: { x: "not.a.keyword" } } }
    })
    program({
      name: "bad2",
      // @ts-expect-error — `nonsense` is not a declared metadata key
      commands: { c: { input: { x: ["string", "@", { nonsense: 1 }] } } }
    })
    program({
      name: "bad3",
      // @ts-expect-error — cli takes a string or a config object
      commands: { c: { input: { x: ["string", "@", { cli: 7 }] } } }
    })
    program({
      name: "bad4",
      // @ts-expect-error — a default must satisfy the morph's INPUT domain
      commands: { c: { input: { n: [["string.integer.parse", "@", {}], "=", 1] } } }
    })
  }
  void rejected
} finally {
  teardown()
}
