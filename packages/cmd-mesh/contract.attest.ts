// Type-level proof of the contract, against the shapes real tools ship.
// `input` and `output` are ArkType definitions, so ArkType's own inference
// IS the boundary model: its input side is what a caller may supply, its
// output side what a handler receives. run with: pnpm run test:types
import { attest, setup, teardown } from "@ark/attest"
import { type } from "arktype"
import { external, program } from "./src/index.js"

setup({
  shouldFormat: false,
  tsconfig: "./tsconfig.attest.json"
})

const levelType = type("'low' | 'high'")
const levels = type.module({ Level: "'low' | 'high'" })

try {
  // ─── a deployer: the shape almost every internal cli grows ──────────────
  const deploy = program({
    name: "deploy",
    version: "1.0.0",
    // program-level options join every command's surfaces
    input: {
      "profile?": ["string", "@", { cli: { usage: "--profile", env: "DEPLOY_PROFILE" } }]
    },
    commands: {
      push: {
        description: "push a service build",
        input: {
          service: ["string", "@", { cli: "<service>" }],
          env: [
            [
              "'staging' | 'production'",
              "@",
              { cli: { usage: "--env, -e", env: "DEPLOY_ENV" } }
            ],
            "=",
            "staging"
          ],
          replicas: [["string.integer.parse", "@", { cli: "--replicas" }], "=", "2"],
          force: [["boolean", "@", { cli: "--force, -f" }], "=", false],
          "message?": ["string", "@", { cli: "--message, -m" }],
          token: [["string", "@", { cli: "--token", mcp: { hidden: true } }], "=", ""]
        },
        run: (input) => {
          // a bare handler: every type below comes from the declaration alone
          attest(input.service).type.toString.snap("string")
          attest(input.env).type.toString.snap("\"staging\" | \"production\"")
          attest(input.replicas).type.toString.snap("number")
          attest(input.force).type.toString.snap("boolean")
          attest(input.message).type.toString.snap("string | undefined")
          attest(input.profile).type.toString.snap("string | undefined")
          return { at: input.service, count: input.replicas }
        }
      },
      // a variadic states its own array; the notation only says how it is spelled
      bundle: {
        description: "bundle entries",
        input: {
          entries: ["string[] >= 1", "@", { cli: "<...entries>" }],
          "tag?": ["string[]", "@", { cli: "--tag <tags...>" }]
        },
        output: { count: "number" },
        run: (input) => {
          attest(input.entries).type.toString.snap("string[]")
          attest(input.tag).type.toString.snap("string[] | undefined")
          return { count: input.entries.length }
        }
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
      },
      // a Type instance reaches a command's input through `type.module`,
      // which keeps the declaration a plain ArkType definition
      tuned: {
        input: { level: [levels.Level, "@", { cli: "--level" }] },
        run: (input) => {
          attest(input.level).type.toString.snap("\"low\" | \"high\"")
          return input.level
        }
      }
    }
  })

  // the CALL surface is ArkType's input side: defaults and optional keys
  // may be omitted, and a morph accepts its own input domain
  attest(deploy.push({ service: "api" })).type.toString.snap("{ at: string; count: number }")
  attest(deploy.push({ service: "api", replicas: "5", env: "production" })).type.toString.snap("{ at: string; count: number }")
  attest(deploy.bundle({ entries: ["a.ts"] })).type.toString.snap("{ count: number }")
  attest(deploy.configure({ conf: { retries: 2, label: "x" } })).type.toString.snap("number")

  // a program-level option is callable on every command
  attest(deploy.push({ service: "api", profile: "eu" })).type.toString.snap("{ at: string; count: number }")

  // a Type instance carries its inference through the declaration
  attest(deploy.tuned({ level: "high" })).type.toString.snap("\"low\" | \"high\"")

  // ArkType itself infers a Type instance in an object definition …
  attest({} as type.infer.Out<{ a: typeof levelType }>).type.toString.snap("{ a: \"low\" | \"high\" }")
  // … and inside a "@" tuple
  attest({} as type.infer.Out<{ a: readonly [typeof levelType, "@", { cli: "--x" }] }>)
    .type.toString.snap("{ a: \"low\" | \"high\" }")

  // the args surface exposes the compiled value boundary. type-only: a
  // real assert({}) would throw, and this asserts the SHAPE it yields.
  attest(null as never as ReturnType<typeof deploy.push.args.assert>).type.toString.snap(`{
  service: string
  env: "staging" | "production"
  replicas: number
  force: boolean
  token: string
  profile?: string
  message?: string
}`)

  // ─── an external: the same contract over a binary ───────────────────────
  const git = external({
    name: "git",
    input: { "repo?": ["string", "@", { cli: "-C" }] },
    commands: {
      status: {
        description: "working tree status",
        input: { short: [["boolean", "@", { cli: "--short, -s" }], "=", false] },
        output: "string"
      },
      revParse: {
        description: "resolve a revision",
        input: { rev: ["string", "@", { cli: "<rev>" }] },
        output: "string"
      }
    }
  })

  // an external always crosses a process boundary, so it is always async.
  // type-only: executing these would spawn the binary.
  attest(null as never as ReturnType<typeof git.status>).type.toString.snap("Promise<string>")
  attest(null as never as ReturnType<typeof git.revParse>).type.toString.snap("Promise<string>")

  // ─── rejections: type-level only, never invoked ─────────────────────────
  const rejected = () => {
    // @ts-expect-error — `service` is required at the call boundary
    deploy.push({})
    // @ts-expect-error — a morph's input domain is a string, not a number
    deploy.push({ service: "api", replicas: 5 })
    // @ts-expect-error — not a member of the declared union
    deploy.push({ service: "api", env: "dev" })
    // @ts-expect-error — the structured parameter's shape is enforced
    deploy.configure({ conf: { retries: "two", label: "x" } })
    // @ts-expect-error — an external's required positional
    git.revParse({})

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
      // @ts-expect-error — cli takes a notation string or a config object
      commands: { c: { input: { x: ["string", "@", { cli: 7 }] } } }
    })
    // GAP in the patch's type half: a metadata `default` is INFERRED
    // correctly but not VALIDATED against the input domain. The "="
    // operator form is validated, through `defaultFor<type.infer.In<…>>`
    // in `validateIndexOneExpression`; the "@" branch has no equivalent.
    program({
      name: "bad4",
      commands: { c: { input: { n: [["string.integer.parse", "@", {}], "=", 1] } } }
    })
    // an external's declaration is validated the same way a program's is
    external({
      name: "badExternal",
      // @ts-expect-error — 'not.a.keyword' is unresolvable
      commands: { c: { input: { x: "not.a.keyword" } } }
    })
    external({
      name: "badExternal2",
      // @ts-expect-error — `nonsense` is not a declared metadata key
      commands: { c: { input: { x: ["string", "@", { nonsense: 1 }] } } }
    })
    external({
      name: "badExternal3",
      commands: {
        // @ts-expect-error — a nested subcommand is checked too
        c: { commands: { d: { input: { x: "also.not.real" } } } }
      }
    })

    program({
      name: "bad5",
      // @ts-expect-error — mcp takes `hidden`, not a misspelling of it
      commands: { c: { input: { x: ["string", "@", { mcp: { hiden: true } }] } } }
    })
  }
  void rejected
} finally {
  teardown()
}
