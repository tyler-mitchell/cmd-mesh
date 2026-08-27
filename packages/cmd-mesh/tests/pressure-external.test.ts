import { describe, expect, it } from "vitest"
import { external, program } from "../src/index.js"
import { InvalidDeclaration } from "../src/errors.js"
import { captureCli } from "./fixtures/capture.js"

// Wrapped binaries under pressure.
//
// `external()` reconstructs argv from parsed values and hands it to a real
// process. The pressure is on that reconstruction: token order, boolean
// presence, global options, exit codes, and whether a broken declaration
// reports everything wrong with it at once.

describe("argv reconstruction", () => {
  const git = external({
    name: "git",
    description: "the git binary",
    commands: {
      status: {
        description: "working tree status",
        input: {
          short: { type: "boolean", cli: "--short, -s" },
          branch: { type: "boolean", cli: "--branch, -b" }
        },
        output: "string"
      },
      revParse: {
        description: "resolve a revision",
        input: {
          rev: { type: "string", cli: "<rev>" },
          verify: { type: "boolean", cli: "--verify" }
        },
        output: "string"
      },
      "rev-parse": {
        description: "resolve a revision, spelled as the binary spells it",
        input: {
          verify: { type: "boolean", cli: "--verify" },
          rev: { type: "string", cli: "<rev>" }
        },
        output: "string"
      }
    }
  })

  it("runs the binary and applies the stdout contract", async () => {
    await expect(git.status({ short: true })).resolves.toBeTypeOf("string")
  })

  it("emits nothing for a boolean left false", async () => {
    // a false boolean must not reach argv as `--branch`
    const withFlag = await git.status({ short: true, branch: true })
    const withoutFlag = await git.status({ short: true, branch: false })
    expect(withFlag).not.toBe(withoutFlag)
  })

  it("maps a camelCase command key to the binary's hyphenated subcommand", async () => {
    // `revParse` is the only spelling that stays dot-callable in JS; it has
    // to reach the binary as `rev-parse`, the way derived flags kebab-case
    await expect(git.revParse({ rev: "HEAD", verify: true })).resolves.toMatch(/^[0-9a-f]{40}/)
  })

  it("places flags where the binary expects them relative to positionals", async () => {
    // `git rev-parse --verify HEAD` is the documented order
    await expect(git["rev-parse"]({ rev: "HEAD", verify: true })).resolves.toMatch(/^[0-9a-f]{40}/)
  })

  it("reports a nonzero exit with the binary's own diagnostics", async () => {
    await expect(git["rev-parse"]({ rev: "definitely-not-a-ref", verify: true }))
      .rejects.toThrow(/exited with/)
  })
})

describe("wrapping a binary's global options", () => {
  it("can express an option that must precede the subcommand", async () => {
    // `git -C <dir> status` is the shape every repo-targeting wrapper needs
    const git = external({
      name: "git",
      commands: {
        status: {
          description: "working tree status in a chosen repository",
          input: {
            repo: { type: "string", cli: "-C" },
            short: { type: "boolean", cli: "--short" }
          },
          output: "string"
        }
      }
    })
    await expect(git.status({ repo: process.cwd(), short: true })).resolves.toBeTypeOf("string")
  })
})

describe("external declaration validation", () => {
  it("reports every problem across the whole declaration at once", () => {
    try {
      external({
        name: "tool",
        commands: {
          first: { input: { bad: { type: "not.a.keyword" } } },
          second: {
            input: {
              a: { type: "string", cli: "--same" },
              b: { type: "string", cli: "--same" }
            }
          }
        }
      })
      expect.unreachable("expected an InvalidDeclaration")
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidDeclaration)
      const message = (error as InvalidDeclaration).message
      expect(message).toMatch(/not\.a\.keyword/)
      expect(message).toMatch(/--same is claimed by a and b/)
    }
  })
})

describe("externals mounted in a program", () => {
  const git = external({
    name: "git",
    commands: {
      status: {
        description: "working tree status",
        input: { short: { type: "boolean", cli: "--short, -s" } },
        output: "string"
      }
    }
  })

  const repo = program({
    name: "repo",
    version: "1.0.0",
    description: "repository tools",
    commands: { git }
  })

  it("stays callable through the parent module", async () => {
    await expect(repo.git.status({ short: true })).resolves.toBeTypeOf("string")
  })

  it("routes through the parent cli", async () => {
    const { code } = await captureCli(() => repo.main(["git", "status", "--short"]))
    expect(code).toBe(0)
  })

  it("contributes its commands to the parent's mcp tools", () => {
    expect(repo.mcp.tools.map((t) => t.name)).toContain("repo_git_status")
  })

  it("keeps the external mount root out of the tool list", () => {
    expect(repo.mcp.tools.map((t) => t.name)).not.toContain("repo_git")
  })
})
