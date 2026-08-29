import { describe, expect, it } from "vitest"
import { external, importExternal, program } from "../src/index.js"
import type { CommandSpec, ImportedCommand } from "../src/index.js"

// a subset of git's real surface, described in this model's own terms.
// the shape a converter emits when it reads some other tool's spec
// file — the importer never sees that file's grammar.

const gitSurface: ReadonlyArray<ImportedCommand> = [
  {
    name: "status",
    description: "Show the working tree status",
    options: [
      { names: ["-s", "--short"], description: "Give the output in the short-format" },
      { names: ["-b", "--branch"], description: "Show branch information" },
      {
        names: ["--porcelain"],
        description: "Give the output in the short-format",
        argument: { name: "version", optional: true }
      }
    ]
  },
  {
    name: "commit",
    description: "Record changes to the repository",
    argument: { name: "pathspec", optional: true, variadic: true, suggest: "filepaths" },
    options: [
      {
        names: ["-m", "--message"],
        description: "Use the given message as the commit message",
        argument: { name: "message" }
      },
      { names: ["-a", "--all"], description: "Stage all modified and deleted paths" },
      { names: ["-v", "--verbose"], description: "Show unified diff of all file changes" }
    ]
  }
]

describe("importExternal", () => {
  const generated = external(
    importExternal({
      bin: "git",
      description: "the git binary as a typed surface",
      commands: gitSurface,
      curation: {
        status: { safety: "read", flags: ["--short", "--branch"] },
        commit: { safety: "action", flags: ["--message", "--all", "--verbose"] }
      }
    })
  )
  const kit = program({ name: "kit", commands: { git: generated } })
  const commandSpec = (name: string): CommandSpec => {
    const git = kit.spec.commands.find((c) => c.path.at(-1) === "git")!
    return git.commands.find((c) => c.path.at(-1) === name)!
  }

  it("compiles the imported surface into a declaration", () => {
    expect(commandSpec("status").parameters.map((p) => p.key).sort()).toEqual(["branch", "short"])
  })

  it("matches the hand-written baseline's surface shape", () => {
    const byKey = Object.fromEntries(commandSpec("commit").parameters.map((p) => [p.key, p]))
    expect(byKey["message"]!.usage).toBe("--message, -m")
    expect(byKey["message"]!.boolean).toBe(false)
    expect(byKey["all"]!.usage).toBe("--all, -a")
    expect(byKey["all"]!.boolean).toBe(true)
    expect(byKey["pathspec"]!.usage).toBe("[...pathspec]")
  })

  it("carries a declared suggestion source onto the parameter", () => {
    const pathspec = commandSpec("commit").parameters.find((p) => p.key === "pathspec")!
    expect(pathspec.suggestionSource).toBe("filepaths")
  })

  it("projects both safety hints explicitly for every imported command", () => {
    const annotationsOf = (name: string) => kit.mcp.tools.find((t) => t.name === name)!.annotations
    expect(annotationsOf("kit_git_status")).toEqual({ readOnlyHint: true, destructiveHint: false })
    expect(annotationsOf("kit_git_commit")).toEqual({ readOnlyHint: false, destructiveHint: false })
  })

  it("curation excludes everything not allow-listed", () => {
    expect(commandSpec("status").parameters.some((p) => p.key === "porcelain")).toBe(false)
  })

  it("a command absent from curation is not imported", () => {
    const git = kit.spec.commands.find((c) => c.path.at(-1) === "git")!
    expect(git.commands.map((c) => c.path.at(-1)).sort()).toEqual(["commit", "status"])
  })
})
