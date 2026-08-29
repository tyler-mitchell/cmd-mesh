import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { routeArgv } from "../src/argv.js"
import type { CompiledCommand } from "../src/compile.js"
import { mounted } from "../src/types.js"
import { program } from "../src/index.js"
import { captureCli } from "./fixtures/capture.js"
import { deploy, tasks } from "./fixtures/programs.js"

// Routing.
//
// A program's own vocabulary competes with the reserved tokens the CLI
// projection claims. A task runner has a task named `mcp`; a config group
// has a mistyped subcommand. Routing decisions are asserted directly where
// running them would block (serving MCP never returns).

const compiledOf = (program: unknown): CompiledCommand =>
  (program as { readonly [mounted]: CompiledCommand })[mounted]

const routed = (root: CompiledCommand, argv: ReadonlyArray<string>) =>
  Effect.runPromise(routeArgv(root, argv))

describe("a group with a default child and its own flags", () => {
  const vite = program({
    name: "vite",
    commands: {
      serve: {
        input: { port: { type: "string", cli: "--port" } },
        cli: { default: "dev" },
        commands: {
          dev: {
            input: { port: { type: "string", cli: "--port" } },
            output: { ran: "string", port: "string" },
            run: (input: { readonly port?: string }) => ({ ran: "dev", port: input.port ?? "none" })
          }
        }
      }
    }
  })

  it("routes a flag the group itself declares", async () => {
    const { code, out } = await captureCli(() => vite.cli.run(["serve", "--port", "3000", "--json"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ ran: "dev", port: "3000" })
  })

  const withGroupOnlyFlag = program({
    name: "vite2",
    commands: {
      serve: {
        input: { config: { type: "string", cli: "--config" } },
        cli: { default: "dev" },
        commands: {
          dev: {
            output: { ran: "string" },
            run: () => ({ ran: "dev" })
          }
        }
      }
    }
  })

  it("reports a group flag the default child never declares", async () => {
    const { code, err } = await captureCli(() =>
      withGroupOnlyFlag.cli.run(["serve", "--config", "vite.config.ts", "--json"]))
    expect(code).toBe(2)
    expect(err).toMatch(/unknown flag --config/)
    expect(err).toMatch(/Usage: vite2 serve dev/)
  })
})

describe("reserved tokens versus program vocabulary", () => {
  const root = compiledOf(tasks)

  it("runs a task literally named mcp", async () => {
    // `tasks mcp` names a task. serving MCP is `tasks` with no task at all.
    const result = await routed(root, ["mcp"])
    expect(result._tag).toBe("run")
  })

  it("runs a task literally named completion", async () => {
    const { code, out } = await captureCli(() => tasks.cli.run(["completion"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ ran: "completion" })
  })

  it("runs a task literally named __complete", async () => {
    const { code, out } = await captureCli(() => tasks.cli.run(["__complete"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ ran: "__complete" })
  })

  it("owns no mcp word: the cli projection treats it as vocabulary", async () => {
    // serving mcp belongs to the composed bin (main) and mcp.serve() —
    // for the cli projection, `mcp` is a plain (here mistyped) subcommand
    await expect(routed(compiledOf(deploy), ["mcp"])).rejects.toMatchObject({
      _tag: "CommandNotFound"
    })
  })

  it("still answers the completion protocol when no positional competes", async () => {
    const result = await routed(compiledOf(deploy), ["complete", "--", ""])
    expect(result._tag).toBe("complete")
  })

  it("answers --version after a subcommand, the clap/cobra placement", async () => {
    const { code, out } = await captureCli(() => deploy.cli.run(["push", "--version"]))
    expect(code).toBe(0)
    expect(out).toBe("2.1.0")
  })

  it("rejects an unsupported completion shell with a usage error", async () => {
    const { code, err } = await captureCli(() => deploy.cli.run(["complete", "klingon"]))
    expect(code).not.toBe(0)
    expect(err.length).toBeGreaterThan(0)
  })

  it("lets help win when --help and --json are both asked", async () => {
    const { code, out } = await captureCli(() => deploy.cli.run(["push", "--help", "--json"]))
    expect(code).toBe(0)
    expect(out).toMatch(/Usage:/)
  })
})

describe("unknown command diagnostics", () => {
  it("suggests a sibling for a mistyped root subcommand", async () => {
    const { code, err } = await captureCli(() => deploy.cli.run(["pish", "api"]))
    expect(code).toBe(2)
    expect(err).toMatch(/unknown command/)
    expect(err).toMatch(/push/)
  })

  it("suggests a sibling for a mistyped nested subcommand", async () => {
    // `deploy config shwo` is a wrong command, not a stray argument
    const { code, err } = await captureCli(() => deploy.cli.run(["config", "shwo"]))
    expect(code).toBe(2)
    expect(err).toMatch(/unknown command/)
    expect(err).toMatch(/show/)
  })

  it("suggests a sibling for a mistyped flag", async () => {
    const { code, err } = await captureCli(() => deploy.cli.run(["push", "api", "--forse"]))
    expect(code).toBe(2)
    expect(err).toMatch(/unknown flag/)
    expect(err).toMatch(/--force/)
  })

  it("suggests the alias the user almost typed", async () => {
    // the resolver accepts `ws`; the suggestion pool speaks the same
    // vocabulary — `wz` is one edit from `ws`
    const pm = program({
      name: "pm2",
      version: "0.0.0",
      commands: {
        workspace: {
          description: "workspace ops",
          cli: { alias: "ws" },
          commands: {
            list: { description: "list", output: { ok: "boolean" }, run: () => ({ ok: true }) }
          }
        }
      }
    })
    const { code, err } = await captureCli(() => pm.cli.run(["wz"]))
    expect(code).toBe(2)
    expect(err).toMatch(/ws/)
  })
})

describe("group commands", () => {
  it("prints help for a group invoked bare", async () => {
    const { code, out } = await captureCli(() => deploy.cli.run(["config"]))
    expect(code).toBe(0)
    expect(out).toMatch(/show/)
    expect(out).toMatch(/set/)
  })

  it("routes through a group to a leaf with positionals", async () => {
    const { code, out } = await captureCli(() => deploy.cli.run(["config", "set", "region", "us-east"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ region: "us-east" })
  })
})

describe("argv preamble", () => {
  it("drops the separator that package runners prepend", async () => {
    const { code, out } = await captureCli(() => deploy.cli.run(["--", "push", "api"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ service: "api" })
  })
})

describe("help projection", () => {
  it("renders help for each depth of the tree", () => {
    expect(deploy.cli.help()).toMatch(/ship services to an environment/)
    expect(deploy.cli.help(["push"])).toMatch(/push a service build/)
    expect(deploy.cli.help(["config", "show"])).toMatch(/print the resolved config/)
  })

  it("names the unresolvable word in a bad help path", () => {
    // a consumer building a help UI must be able to tell a typo from a hit
    expect(deploy.cli.help(["config", "nope"])).toMatch(/unknown command: nope/)
    expect(deploy.cli.help(["config"])).not.toMatch(/unknown command/)
  })

  it("marks a group's default child in help", () => {
    // `vite` running `dev` bare is behavior the help screen must state —
    // spec carries defaultCommand; help is the human projection of it
    const dev = program({
      name: "devkit2",
      version: "0.0.0",
      cli: { default: "dev" },
      commands: {
        dev: { description: "start dev mode", output: { ok: "boolean" }, run: () => ({ ok: true }) },
        build: { description: "build once", output: { ok: "boolean" }, run: () => ({ ok: true }) }
      }
    })
    expect(dev.cli.help()).toMatch(/dev.*\(default\)/)
  })

  it("documents required flags and defaults in the rendered help", () => {
    const help = deploy.cli.help(["push"])
    expect(help).toMatch(/--replicas/)
    expect(help).toMatch(/default: 2/)
    expect(help).toMatch(/--env, -e/)
    expect(help).toMatch(/possible values: production, staging/)
  })
})
