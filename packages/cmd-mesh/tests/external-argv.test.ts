import { describe, expect, it } from "vitest"
import { external } from "../src/index.js"

// `argv` is the reconstruction runExternal itself executes, exposed
// without the spawn — so a witness can assert the exact tokens a
// wrapped binary receives.

const git = external({
  name: "git",
  input: { "repo?": ["string", "@", { cli: "-C" }] },
  commands: {
    status: {
      input: { short: [["boolean", "@", { cli: "--short, -s" }], "=", false] },
      output: "string"
    },
    commit: {
      input: {
        message: ["string", "@", { cli: "--message, -m" }],
        all: [["boolean", "@", { cli: "--all, -a" }], "=", false]
      },
      output: "string"
    },
    push: {
      input: {
        "remote?": ["string", "@", { cli: "[remote]" }],
        "branch?": ["string", "@", { cli: "[branch]" }],
        force: [["boolean", "@", { cli: "--force" }], "=", false]
      },
      output: "string"
    },
    revParse: {
      input: { rev: ["string", "@", { cli: "<rev>" }] },
      output: "string"
    },
    add: {
      input: { paths: ["string[] >= 1", "@", { cli: "<...paths>" }] },
      output: "string"
    }
  }
})

describe("an external's emitted argv", () => {
  it("puts the subcommand first", () => {
    expect(git.status({})).toBeInstanceOf(Promise)
    expect(git.status.argv({})).toEqual(["status"])
  })

  it("omits a false boolean and emits a true one", () => {
    expect(git.status.argv({ short: false })).toEqual(["status"])
    expect(git.status.argv({ short: true })).toEqual(["status", "--short"])
  })

  it("emits a flag with its value", () => {
    expect(git.commit.argv({ message: "fix: typings" }))
      .toEqual(["commit", "--message", "fix: typings"])
  })

  it("accepts the shorthand call form", () => {
    expect(git.commit.argv("fix: typings")).toEqual(git.commit.argv({ message: "fix: typings" }))
  })

  it("places a binary-global option BEFORE the subcommand", () => {
    expect(git.status.argv({ repo: "/tmp/x", short: true }))
      .toEqual(["-C", "/tmp/x", "status", "--short"])
  })

  it("emits flags before positionals", () => {
    expect(git.push.argv({ remote: "origin", branch: "main", force: true }))
      .toEqual(["push", "--force", "origin", "main"])
  })

  it("omits an absent optional positional", () => {
    expect(git.push.argv({ remote: "origin" })).toEqual(["push", "origin"])
  })

  it("spreads a variadic positional", () => {
    expect(git.add.argv({ paths: ["a.ts", "b.ts"] })).toEqual(["add", "a.ts", "b.ts"])
  })

  it("fences a positional that looks like a flag", () => {
    // argv injection into the wrapped binary is structurally off
    expect(git.revParse.argv({ rev: "--upload-pack=evil" }))
      .toEqual(["rev-parse", "--", "--upload-pack=evil"])
  })

  it("validates the input before reconstructing", () => {
    // @ts-expect-error — rev is required
    expect(() => git.revParse.argv({})).toThrow(/rev/)
  })
})
