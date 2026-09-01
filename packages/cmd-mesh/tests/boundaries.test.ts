import { afterEach, describe, expect, it } from "vitest"
import { mesh } from "../examples/mesh.js"
import { program } from "../src/index.js"
import { captureCli, captureJson } from "./fixtures/capture.js"
import { deploy, fragile, wrap } from "./fixtures/programs.js"

// The two boundaries.
//
// The contract's central claim is that one declaration serves argv strings
// and canonical values through the same handler. That only holds if both
// boundaries agree on every parameter shape, apply the same cross-field
// invariants, and fail the same way. These tests put the two side by side
// and demand the same answer.

/** what the cli handed the handler, read back through the rendered result */
const throughCli = async (
  program: { cli: { run(argv: ReadonlyArray<string>): Promise<number> } },
  argv: ReadonlyArray<string>
): Promise<unknown> => {
  const { code, out, err } = await captureCli(() => program.cli.run(argv))
  expect(code, `cli invocation failed: ${argv.join(" ")}\n${err}`).toBe(0)
  return JSON.parse(out)
}

describe("token and value boundaries agree", () => {
  it("agrees on a fully defaulted invocation", async () => {
    const cli = await throughCli(deploy, ["push", "api"])
    expect(cli).toEqual(deploy.push({ service: "api" }))
  })

  it("agrees on parsed integers", async () => {
    const cli = await throughCli(deploy, ["push", "api", "--replicas", "7"])
    expect(cli).toEqual(deploy.push({ service: "api", replicas: "7" }))
  })

  it("agrees on enum members", async () => {
    const cli = await throughCli(deploy, ["push", "api", "--env", "production"])
    expect(cli).toEqual(deploy.push({ service: "api", env: "production" }))
  })

  it("agrees on booleans set by presence", async () => {
    const cli = await throughCli(deploy, ["push", "api", "--force"])
    expect(cli).toEqual(deploy.push({ service: "api", force: true }))
  })

  it("agrees on short-only booleans", async () => {
    const cli = await throughCli(deploy, ["push", "api", "-w"])
    expect(cli).toEqual(deploy.push({ service: "api", watch: true }))
  })

  it("agrees on variadic positionals", async () => {
    const cli = await throughCli(wrap, ["exec", "node", "a.js", "b.js"])
    expect(cli).toEqual(wrap.exec({ tool: "node", args: ["a.js", "b.js"] }))
  })

  it("agrees on a Type-instance parameter", async () => {
    // the descriptor docs promise "a string def … or a Type instance";
    // a string-domain Type must take a plain token, never a JSON token
    const { program } = await import("../src/index.js")
    const { type } = await import("arktype")
    const inst = program({
      name: "inst",
      version: "0.0.0",
      commands: {
        go: {
          description: "go",
          input: { "port?": [type("string.integer.parse"), "@", { cli: "--port" }] },
          output: { "port?": "number" },
          run: (input: { port?: number }) =>
            input.port === undefined ? {} : { port: input.port }
        }
      }
    })
    const cli = await throughCli(inst, ["go", "--port", "8080"])
    expect(cli).toEqual({ port: 8080 })
    expect(cli).toEqual(inst.go({ port: "8080" }))
  })

  it("agrees on structured parameters given as a JSON token", async () => {
    const cli = await throughCli(mesh, [
      "snapshot",
      ".",
      "--sign-cert",
      "cert.pem",
      "--sign-key",
      "{\"a\":\"secret\"}"
    ])
    expect(cli).toEqual(
      mesh.snapshot({ directory: ".", signCert: "cert.pem", signKey: { a: "secret" } })
    )
  })
})

describe("handler-chosen exit codes", () => {
  // the diff/grep convention: a nonzero exit that is a REPORT, not a
  // failure. a thrown error carrying a numeric `exitCode` owns the cli
  // exit code, and its message prints bare — no "failed:" framing.
  const differ = program({
    name: "differ",
    version: "0.0.0",
    commands: {
      compare: {
        description: "compare",
        run: () => {
          throw Object.assign(new Error("3 differences"), { exitCode: 3 })
        }
      }
    }
  })

  it("exits with the carried code and prints the bare message", async () => {
    const { code, err } = await captureCli(() => differ.cli.run(["compare"]))
    expect(code).toBe(3)
    expect(err).toBe("3 differences")
  })

  it("keeps the typed surface throwing the framed HandlerFailure", () => {
    expect(() => differ.compare()).toThrow(/differ compare failed: 3 differences/)
  })
})

describe("the composed bin rejects a malformed mcp invocation", () => {
  it("errors on trailing tokens after the mcp word instead of serving", async () => {
    // `mytool mcp status` is a typo'd agent config — serving forever on
    // it hides the mistake. fail fast with the usage code.
    const code = await deploy.main(["mcp", "status"])
    expect(code).toBe(2)
  }, 5000)
})

describe("both boundaries enforce the same contract", () => {
  it("rejects an enum member neither boundary allows", async () => {
    const { code, err } = await captureCli(() => deploy.cli.run(["push", "api", "--env", "qa"]))
    expect(code).toBe(2)
    expect(err).toMatch(/env/)
    expect(() => deploy.push({ service: "api", env: "qa" as never })).toThrow(/env/)
  })

  it("applies a command-level narrow on both boundaries", async () => {
    const { code, err } = await captureCli(() => mesh.cli.run(["snapshot", ".", "--sign-cert", "c"]))
    expect(code).toBe(2)
    expect(err).toMatch(/--sign-cert and --sign-key together/)
    expect(() => mesh.snapshot({ directory: ".", signCert: "c" }))
      .toThrow(/--sign-cert and --sign-key together/)
  })

  it("enforces an output contract on both boundaries", async () => {
    const { code, err } = await captureCli(() => fragile.cli.run(["badOutput"]))
    expect(code).toBe(1)
    expect(err).toMatch(/output contract violated/)
    expect(() => fragile.badOutput()).toThrow(/output contract violated/)
  })

  it("rejects an empty required variadic on both boundaries", async () => {
    const { code } = await captureCli(() => wrap.cli.run(["exec", "node"]))
    expect(code).toBe(2)
    expect(() => wrap.exec({ tool: "node", args: [] })).toThrow(/args/)
  })
})

describe("the cli always resolves to an exit code", () => {
  // `cli(argv): Promise<number>` is the process contract. A rejected
  // promise there means an unhandled rejection instead of an exit status.

  it("resolves when a handler throws synchronously", async () => {
    await expect(fragile.cli.run(["boom"])).resolves.toBe(1)
  })

  it("resolves when a handler rejects", async () => {
    await expect(fragile.cli.run(["rejected"])).resolves.toBe(1)
  })

  it("resolves when the cli render hook throws", async () => {
    await expect(fragile.cli.run(["badRender"])).resolves.toBe(1)
  })

  it("resolves when a narrow predicate throws", async () => {
    await expect(fragile.cli.run(["badNarrow", "x"])).resolves.toBe(1)
  })

  it("resolves when the output contract is violated", async () => {
    await expect(fragile.cli.run(["badOutput"])).resolves.toBe(1)
  })

  it("resolves for an unknown subcommand with the usage code", async () => {
    await expect(fragile.cli.run(["nope"])).resolves.toBe(2)
  })
})

describe("error presentation", () => {
  it("keeps internal tag names out of stderr", async () => {
    const { err } = await captureCli(() => deploy.cli.run(["push", "api", "--nope"]))
    expect(err).toMatch(/unknown flag --nope/)
    expect(err).not.toMatch(/UnknownFlag/)
  })

  it("frames a handler failure once, not twice", () => {
    expect(() => fragile.boom()).toThrow(/fragile boom failed: handler exploded/)
    expect(() => fragile.boom()).not.toThrow(/Error: handler exploded/)
  })

  it("throws the exported InvalidInput from args.assert", async () => {
    const { InvalidInput } = await import("../src/index.js")
    expect(() => mesh.snapshot.args.assert({ depth: "x" })).toThrow(InvalidInput)
  })
})

describe("typed calls fail with the handler's own synchrony", () => {
  it("a sync handler throws; an async handler rejects", async () => {
    expect(() => fragile.boom()).toThrow(/handler exploded/)
    await expect(fragile.rejected()).rejects.toThrow(/handler rejected/)
  })

  it("throws when a narrow predicate throws during sync validation", () => {
    expect(() => fragile.badNarrow({ value: "x" })).toThrow(/narrow exploded/)
  })

  it("names the offending parameter when input is invalid", () => {
    expect(() => deploy.push({ service: 42 as never })).toThrow(/service/)
  })

  it("teaches when a command group is called as a function", () => {
    // a weak agent WILL call `deploy.config()` — the failure must teach
    expect(() => (deploy.config as unknown as () => unknown)()).toThrow(/not a runnable command/)
  })
})

describe("result presentation", () => {
  it("prints nothing for a command that produces no result", async () => {
    const { code, out } = await captureCli(() => fragile.cli.run(["noop"]))
    expect(code).toBe(0)
    expect(out.trim()).toBe("")
    const machine = await captureCli(() => fragile.cli.run(["noop", "--json"]))
    expect(machine.code).toBe(0)
    expect(machine.out.trim()).toBe("")
  })

  it("renders a list of records as aligned rows", async () => {
    const { code, out } = await captureCli(() => deploy.cli.run(["status"]))
    expect(code).toBe(0)
    expect(out).toBe("api     3\nworker  1")
  })

  it("emits machine-readable json when asked", async () => {
    const { code, out } = await captureCli(() => deploy.cli.run(["status", "--json"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual([
      { service: "api", replicas: 3 },
      { service: "worker", replicas: 1 }
    ])
  })
})

describe("invocations stay isolated across a long-lived module", () => {
  it("gives every invocation a fresh structured default", async () => {
    // an MCP server lives for hours — a handler mutating a defaulted
    // object must never corrupt the next call's default
    const { type } = await import("arktype")
    const configured = program({
      name: "configured",
      version: "0.0.0",
      commands: {
        tune: {
          description: "tune",
          input: {
            opts: [
              [
                type({ retries: "number" }),
                "@",
                { cli: "--opts" }
              ],
              "=",
              () => ({ retries: 1 })
            ]
          },
          output: { retries: "number" },
          // a defaulted key is PRESENT for the handler: `.default()` is the
          // ["=", value] tuple, so defaultness is now statically visible
          run: (input) => {
            const seen = input.opts.retries
            input.opts.retries = 99
            return { retries: seen }
          }
        }
      }
    })
    expect(configured.tune({})).toEqual({ retries: 1 })
    expect(configured.tune({})).toEqual({ retries: 1 })
    const cli = await captureJson(() => configured.cli.run(["tune", "--json"]))
    expect(cli).toEqual({ retries: 1 })
  })

  it("applies defaults before the narrow predicate runs", async () => {
    const gated = program({
      name: "gated",
      version: "0.0.0",
      commands: {
        go: {
          description: "go",
          input: { level: [["string.integer.parse", "@", { cli: "--level" }], "=", "2"] },
          narrow: (input: { readonly level: number }, ctx) =>
            input.level >= 1 || ctx.mustBe("at least 1"),
          output: { level: "number" },
          run: (input: { readonly level: number }) => ({ level: input.level })
        }
      }
    })
    expect(await captureJson(() => gated.cli.run(["go", "--json"]))).toEqual({ level: 2 })
  })
})

describe("failing morphs", () => {
  it("a morph reporting through ctx.error is a usage error naming the parameter", async () => {
    // the ArkType contract: fallible morphs return ctx.error — that IS
    // input validation, so the cli answers with the usage code
    const { type } = await import("arktype")
    const parser = program({
      name: "parser2",
      version: "0.0.0",
      commands: {
        load: {
          description: "load",
          input: {
            "manifest?": [
              type("string").pipe((s, ctx) =>
                s.endsWith(".json") ? s : ctx.error("a .json manifest path")),
              "@",
              { cli: "--manifest" }
            ]
          },
          run: (input: { readonly manifest?: unknown }) => input.manifest
        }
      }
    })
    const { code, err } = await captureCli(() => parser.cli.run(["load", "--manifest", "x"]))
    expect(code).toBe(2)
    expect(err).toMatch(/manifest/)
    const ok = await captureCli(() => parser.cli.run(["load", "--manifest", "a.json"]))
    expect(ok.code).toBe(0)
  })

  it("a THROWING morph is an author bug: crash-free runtime failure", async () => {
    const { type } = await import("arktype")
    const parser = program({
      name: "parser3",
      version: "0.0.0",
      commands: {
        load: {
          description: "load",
          input: {
            "manifest?": [
              type("string").pipe(() => {
                throw new Error("unreadable manifest")
              }),
              "@",
              { cli: "--manifest" }
            ]
          },
          run: () => "never"
        }
      }
    })
    const { code } = await captureCli(() => parser.cli.run(["load", "--manifest", "x"]))
    expect(code).toBe(1)
  })
})

describe("structured token errors name the inner path", () => {
  it("points at the failing nested key", async () => {
    const configured = program({
      name: "configured2",
      version: "0.0.0",
      commands: {
        tune: {
          description: "tune",
          input: { "opts?": [{ retries: "number" }, "@", { cli: "--opts" }] },
          run: (input) => input.opts
        }
      }
    })
    const { code, err } = await captureCli(() =>
      configured.cli.run(["tune", "--opts", "{\"retries\":\"x\"}"])
    )
    expect(code).toBe(2)
    expect(err).toMatch(/retries/)
  })
})

describe("environment fallback reaches the handler", () => {
  afterEach(() => {
    delete process.env["MESH_DEPTH"]
  })

  it("uses the declared variable when the flag is absent", async () => {
    // the advertised precedence is argv > env > default
    process.env["MESH_DEPTH"] = "5"
    const result = await throughCli(mesh, ["snapshot", "./public"])
    expect(result).toMatchObject({ depth: 5 })
  })

  it("does not reach a direct call — the fallback is cli machinery", async () => {
    // CMSH1015 in the bundled errors reference rests on this: env cannot supply a value
    // to an agent or a typed caller, only to the argv path
    process.env["MESH_DEPTH"] = "5"
    const result = await Promise.resolve(mesh.snapshot({ directory: "./public" }))
    expect(result).toMatchObject({ depth: 2 })
  })

  it("prefers an explicit flag over the variable", async () => {
    process.env["MESH_DEPTH"] = "5"
    const result = await throughCli(mesh, ["snapshot", "./public", "-d", "9"])
    expect(result).toMatchObject({ depth: 9 })
  })
})
