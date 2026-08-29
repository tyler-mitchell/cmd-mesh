import { describe, expect, it } from "vitest"
import { external, program } from "../src/index.js"

// Design probe for external-declaration generation (backlog: populate
// gh/bumpy/npm surfaces from Fig's corpus instead of hand-curation).
// The fixture is a verbatim structural subset of withfig/autocomplete
// src/git.ts (master, retrieved 2026-08-29); runtime-only fields the
// converter must ignore (generators, insertValue, icon, priority) are
// represented by the one field kind each occurs as.

interface FigOption {
  readonly name: string | ReadonlyArray<string>
  readonly description?: string
  readonly args?: { readonly name: string; readonly isOptional?: boolean }
}

interface FigSubcommand {
  readonly name: string
  readonly description?: string
  readonly args?: {
    readonly name: string
    readonly isOptional?: boolean
    readonly isVariadic?: boolean
    readonly template?: string
  }
  readonly options?: ReadonlyArray<FigOption>
}

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

const camel = (kebab: string): string =>
  kebab.replace(/^-+/, "").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())

const flagUsage = (name: string | ReadonlyArray<string>): { readonly key: string; readonly usage: string } => {
  const names = typeof name === "string" ? [name] : [...name]
  const long = names.find((n) => n.startsWith("--")) ?? names[0]!
  const short = names.find((n) => /^-[^-]/.test(n))
  return {
    key: camel(long),
    usage: short === undefined ? long : `${long}, ${short}`
  }
}

const templateSuggest = (template: string | undefined): { readonly suggest?: "filepaths" | "folders" } =>
  template === "filepaths" ? { suggest: "filepaths" } : template === "folders" ? { suggest: "folders" } : {}

const convertSubcommand = (sub: FigSubcommand, allow: ReadonlyArray<string>) => {
  const positional = sub.args === undefined
    ? {}
    : {
      [camel(sub.args.name)]: {
        type: "string",
        cli: {
          usage: sub.args.isVariadic === true
            ? sub.args.isOptional === true ? `[...${sub.args.name}]` : `<...${sub.args.name}>`
            : sub.args.isOptional === true ? `[${sub.args.name}]` : `<${sub.args.name}>`,
          ...templateSuggest(sub.args.template).suggest === undefined
            ? {}
            : { complete: templateSuggest(sub.args.template).suggest }
        }
      }
    }
  const flags = Object.fromEntries(
    (sub.options ?? [])
      .filter((option) => {
        const names = typeof option.name === "string" ? [option.name] : option.name
        return names.some((n) => allow.includes(n))
      })
      .map((option) => {
        const { key, usage } = flagUsage(option.name)
        return [key, {
          type: option.args === undefined ? "boolean" : "string",
          ...(option.description === undefined ? {} : { description: option.description }),
          cli: usage
        }]
      })
  )
  return {
    ...(sub.description === undefined ? {} : { description: sub.description }),
    input: { ...positional, ...flags },
    output: "string"
  }
}

const generateExternal = (
  bin: string,
  specs: ReadonlyArray<FigSubcommand>,
  curation: Readonly<Record<string, ReadonlyArray<string>>>
) =>
  ({
    name: bin,
    description: `the ${bin} binary as a typed surface`,
    commands: Object.fromEntries(
      specs
        .filter((sub) => curation[sub.name] !== undefined)
        .map((sub) => [sub.name, convertSubcommand(sub, curation[sub.name]!)])
    )
  }) as never

interface ParameterView {
  readonly key: string
  readonly usage: string
  readonly boolean: boolean
}

describe("external generation from a Fig spec", () => {
  const generated = external(
    generateExternal("git", figGitSubset, {
      status: ["--short", "--branch"],
      commit: ["--message", "--all", "--verbose"]
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

  it("curation excludes everything not allow-listed", () => {
    expect(commandSpec("status").parameters.some((p) => p.key === "porcelain")).toBe(false)
  })
})
