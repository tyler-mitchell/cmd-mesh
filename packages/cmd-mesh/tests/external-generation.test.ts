import { describe, expect, it } from "vitest"
import { external, importExternal, program } from "../src/index.js"
import type { FigSubcommand } from "../src/index.js"

// the fixture is a verbatim structural subset of withfig/autocomplete
// src/git.ts (master, retrieved 2026-08-29); runtime-only fields the
// converter ignores (generators, insertValue, icon, priority) are
// omitted here because they never reach the declaration.

const figGitSubset: ReadonlyArray<FigSubcommand> = [
  {
    name: "status",
    description: "Show the working tree status",
    options: [
      { name: ["-s", "--short"], description: "Give the output in the short-format" },
      { name: ["-b", "--branch"], description: "Show branch information" },
      { name: "--porcelain", description: "Give the output in the short-format", args: { name: "version", isOptional: true } }
    ]
  },
  {
    name: "commit",
    description: "Record changes to the repository",
    args: { name: "pathspec", isOptional: true, isVariadic: true, template: "filepaths" },
    options: [
      { name: ["-m", "--message"], description: "Use the given message as the commit message", args: { name: "message" } },
      { name: ["-a", "--all"], description: "Stage all modified and deleted paths" },
      { name: ["-v", "--verbose"], description: "Show unified diff of all file changes" }
    ]
  }
]

interface ParameterView {
  readonly key: string
  readonly usage: string
  readonly boolean: boolean
  readonly suggestionSource?: string
}

describe("importExternal", () => {
  const generated = external(
    importExternal({
      format: "fig",
      bin: "git",
      subcommands: figGitSubset,
      curation: {
        status: ["--short", "--branch"],
        commit: ["--message", "--all", "--verbose"]
      }
    })
  )
  const kit = program({ name: "kit", commands: { git: generated as never } })
  const commandSpec = (name: string): { readonly parameters: ReadonlyArray<ParameterView> } => {
    const git = kit.spec.commands.find((c) => c.path.at(-1) === "git")!
    return git.commands.find((c) => c.path.at(-1) === name)! as never
  }

  it("compiles the generated declaration", () => {
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

  it("carries a filepaths template through as the parameter's suggestion source", () => {
    const pathspec = commandSpec("commit").parameters.find((p) => p.key === "pathspec")!
    expect(pathspec.suggestionSource).toBe("filepaths")
  })

  it("curation excludes everything not allow-listed", () => {
    expect(commandSpec("status").parameters.some((p) => p.key === "porcelain")).toBe(false)
  })
})
