// The typed functions ARE the program. This file proves their CALL
// surface: what a caller may pass, what comes back, and which forms the
// compiler rejects. run with: pnpm run test:types
import { attest, setup, teardown } from "@ark/attest"
import { external, program } from "./src/index.js"

setup({
  shouldFormat: false,
  tsconfig: "./tsconfig.attest.json"
})

try {
  const remote = program({
    name: "remote",
    commands: {
      show: {
        input: { name: ["string", "@", { cli: "<name>" }] },
        run: (input) => input.name
      }
    }
  })

  const tool = program({
    name: "tool",
    version: "1.0.0",
    commands: {
      // one required parameter, nothing else
      greet: {
        input: { name: ["string", "@", { cli: "<name>" }] },
        run: (input) => `hello ${input.name}`
      },
      // one required parameter beside defaulted ones
      commit: {
        input: {
          message: ["string", "@", { cli: "--message, -m" }],
          all: [["boolean", "@", { cli: "--all, -a" }], "=", false]
        },
        run: (input) => ({ message: input.message, all: input.all })
      },
      // one required parameter whose value is an array
      add: {
        input: { paths: ["string[] >= 1", "@", { cli: "<...paths>" }] },
        run: (input) => input.paths.length
      },
      // every parameter optional
      status: {
        input: { short: [["boolean", "@", { cli: "--short" }], "=", false] },
        run: (input) => input.short
      },
      // two required parameters
      move: {
        input: {
          from: ["string", "@", { cli: "<from>" }],
          to: ["string", "@", { cli: "<to>" }]
        },
        run: (input) => `${input.from} -> ${input.to}`
      },
      // one required parameter whose value is a plain object
      configure: {
        input: { conf: [{ retries: "number.integer" }, "@", { cli: "--conf" }] },
        run: (input) => input.conf.retries
      },
      // an async handler
      fetchOne: {
        input: { url: ["string", "@", { cli: "<url>" }] },
        run: async (input) => ({ at: input.url })
      },
      // a declared output contract types the result
      measured: {
        input: { path: ["string", "@", { cli: "<path>" }] },
        output: { bytes: "number" },
        run: (input) => ({ bytes: input.path.length })
      },
      // a mounted subprogram — the contract's nesting mechanism
      remote
    }
  })

  // ─── the record form always works ───────────────────────────────────────
  attest(tool.greet({ name: "ada" })).type.toString.snap("string")
  attest(tool.commit({ message: "fix", all: true })).type.toString.snap("{ message: string; all: boolean }")
  attest(tool.add({ paths: ["a.ts"] })).type.toString.snap("number")

  // ─── the shorthand: one required parameter, passed bare ─────────────────
  attest(tool.greet("ada")).type.toString.snap("string")
  attest(tool.commit("fix: fixed typings")).type.toString.snap("{ message: string; all: boolean }")
  attest(tool.add(["a.ts", "b.ts"])).type.toString.snap("number")
  attest(tool.remote.show("origin")).type.toString.snap("string")

  // ─── the argument is optional only when every key is ────────────────────
  attest(tool.status()).type.toString.snap("boolean")
  attest(tool.status({ short: true })).type.toString.snap("boolean")

  // ─── synchrony follows the handler ──────────────────────────────────────
  // a sync handler stays sync — no promise to await
  attest(tool.greet("ada")).type.toString.snap("string")
  attest(tool.fetchOne("https://example.com")).type.toString.snap("Promise<{ at: string }>")

  // ─── a declared output contract types the result ────────────────────────
  attest(tool.measured("./a.ts")).type.toString.snap("{ bytes: number }")

  // ─── externals: same surface, always async, plus exec options ───────────
  const git = external({
    name: "git",
    commands: {
      commit: {
        input: {
          message: ["string", "@", { cli: "--message, -m" }],
          all: [["boolean", "@", { cli: "--all, -a" }], "=", false]
        },
        output: "string"
      },
      status: {
        input: { short: [["boolean", "@", { cli: "--short, -s" }], "=", false] },
        output: "string"
      }
    }
  })

  // type-only: executing these would spawn the binary
  attest(null as never as ReturnType<typeof git.commit>).type.toString.snap("Promise<string>")
  attest(null as never as Parameters<typeof git.commit>).type.toString.snap("[value: string, options?: ExternalCallOptions]")
  attest(null as never as Parameters<typeof git.status>).type.toString.snap(`[
  input?: { short?: boolean } | undefined,
  options?: ExternalCallOptions | undefined
]`)

  // ─── rejections: type-level only, never invoked ─────────────────────────
  const rejected = () => {
    // @ts-expect-error — the required parameter is not supplied
    tool.greet()
    // @ts-expect-error — the bare value must match the parameter's domain
    tool.greet(7)
    // @ts-expect-error — an unknown key is not accepted
    tool.greet({ name: "ada", nope: 1 })
    // @ts-expect-error — two required parameters have no unambiguous bare form
    tool.move("a")
    // @ts-expect-error — a plain-object value keeps only the record form
    tool.configure({ retries: 2 })
    // @ts-expect-error — the array's element type is enforced
    tool.add([7])
    // @ts-expect-error — externals reject a bare value of the wrong domain
    git.commit(7)
  }
  void rejected
} finally {
  teardown()
}
