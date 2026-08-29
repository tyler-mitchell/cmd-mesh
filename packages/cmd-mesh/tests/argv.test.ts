import { afterEach, describe, expect, it } from "vitest"
import { program } from "../src/index.js"
import { captureCli } from "./fixtures/capture.js"
import { bake, deploy, fragile, wrap } from "./fixtures/programs.js"

// The argv grammar.
//
// Everything here is an invocation a real user types: a boolean short flag,
// a release note that happens to read like an option, arguments forwarded
// past `--` to a wrapped tool, an environment variable exported but empty.
// Each test asserts the behavior the contract promises, so a failure is a
// defect rather than a changed snapshot.

interface Program {
  cli: { run(argv: ReadonlyArray<string>): Promise<number> }
}

/** run the cli, require success, and return the handler's rendered result */
const ok = async (program: Program, argv: ReadonlyArray<string>): Promise<any> => {
  const { code, out, err } = await captureCli(() => program.cli.run(argv))
  expect(code, `expected success from: ${argv.join(" ")}\n${err}`).toBe(0)
  return JSON.parse(out)
}

/** run the cli, require a usage failure (exit 2, the getopt convention),
 * and return what the user was told */
const fails = async (program: Program, argv: ReadonlyArray<string>): Promise<string> => {
  const { code, out, err } = await captureCli(() => program.cli.run(argv))
  expect(code, `expected usage failure from: ${argv.join(" ")}\n${out}`).toBe(2)
  return err
}

describe("boolean flags", () => {
  it("sets a long-form boolean by presence", async () => {
    expect(await ok(deploy, ["push", "api", "--force"])).toMatchObject({ force: true })
    expect(await ok(deploy, ["push", "api", "-f"])).toMatchObject({ force: true })
  })

  it("sets a short-only boolean by presence", async () => {
    // `-w` is the flag's own token. it must set the flag, never clear it.
    expect(await ok(deploy, ["push", "api", "-w"])).toMatchObject({ watch: true })
  })

  it("clears a boolean through its --no- negation", async () => {
    expect(await ok(deploy, ["push", "api", "--force", "--no-force"])).toMatchObject({ force: false })
  })

  it("accepts an explicit boolean value with =", async () => {
    // scripts and CI templates write `--force=false` to parameterize a flag
    expect(await ok(deploy, ["push", "api", "--force=true"])).toMatchObject({ force: true })
    expect(await ok(deploy, ["push", "api", "--force=false"])).toMatchObject({ force: false })
  })

  it("honors a declared --no-* flag over another flag's derived negation", async () => {
    // `--cache` derives `--no-cache`, but `--no-cache` is also declared in
    // its own right. the declared flag owns the token.
    expect(await ok(bake, ["run", "web", "--no-cache"])).toMatchObject({ noCache: true })
  })

  it("binds a boolean carrying an ArkType default by presence", async () => {
    expect(await ok(bake, ["run", "web", "--quiet"])).toMatchObject({ quiet: true })
    expect(await ok(bake, ["run", "web"])).toMatchObject({ quiet: false })
  })
})

describe("values that look like options", () => {
  it("accepts a flag value that reads like a reserved flag", async () => {
    // a release note is free text. `--json` and `--help` are legal content.
    expect(await ok(deploy, ["push", "api", "-m", "--json"])).toMatchObject({ message: "--json" })
    expect(await ok(deploy, ["push", "api", "-m", "--help"])).toMatchObject({ message: "--help" })
    expect(await ok(deploy, ["push", "api", "-m", "-h"])).toMatchObject({ message: "-h" })
  })

  it("forwards reserved-looking tokens past -- to a variadic positional", async () => {
    // every wrapper CLI must be able to forward `--help` to the tool it wraps
    const result = await ok(wrap, ["exec", "node", "--", "--help", "--json", "-h"])
    expect(result).toEqual({ tool: "node", args: ["--help", "--json", "-h"] })
  })

  it("treats a lone -- as the end of options, not as a value", async () => {
    const result = await ok(wrap, ["exec", "node", "--", "build", "--", "extra"])
    expect(result).toEqual({ tool: "node", args: ["build", "--", "extra"] })
  })

  it("accepts an empty string as a flag value", async () => {
    expect(await ok(deploy, ["push", "api", "-m", ""])).toMatchObject({ message: "" })
    expect(await ok(deploy, ["push", "api", "--message="])).toMatchObject({ message: "" })
  })

  it("preserves unicode and whitespace in values", async () => {
    const note = "ship 🚀 to prod  now"
    expect(await ok(deploy, ["push", "api", "-m", note])).toMatchObject({ message: note })
  })

  it("splits --flag=value only at the first =", async () => {
    expect(await ok(deploy, ["push", "api", "--message=a=b=c"])).toMatchObject({ message: "a=b=c" })
    expect(await ok(deploy, ["push", "api", "--message=🚀 ok"])).toMatchObject({ message: "🚀 ok" })
  })

  it("lets an open value slot consume a literal --", async () => {
    // getopt semantics: the value slot is already open; `--` is data
    expect(await ok(deploy, ["push", "api", "--message", "--"])).toMatchObject({ message: "--" })
  })

  it("binds an explicitly empty positional", async () => {
    expect(await ok(deploy, ["push", ""])).toMatchObject({ service: "" })
  })
})

describe("flag and positional interleaving", () => {
  it("collects a variadic positional around interleaved flags", async () => {
    const result = await ok(wrap, ["exec", "node", "server.js", "--", "--port", "8080"])
    expect(result).toEqual({ tool: "node", args: ["server.js", "--port", "8080"] })
  })

  it("accepts a reserved global flag before the subcommand", async () => {
    // `deploy --json push api` is how every user writes a global flag
    const { code, out } = await captureCli(() => deploy.cli.run(["--json", "push", "api"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ service: "api" })
  })

  it("lets the last occurrence of a repeated flag win", async () => {
    expect(await ok(deploy, ["push", "api", "--replicas", "1", "--replicas", "5"]))
      .toMatchObject({ replicas: 5 })
  })

  it("reports an option-shaped positional as a flag problem", async () => {
    // without `--`, `-5` is a flag by construction. the message must say so.
    const message = await fails(wrap, ["exec", "node", "-5"])
    expect(message).toMatch(/flag/i)
    expect(message).toMatch(/-5/)
  })
})

describe("environment fallback", () => {
  afterEach(() => {
    delete process.env["DEPLOY_ENV"]
  })

  it("fills an absent flag from its declared variable", async () => {
    process.env["DEPLOY_ENV"] = "production"
    expect(await ok(deploy, ["push", "api"])).toMatchObject({ env: "production" })
  })

  it("prefers argv over the environment", async () => {
    process.env["DEPLOY_ENV"] = "production"
    expect(await ok(deploy, ["push", "api", "--env", "staging"])).toMatchObject({ env: "staging" })
  })

  it("falls back to the declared default when the variable is exported empty", async () => {
    // CI writes `DEPLOY_ENV=` constantly; an empty export must not break the run
    process.env["DEPLOY_ENV"] = ""
    expect(await ok(deploy, ["push", "api"])).toMatchObject({ env: "staging" })
  })

  it("does not consult the environment on the value boundary", async () => {
    // documented asymmetry: `cli.env` is cli-surface configuration
    process.env["DEPLOY_ENV"] = "production"
    expect(deploy.push({ service: "api" })).toMatchObject({ env: "staging" })
  })
})

describe("short-option grammar (POSIX guideline 5)", () => {
  it("expands clustered boolean shorts", async () => {
    // `-fw` ≡ `-f -w`
    expect(await ok(deploy, ["push", "api", "-fw"])).toMatchObject({ force: true, watch: true })
  })

  it("takes an attached value on a short flag", async () => {
    // `-m'note'` ≡ `-m note`
    expect(await ok(deploy, ["push", "api", "-mhotfix"])).toMatchObject({ message: "hotfix" })
  })

  it("lets a trailing value-taking short consume the next token", async () => {
    // booleans first, value-taker last: `-fm note`
    expect(await ok(deploy, ["push", "api", "-fm", "hotfix"]))
      .toMatchObject({ force: true, message: "hotfix" })
  })

  it("fails the whole token when any char is not a declared short", async () => {
    const message = await fails(deploy, ["push", "api", "-fx"])
    expect(message).toMatch(/-fx/)
  })

  it("lets a trailing value-taker consume the cluster remainder", async () => {
    // POSIX guideline 5 in full: `-fmhotfix` ≡ `-f -m hotfix`
    expect(await ok(deploy, ["push", "api", "-fmhotfix"]))
      .toMatchObject({ force: true, message: "hotfix" })
  })

  it("takes an = value on a trailing value-taker inside a cluster", async () => {
    // `-fm=hotfix` ≡ `-f -m hotfix` — the remainder is an attached value
    expect(await ok(deploy, ["push", "api", "-fm=hotfix"]))
      .toMatchObject({ force: true, message: "hotfix" })
  })

  it("still rejects a numeric-looking token as a flag", async () => {
    // pinned decision: without `--`, `-5` is a flag by construction
    const message = await fails(wrap, ["exec", "node", "-5"])
    expect(message).toMatch(/-5/)
  })
})

describe("repeatable flags (commander value-slot notation)", () => {
  const tagger = program({
    name: "tagger",
    version: "0.0.0",
    description: "repeatable flags",
    commands: {
      mark: {
        description: "mark with tags",
        input: {
          item: ["string", "@", { cli: "<item>" }],
          tag: [
            ["string[]", "@", { description: "may repeat", cli: "--tag <tags...>, -t" }],
            "=",
            () => []
          ]
        },
        output: { item: "string", tags: "string[]" },
        run: (input) => ({ item: input.item, tags: [...input.tag] })
      }
    }
  })

  it("collects repeated occurrences into an array", async () => {
    expect(await ok(tagger, ["mark", "x", "--tag", "a", "-t", "b", "--tag=c"]))
      .toEqual({ item: "x", tags: ["a", "b", "c"] })
  })

  it("yields an empty array when omitted", async () => {
    expect(await ok(tagger, ["mark", "x"])).toEqual({ item: "x", tags: [] })
  })

  it("keeps last-wins for non-variadic flags", async () => {
    expect(await ok(deploy, ["push", "api", "-m", "one", "-m", "two"]))
      .toMatchObject({ message: "two" })
  })

  it("keeps the typed surface consistent", () => {
    expect(tagger.mark({ item: "x", tag: ["a", "b"] })).toEqual({ item: "x", tags: ["a", "b"] })
    expect(tagger.mark({ item: "x" })).toEqual({ item: "x", tags: [] })
  })

  it("wraps an environment value for a repeatable flag like one occurrence", async () => {
    // CI exports one value; that is `--tag <value>` once, never a crash
    const envTagger = program({
      name: "env-tagger",
      version: "0.0.0",
      commands: {
        mark: {
          description: "mark",
          input: {
            item: ["string", "@", { cli: "<item>" }],
            tag: [
              ["string[]", "@", { cli: "--tag <tags...>", env: "MARK_TAG" }],
              "=",
              () => []
            ]
          },
          output: { tags: "string[]" },
          run: (input) => ({ tags: [...input.tag] })
        }
      }
    })
    process.env["MARK_TAG"] = "from-env"
    try {
      expect(await ok(envTagger, ["mark", "x"])).toEqual({ tags: ["from-env"] })
    } finally {
      delete process.env["MARK_TAG"]
    }
  })
})

describe("positional notations", () => {
  const files = program({
    name: "files",
    version: "0.0.0",
    description: "every positional notation",
    commands: {
      show: {
        description: "optional positional",
        input: { "path?": ["string", "@", { cli: "[path]" }] },
        output: { "path?": "string" },
        run: (input) => (input.path === undefined ? {} : { path: input.path })
      },
      pack: {
        description: "optional variadic",
        input: { entries: [["string[]", "@", { cli: "[...entries]" }], "=", () => []] },
        output: { count: "number" },
        run: (input) => ({ count: input.entries.length })
      }
    }
  })

  it("accepts and omits an optional positional", async () => {
    expect(await ok(files, ["show", "a.txt"])).toEqual({ path: "a.txt" })
    expect(await ok(files, ["show"])).toEqual({})
  })

  it("treats a bare dash as an operand, the stdin convention", async () => {
    expect(await ok(files, ["show", "-"])).toEqual({ path: "-" })
  })

  it("collects an optional variadic, empty when omitted", async () => {
    expect(await ok(files, ["pack", "a", "b"])).toEqual({ count: 2 })
    // `[...entries]` means zero is fine — unlike `<...entries>`
    expect(await ok(files, ["pack"])).toEqual({ count: 0 })
  })

  it("keeps the typed surface consistent with the cli", () => {
    expect(files.pack({})).toEqual({ count: 0 })
    expect(files.pack({ entries: ["a"] })).toEqual({ count: 1 })
  })

  // Declaration order IS argv order. The two programs below differ in
  // nothing else, so if order stopped deciding the slot they would parse
  // the same and this fails. A reader-back of parameter order from a
  // parsed arktype type would break this: arktype sorts its keys.
  it("fills positional slots in the order the parameters are declared", async () => {
    const twoWay = (input: Record<string, unknown>) =>
      program({
        name: "order",
        version: "0.0.0",
        commands: {
          go: {
            description: "two positionals",
            input: input as never,
            output: { head: "string", tail: "string" },
            run: (parsed: { readonly head: string; readonly tail: string }) => parsed
          }
        }
      })
    const head = ["string", "@", { cli: "<head>" }]
    const tail = ["string", "@", { cli: "<tail>" }]

    expect(await ok(twoWay({ head, tail }), ["go", "a", "b"]))
      .toEqual({ head: "a", tail: "b" })
    expect(await ok(twoWay({ tail, head }), ["go", "a", "b"]))
      .toEqual({ tail: "a", head: "b" })
  })
})

describe("required parameters", () => {
  it("rejects an invocation missing a required flag", async () => {
    // `--yes` gates a destructive rollback; omitting it must not proceed
    const message = await fails(deploy, ["rollback", "api", "--to", "r1"])
    expect(message).toMatch(/yes/)
  })

  it("proceeds once the required flag is supplied", async () => {
    expect(await ok(deploy, ["rollback", "api", "--to", "r1", "--yes"]))
      .toMatchObject({ confirmed: true })
  })

  it("rejects a missing required positional with a message naming it", async () => {
    const message = await fails(deploy, ["push"])
    expect(message).toMatch(/service/)
  })
})

describe("usage errors teach the fix", () => {
  // the clap convention: every exit-2 error carries the routed command's
  // usage line and a --help pointer, so one failed invocation is enough
  // to self-correct
  it("appends the usage line to a missing-positional error", async () => {
    const message = await fails(deploy, ["push"])
    expect(message).toMatch(/Usage: deploy push/)
    expect(message).toMatch(/deploy push --help/)
  })

  it("appends the usage line to an unknown-flag error", async () => {
    const message = await fails(deploy, ["push", "api", "--bogus"])
    expect(message).toMatch(/Usage: deploy push/)
  })

  it("points at the parent's usage for an unknown command", async () => {
    const message = await fails(deploy, ["pusj", "api"])
    expect(message).toMatch(/push/) // did-you-mean
    expect(message).toMatch(/Usage: deploy/)
  })

  it("keeps runtime failures bare — no usage noise on exit 1", async () => {
    const { code, err } = await captureCli(() => fragile.cli.run(["boom"]))
    expect(code).toBe(1)
    expect(err).not.toMatch(/Usage:/)
  })
})
