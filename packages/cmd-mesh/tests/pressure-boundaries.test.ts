import { afterAll, afterEach, describe, expect, it } from "vitest"
import { mesh } from "../examples/mesh.js"
import { captureCli } from "./fixtures/capture.js"
import { deploy, disposeAll, fragile, wrap } from "./fixtures/programs.js"

// The two boundaries under pressure.
//
// The contract's central claim is that one declaration serves argv strings
// and canonical values through the same handler. That only holds if both
// boundaries agree on every parameter shape, apply the same cross-field
// invariants, and fail the same way. These tests put the two side by side
// and demand the same answer.

afterAll(async () => {
  await disposeAll()
  await mesh.dispose()
})

/** what the cli handed the handler, read back through the rendered result */
const throughCli = async (
  program: { main(argv: ReadonlyArray<string>): Promise<number> },
  argv: ReadonlyArray<string>
): Promise<unknown> => {
  const { code, out, err } = await captureCli(() => program.main(argv))
  expect(code, `cli invocation failed: ${argv.join(" ")}\n${err}`).toBe(0)
  return JSON.parse(out)
}

describe("token and value boundaries agree", () => {
  it("agrees on a fully defaulted invocation", async () => {
    const cli = await throughCli(deploy, ["push", "api"])
    const call = await deploy.push({ service: "api" })
    expect(cli).toEqual(call)
  })

  it("agrees on parsed integers", async () => {
    const cli = await throughCli(deploy, ["push", "api", "--replicas", "7"])
    const call = await deploy.push({ service: "api", replicas: 7 })
    expect(cli).toEqual(call)
  })

  it("agrees on enum members", async () => {
    const cli = await throughCli(deploy, ["push", "api", "--env", "production"])
    const call = await deploy.push({ service: "api", env: "production" })
    expect(cli).toEqual(call)
  })

  it("agrees on booleans set by presence", async () => {
    const cli = await throughCli(deploy, ["push", "api", "--force"])
    const call = await deploy.push({ service: "api", force: true })
    expect(cli).toEqual(call)
  })

  it("agrees on short-only booleans", async () => {
    const cli = await throughCli(deploy, ["push", "api", "-w"])
    const call = await deploy.push({ service: "api", watch: true })
    expect(cli).toEqual(call)
  })

  it("agrees on variadic positionals", async () => {
    const cli = await throughCli(wrap, ["exec", "node", "a.js", "b.js"])
    const call = await wrap.exec({ tool: "node", args: ["a.js", "b.js"] })
    expect(cli).toEqual(call)
  })

  it("agrees on structured parameters given as a JSON token", async () => {
    const cli = await throughCli(mesh, [
      "serve",
      ".",
      "--tls-cert",
      "cert.pem",
      "--tls-key",
      "{\"a\":\"secret\"}"
    ])
    const call = await mesh.serve({ directory: ".", tlsCert: "cert.pem", tlsKey: { a: "secret" } })
    expect(cli).toEqual(call)
  })
})

describe("both boundaries enforce the same contract", () => {
  it("rejects an enum member neither boundary allows", async () => {
    const { code, err } = await captureCli(() => deploy.main(["push", "api", "--env", "qa"]))
    expect(code).toBe(1)
    expect(err).toMatch(/env/)
    await expect(deploy.push({ service: "api", env: "qa" as never })).rejects.toThrow(/env/)
  })

  it("applies a command-level narrow on both boundaries", async () => {
    const { code, err } = await captureCli(() => mesh.main(["serve", ".", "--tls-cert", "c"]))
    expect(code).toBe(1)
    expect(err).toMatch(/--tls-cert and --tls-key together/)
    await expect(mesh.serve({ directory: ".", tlsCert: "c" }))
      .rejects.toThrow(/--tls-cert and --tls-key together/)
  })

  it("enforces an output contract on both boundaries", async () => {
    const { code, err } = await captureCli(() => fragile.main(["badOutput"]))
    expect(code).toBe(1)
    expect(err).toMatch(/output contract violated/)
    await expect(fragile.badOutput()).rejects.toThrow(/output contract violated/)
  })

  it("rejects an empty required variadic on both boundaries", async () => {
    const { code } = await captureCli(() => wrap.main(["exec", "node"]))
    expect(code).toBe(1)
    await expect(wrap.exec({ tool: "node", args: [] })).rejects.toThrow(/args/)
  })
})

describe("main always resolves to an exit code", () => {
  // `main(argv): Promise<number>` is the process contract. A rejected
  // promise there means an unhandled rejection instead of an exit status.

  it("resolves when a handler throws synchronously", async () => {
    await expect(fragile.main(["boom"])).resolves.toBe(1)
  })

  it("resolves when a handler rejects", async () => {
    await expect(fragile.main(["rejected"])).resolves.toBe(1)
  })

  it("resolves when the cli render hook throws", async () => {
    await expect(fragile.main(["badRender"])).resolves.toBe(1)
  })

  it("resolves when a narrow predicate throws", async () => {
    await expect(fragile.main(["badNarrow", "x"])).resolves.toBe(1)
  })

  it("resolves when the output contract is violated", async () => {
    await expect(fragile.main(["badOutput"])).resolves.toBe(1)
  })

  it("resolves for an unknown subcommand", async () => {
    await expect(fragile.main(["nope"])).resolves.toBe(1)
  })
})

describe("direct calls surface failures as rejections", () => {
  it("rejects rather than throwing synchronously", async () => {
    await expect(fragile.boom()).rejects.toThrow(/handler exploded/)
    await expect(fragile.rejected()).rejects.toThrow(/handler rejected/)
  })

  it("rejects when a narrow predicate throws", async () => {
    await expect(fragile.badNarrow({ value: "x" })).rejects.toThrow(/narrow exploded/)
  })

  it("names the offending parameter when input is invalid", async () => {
    await expect(deploy.push({ service: 42 as never })).rejects.toThrow(/service/)
  })
})

describe("result presentation", () => {
  it("prints nothing for a command that produces no result", async () => {
    const { code, out } = await captureCli(() => fragile.main(["noop"]))
    expect(code).toBe(0)
    expect(out.trim()).toBe("")
  })

  it("renders a list of records as aligned rows", async () => {
    const { code, out } = await captureCli(() => deploy.main(["status"]))
    expect(code).toBe(0)
    expect(out).toBe("api     3\nworker  1")
  })

  it("emits machine-readable json when asked", async () => {
    const { code, out } = await captureCli(() => deploy.main(["status", "--json"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual([
      { service: "api", replicas: 3 },
      { service: "worker", replicas: 1 }
    ])
  })
})

describe("environment fallback reaches the handler", () => {
  afterEach(() => {
    delete process.env["MESH_PORT"]
  })

  it("uses the declared variable when the flag is absent", async () => {
    // the advertised precedence is argv > env > default
    process.env["MESH_PORT"] = "4444"
    const result = await throughCli(mesh, ["serve", "./public"])
    expect(result).toMatchObject({ port: 4444 })
  })

  it("prefers an explicit flag over the variable", async () => {
    process.env["MESH_PORT"] = "4444"
    const result = await throughCli(mesh, ["serve", "./public", "-p", "8080"])
    expect(result).toMatchObject({ port: 8080 })
  })
})
