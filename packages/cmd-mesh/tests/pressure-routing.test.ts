import { Effect } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { routeArgv } from "../src/argv.js"
import type { CompiledCommand } from "../src/compile.js"
import { mounted } from "../src/types.js"
import { captureCli } from "./fixtures/capture.js"
import { deploy, disposeAll, tasks } from "./fixtures/programs.js"

// Routing under pressure.
//
// A program's own vocabulary competes with the reserved tokens the CLI
// projection claims. A task runner has a task named `mcp`; a config group
// has a mistyped subcommand. Routing decisions are asserted directly where
// running them would block (serving MCP never returns).

afterAll(() => disposeAll())

const compiledOf = (program: unknown): CompiledCommand =>
  (program as { readonly [mounted]: CompiledCommand })[mounted]

const routed = (root: CompiledCommand, argv: ReadonlyArray<string>) =>
  Effect.runPromise(routeArgv(root, argv))

describe("reserved tokens versus program vocabulary", () => {
  const root = compiledOf(tasks)

  it("runs a task literally named mcp", async () => {
    // `tasks mcp` names a task. serving MCP is `tasks` with no task at all.
    const result = await routed(root, ["mcp"])
    expect(result._tag).toBe("run")
  })

  it("runs a task literally named completion", async () => {
    const { code, out } = await captureCli(() => tasks.main(["completion"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ ran: "completion" })
  })

  it("runs a task literally named __complete", async () => {
    const { code, out } = await captureCli(() => tasks.main(["__complete"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ ran: "__complete" })
  })

  it("still serves the reserved surfaces when no positional competes", async () => {
    const result = await routed(compiledOf(deploy), ["mcp"])
    expect(result._tag).toBe("mcp")
  })
})

describe("unknown command diagnostics", () => {
  it("suggests a sibling for a mistyped root subcommand", async () => {
    const { code, err } = await captureCli(() => deploy.main(["pish", "api"]))
    expect(code).toBe(1)
    expect(err).toMatch(/unknown command/)
    expect(err).toMatch(/push/)
  })

  it("suggests a sibling for a mistyped nested subcommand", async () => {
    // `deploy config shwo` is a wrong command, not a stray argument
    const { code, err } = await captureCli(() => deploy.main(["config", "shwo"]))
    expect(code).toBe(1)
    expect(err).toMatch(/unknown command/)
    expect(err).toMatch(/show/)
  })

  it("suggests a sibling for a mistyped flag", async () => {
    const { code, err } = await captureCli(() => deploy.main(["push", "api", "--forse"]))
    expect(code).toBe(1)
    expect(err).toMatch(/unknown flag/)
    expect(err).toMatch(/--force/)
  })
})

describe("group commands", () => {
  it("prints help for a group invoked bare", async () => {
    const { code, out } = await captureCli(() => deploy.main(["config"]))
    expect(code).toBe(0)
    expect(out).toMatch(/show/)
    expect(out).toMatch(/set/)
  })

  it("routes through a group to a leaf with positionals", async () => {
    const { code, out } = await captureCli(() => deploy.main(["config", "set", "region", "us-east"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ region: "us-east" })
  })
})

describe("argv preamble", () => {
  it("drops the separator that package runners prepend", async () => {
    const { code, out } = await captureCli(() => deploy.main(["--", "push", "api"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ service: "api" })
  })
})

describe("help projection", () => {
  it("renders help for each depth of the tree", () => {
    expect(deploy.help()).toMatch(/ship services to an environment/)
    expect(deploy.help(["push"])).toMatch(/push a service build/)
    expect(deploy.help(["config", "show"])).toMatch(/print the resolved config/)
  })

  it("distinguishes an unresolvable help path from its parent", () => {
    // a consumer building a help UI must be able to tell a typo from a hit
    expect(deploy.help(["config", "nope"])).not.toBe(deploy.help(["config"]))
  })

  it("documents required flags and defaults in the rendered help", () => {
    const help = deploy.help(["push"])
    expect(help).toMatch(/--replicas/)
    expect(help).toMatch(/default: 2/)
    expect(help).toMatch(/--env, -e/)
    expect(help).toMatch(/possible values: production, staging/)
  })
})
