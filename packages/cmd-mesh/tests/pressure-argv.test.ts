import { afterAll, afterEach, describe, expect, it } from "vitest"
import { captureCli } from "./fixtures/capture.js"
import { bake, deploy, disposeAll, wrap } from "./fixtures/programs.js"

// Argv under pressure.
//
// Everything here is an invocation a real user types: a boolean short flag,
// a release note that happens to read like an option, arguments forwarded
// past `--` to a wrapped tool, an environment variable exported but empty.
// Each test asserts the behavior the contract promises, so a failure is a
// defect rather than a changed snapshot.

afterAll(() => disposeAll())

interface Program {
  main(argv: ReadonlyArray<string>): Promise<number>
}

/** run the cli, require success, and return the handler's rendered result */
const ok = async (program: Program, argv: ReadonlyArray<string>): Promise<any> => {
  const { code, out, err } = await captureCli(() => program.main(argv))
  expect(code, `expected success from: ${argv.join(" ")}\n${err}`).toBe(0)
  return JSON.parse(out)
}

/** run the cli, require failure, and return what the user was told */
const fails = async (program: Program, argv: ReadonlyArray<string>): Promise<string> => {
  const { code, out, err } = await captureCli(() => program.main(argv))
  expect(code, `expected failure from: ${argv.join(" ")}\n${out}`).toBe(1)
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
})

describe("flag and positional interleaving", () => {
  it("collects a variadic positional around interleaved flags", async () => {
    const result = await ok(wrap, ["exec", "node", "server.js", "--", "--port", "8080"])
    expect(result).toEqual({ tool: "node", args: ["server.js", "--port", "8080"] })
  })

  it("accepts a reserved global flag before the subcommand", async () => {
    // `deploy --json push api` is how every user writes a global flag
    const { code, out } = await captureCli(() => deploy.main(["--json", "push", "api"]))
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
    await expect(deploy.push({ service: "api" })).resolves.toMatchObject({ env: "staging" })
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
