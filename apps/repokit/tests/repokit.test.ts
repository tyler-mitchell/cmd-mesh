import { describe, expect, it } from "vitest"
import { repokit } from "../src/repokit.js"

// integration: the dogfood app against this actual repository.

describe("search", () => {
  it("finds a known string in the repo with structured results", async () => {
    const hits = await repokit.search({
      pattern: "orient an agent",
      glob: "apps/repokit/src/*.ts"
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]).toMatchObject({ file: "apps/repokit/src/repokit.ts" })
    expect(hits[0]!.line).toBeGreaterThan(0)
  })

  it("returns empty for no matches instead of failing", async () => {
    // assembled so this file itself can never match it
    const hits = await repokit.search({ pattern: ["zz-never", "present-zz", "9847"].join("-") })
    expect(hits).toEqual([])
  })
})

describe("context", () => {
  it("reports branch and dirty state, callable with no argument", async () => {
    const context = await repokit.context()
    expect(typeof context.branch).toBe("string")
    expect(Array.isArray(context.dirty)).toBe(true)
  })
})

describe("packages", () => {
  it("lists this workspace's packages with relative dirs", async () => {
    const packages = await repokit.packages()
    const names = packages.map((pkg) => pkg.name)
    expect(names).toContain("cmd-mesh")
    expect(names).toContain("repokit")
    const self = packages.find((pkg) => pkg.name === "repokit")
    expect(self).toMatchObject({ dir: "apps/repokit", version: "0.1.0" })
  })
})

describe("the operational surface (the closed-distribution contract)", () => {
  it("declares every contract operation as a command", () => {
    const paths = new Set<string>()
    const walk = (node: { path: ReadonlyArray<string>; commands: ReadonlyArray<never> }) => {
      paths.add(node.path.slice(1).join(" "))
      for (const child of node.commands as ReadonlyArray<typeof node>) walk(child)
    }
    walk(repokit.spec as never)
    for (
      const operation of [
        "ci list", "ci watch", "ci logs", "ci rerun", "ci cancel", "ci dispatch",
        "release add", "release check", "release status", "release push",
        "release promote pr", "release promote create", "release promote merge",
        "release pr", "release merge", "release update", "release registry-version", "release sync",
        "deps list", "deps merge", "deps close", "deps sync"
      ]
    ) {
      expect(paths, operation).toContain(operation)
    }
  })

  it("runs the real bumpy status through the typed surface", async () => {
    // state-independent: bumpy reports JSON whether or not bumps are
    // pending (exit 1 with none is a report, not a failure)
    const status = await repokit.release.status()
    const parsed = JSON.parse(status.text) as { packageNames: ReadonlyArray<string> }
    expect(Array.isArray(parsed.packageNames)).toBe(true)
  })

  it("runs the real strict bump check", async () => {
    const checked = await repokit.release.check()
    expect(checked.text).toMatch(/bump files|No managed packages have changed/)
  })

  it("exposes git as a typed external surface", async () => {
    // the 08 thesis live: git.status is a typed call over the binary
    const status = await repokit.git.status({ short: true })
    expect(status).toBeTypeOf("string")
    const log = await repokit.git.log({ oneline: true, count: "1" })
    expect(log.trimEnd().split("\n").length).toBe(1)
  })
})

describe("mcp surface", () => {
  it("hands an agent a real external's output as text, not as quoted json", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js")
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await repokit.mcp.server().connect(serverTransport)
    const client = new Client({ name: "witness", version: "0.0.0" })
    await client.connect(clientTransport)

    const called = await client.callTool({ name: "repokit_git_status", arguments: { short: true } })
    const text = (called.content as Array<{ text: string }>)[0]!.text
    expect(text.startsWith("\"")).toBe(false)
    expect(text).not.toMatch(/\\n/)
    expect(text).toBe(await repokit.git.status({ short: true }))
  })

  it("keeps terminal-bound operations off the agent surface", () => {
    const names = repokit.mcp.tools.map((tool) => tool.name)
    expect(names).toContain("repokit_release_status")
    expect(names).not.toContain("repokit_ci_watch")
    expect(names).not.toContain("repokit_release_add")
  })
})

describe("cli surface", () => {
  it("routes and exits cleanly", async () => {
    expect(await repokit.main(["--help"])).toBe(0)
    // a missing required positional is a usage error: exit 2
    expect(await repokit.main(["search"])).toBe(2)
  })

  it("completes the release procedure's subcommands", async () => {
    const words = await repokit.cli.complete(["release", ""])
    expect(words).toContain("status")
    expect(words).toContain("promote")
  })

  it("completes check's filter with workspace package names", async () => {
    await expect(repokit.cli.complete(["check", "cmd"])).resolves.toContain("cmd-mesh")
  })
})
