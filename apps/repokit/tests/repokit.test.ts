import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { repokit } from "../src/repokit.js"

// integration: the dogfood app against this actual repository.

afterAll(() => repokit.dispose())

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

  it("rejects an unknown bump kind with the enum message", async () => {
    await expect(repokit.release({ bump: "huge" as never, pkg: "./package.json" }))
      .rejects.toThrow(/"major", "minor" or "patch"/)
  })
})

describe("cli surface", () => {
  it("routes and exits cleanly", async () => {
    expect(await repokit.main(["--help"])).toBe(0)
    expect(await repokit.main(["search"])).toBe(1)
  })

  it("answers the completion callback", async () => {
    await expect(repokit.complete(["release", "m"])).resolves.toEqual(["major", "minor"])
  })

  it("runs completion generators against the real repo", async () => {
    const candidates = await repokit.complete(["release", "--pkg", "apps/"])
    expect(candidates).toContain("apps/repokit/package.json")
  })
})
