import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

describe("release", () => {
  it("plans a bump without writing on --dry-run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "repokit-"))
    const pkg = join(dir, "package.json")
    await writeFile(pkg, JSON.stringify({ name: "x", version: "1.2.3" }, null, 2))
    const plan = await repokit.release({ bump: "minor", pkg, dryRun: true })
    expect(plan).toEqual({ pkg, from: "1.2.3", to: "1.3.0", written: false })
    expect(JSON.parse(await readFile(pkg, "utf8")).version).toBe("1.2.3")
  })

  it("writes the bumped version for real", async () => {
    const dir = await mkdtemp(join(tmpdir(), "repokit-"))
    const pkg = join(dir, "package.json")
    await writeFile(pkg, JSON.stringify({ name: "x", version: "1.2.3" }, null, 2))
    const done = await repokit.release({ bump: "major", pkg })
    expect(done).toMatchObject({ from: "1.2.3", to: "2.0.0", written: true })
    expect(JSON.parse(await readFile(pkg, "utf8")).version).toBe("2.0.0")
  })

  it("throws eagerly on an unknown bump kind with the enum message", () => {
    // input validation is synchronous assert semantics, even though the
    // handler itself is async
    expect(() => repokit.release({ bump: "huge" as never, pkg: "./package.json" }))
      .toThrow(/"major", "minor" or "patch"/)
  })
})

describe("cli surface", () => {
  it("routes and exits cleanly", async () => {
    expect(await repokit.main(["--help"])).toBe(0)
    // a missing required positional is a usage error: exit 2
    expect(await repokit.main(["search"])).toBe(2)
  })

  it("answers the completion callback", async () => {
    await expect(repokit.cli.complete(["release", "m"])).resolves.toEqual(["major", "minor"])
  })

  it("runs completion generators against the real repo", async () => {
    const candidates = await repokit.cli.complete(["release", "--pkg", "apps/"])
    expect(candidates).toContain("apps/repokit/package.json")
  })

  it("completes check's filter with workspace package names", async () => {
    await expect(repokit.cli.complete(["check", "cmd"])).resolves.toContain("cmd-mesh")
  })
})
