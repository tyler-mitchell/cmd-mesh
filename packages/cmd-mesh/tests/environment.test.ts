import { describe, expect, it, vi } from "vitest"

// Runtime-environment contract: cmd-mesh supports Node >=22, and
// util.getCallSites only exists from 22.9. The whole surface — including
// the package-management toolkit it re-exports — must load and run where
// that API is absent. This probe holds the line against any dependency
// reintroducing a link-time crash on it.
vi.mock("node:util", async (importOriginal) => {
  const util = await importOriginal<typeof import("node:util")>()
  const { getCallSites: _absent, ...without } = util as typeof util & {
    getCallSites?: unknown
  }
  return { ...without, default: without }
})

// these two import the whole surface fresh under a module mock, so they
// pay a cold import while every other worker is importing too; the
// default 5s timeout trips on contention, not on a real regression.
describe("node 22.0–22.8 (no util.getCallSites)", { timeout: 30_000 }, () => {
  it("loads the full surface and runs a typed call", async () => {
    const { program } = await import("../src/index.js")
    const tool = program({
      name: "envtool",
      version: "0.0.0",
      commands: {
        ping: { description: "ping", output: { ok: "boolean" }, run: () => ({ ok: true }) }
      }
    })
    expect(tool.ping()).toEqual({ ok: true })
  })

  it("answers repository questions through ctx with an explicit anchor", async () => {
    const { program } = await import("../src/index.js")
    const who = program({
      name: "who",
      version: "0.0.0",
      commands: {
        ami: {
          description: "package identity",
          output: { name: "string" },
          run: (_input, ctx) => ({ name: ctx.project("<package_folder>").packageName ?? "" })
        }
      }
    })
    expect(await Promise.resolve(who.ami())).toEqual({ name: "cmd-mesh" })
  })
})
