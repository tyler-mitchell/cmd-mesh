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
            "'staging' | 'production'",
            "@",
            { cli: { usage: "--env, -e", env: "DEPLOY_ENV" }, default: "staging" }
          ],
          replicas: ["string.integer.parse", "@", { cli: "--replicas", default: "2" }],
          force: ["boolean", "@", { cli: "--force, -f", default: false }],
          "message?": ["string", "@", { cli: "--message, -m" }],
          token: ["string", "@", { cli: "--token", mcp: { hidden: true }, default: "" }]
        },
        run: (input) => {
          // a bare handler: every type below comes from the declaration alone
          attest(input.service).type.toString.snap()
          attest(input.env).type.toString.snap()
          attest(input.replicas).type.toString.snap()
          attest(input.force).type.toString.snap()
          attest(input.message).type.toString.snap()
          attest(input.profile).type.toString.snap()
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
          attest(input.entries).type.toString.snap()
          attest(input.tag).type.toString.snap()
          return { count: input.entries.length }
        }
      },
      // a structured parameter is an ordinary nested ArkType object
      configure: {
        input: {
          conf: [{ retries: "number.integer", label: "string" }, "@", { cli: "--conf" }]
        },
        run: (input) => {
          attest(input.conf).type.toString.snap()
          return input.conf.retries
        }
      },
      // GAP: a Type instance inside a "@" tuple does NOT carry its
      // inference — `level` is absent from the handler's input type.
      tuned: {
        input: {
          level: [type("'low' | 'high'").describe("verbosity"), "@", { cli: "--level" }]
        },
        run: (input) => attest(input).type.toString.snap()
      }
    }
  })

  // the CALL surface is ArkType's input side: defaults and optional keys
  // may be omitted, and a morph accepts its own input domain
  attest(deploy.push({ service: "api" })).type.toString.snap()
  attest(deploy.push({ service: "api", replicas: "5", env: "production" })).type.toString.snap()
  attest(deploy.bundle({ entries: ["a.ts"] })).type.toString.snap()
  attest(deploy.configure({ conf: { retries: 2, label: "x" } })).type.toString.snap()

  // a program-level option is callable on every command
  attest(deploy.push({ service: "api", profile: "eu" })).type.toString.snap()

  // the args surface exposes the compiled value boundary
  attest(deploy.push.args.assert({})).type.toString.snap()

  // ─── an external: the same contract over a binary ───────────────────────
  const git = external({
    name: "git",
    input: { "repo?": ["string", "@", { cli: "-C" }] },
    commands: {
      status: {
        description: "working tree status",
        input: { short: ["boolean", "@", { cli: "--short, -s", default: false }] },
        output: "string"
      },
      revParse: {
        description: "resolve a revision",
        input: { rev: ["string", "@", { cli: "<rev>" }] },
        output: "string"
      }
    }
  })

  // an external always crosses a process boundary, so it is always async
  attest(git.status({})).type.toString.snap()
  attest(git.revParse({ rev: "HEAD", repo: "." })).type.toString.snap()

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
      commands: { c: { input: { n: ["string.integer.parse", "@", { default: 1 }] } } }
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
