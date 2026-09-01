import { describe, expect, it } from "vitest"
import { git } from "../src/git.js"

// These are the closed-distribution push and pull operations. A subtle
// argv difference would surface as a broken release, so the tokens are
// pinned here — `argv` is the reconstruction the spawn itself runs, so
// these assert the real command without touching the repository.

describe("the release-critical git argv", () => {
  it("deps sync fast-forwards main from origin", () => {
    expect(git.pull.argv({ ffOnly: true, remote: "origin", branch: "main" }))
      .toEqual(["pull", "--ff-only", "origin", "main"])
  })

  it("release push pushes the daily branch", () => {
    expect(git.push.argv({ remote: "origin", branch: "main" }))
      .toEqual(["push", "origin", "main"])
  })

  it("release sync fast-forwards main from release", () => {
    expect(git.pull.argv({ ffOnly: true, remote: "origin", branch: "release" }))
      .toEqual(["pull", "--ff-only", "origin", "release"])
  })

  it("release sync --merge merge-pulls when histories diverged", () => {
    expect(git.pull.argv({ noRebase: true, noEdit: true, remote: "origin", branch: "release" }))
      .toEqual(["pull", "--no-rebase", "--no-edit", "origin", "release"])
  })

  it("emits no pull flag that was not asked for", () => {
    expect(git.pull.argv({ remote: "origin", branch: "main" }))
      .toEqual(["pull", "origin", "main"])
  })
})

describe("the rest of the declared surface", () => {
  it("stages paths", () => {
    expect(git.add.argv({ paths: ["a.ts", "b.ts"] })).toEqual(["add", "a.ts", "b.ts"])
  })

  it("records a commit", () => {
    expect(git.commit.argv({ message: "fix: typings" }))
      .toEqual(["commit", "--message", "fix: typings"])
  })

  it("takes the lone required parameter bare", () => {
    expect(git.commit.argv("fix: typings")).toEqual(["commit", "--message", "fix: typings"])
  })

  it("reports status", () => {
    expect(git.status.argv({ short: true, branch: true }))
      .toEqual(["status", "--short", "--branch"])
  })
})
