// repokit: the @cmd-mesh/core dogfood AND the repository's operational
// command surface. the closed-distribution operations come mounted
// from repo-ops (declared once, shared across repositories); the
// commands here are what is repository-specific. handlers are written
// the way a CONSUMER writes them — plain async functions over the
// promise surface, no Effect.
import { program } from "cmd-mesh"
import type { Ctx, SuggestContext } from "cmd-mesh"
import { repositoryOperations } from "repo-ops"

interface GrepLine {
  readonly file: string
  readonly line: number
  readonly text: string
}

// `git grep` exit code 1 means "no matches" — only >1 is a failure.
// operations anchor at the workspace root; ctx.workspace owns that.
const gitGrep = async (ctx: Ctx, args: ReadonlyArray<string>): Promise<ReadonlyArray<GrepLine>> => {
  const result = await ctx.exec("git", ["grep", "-n", "-I", "--untracked", ...args], {
    cwd: ctx.workspace.workspaceRootDir(),
    successCodes: [0, 1]
  })
  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const first = line.indexOf(":")
      const second = line.indexOf(":", first + 1)
      return {
        file: line.slice(0, first),
        line: Number(line.slice(first + 1, second)),
        text: line.slice(second + 1).trim()
      }
    })
}

// the operational groups come from repo-ops, configured with the one
// repository-specific fact they need
const { release, ci, deps, git, external } = repositoryOperations({ package: "cmd-mesh" })

export const repokit = program({
  name: "repokit",
  version: "0.1.0",
  description: "repository operations for humans and agents",
  commands: {
    search: {
      description: "search tracked files, structured results",
      safety: "read",
      input: {
        pattern: ["string", "@", { description: "regex to search for", cli: "<pattern>" }],
        "glob?": [
          "string",
          "@",
          {
            description: "limit to a pathspec, e.g. 'packages/**/*.ts'",
            suggest: "filepaths",
            cli: "--glob, -g"
          }
        ]
      },
      output: [{ file: "string", line: "number", text: "string" }, "[]"],
      // the pattern is a regex and the glob a git pathspec, neither of
      // which the schema's "string" conveys
      mcp: {
        examples: [
          { args: { pattern: "createRelease" }, description: "find a symbol across the repository" },
          {
            args: { pattern: "TODO", glob: "packages/**/*.ts" },
            description: "scope the search to a pathspec"
          }
        ]
      },
      run: (input, ctx) =>
        gitGrep(ctx, [
          "-e",
          input.pattern,
          ...(input.glob === undefined ? [] : ["--", input.glob])
        ])
    },
    todos: {
      description: "collect TODO/FIXME comments",
      safety: "read",
      input: {
        "assignee?": ["string", "@", { description: "filter by @assignee", cli: "--assignee, -a" }]
      },
      output: [{ file: "string", line: "number", tag: "'TODO' | 'FIXME'", text: "string" }, "[]"],
      run: async (input, ctx) => {
        const lines = await gitGrep(ctx, ["-E", "TODO|FIXME"])
        return lines
          .filter((hit) => input.assignee === undefined || hit.text.includes(`@${input.assignee}`))
          .map((hit) => ({
            ...hit,
            tag: hit.text.includes("FIXME") ? ("FIXME" as const) : ("TODO" as const)
          }))
      }
    },
    context: {
      description: "orient an agent: branch, recent commits, dirty files",
      safety: "read",
      cli: { hidden: true },
      input: {
        // ArkType renders a description as the EXPECTED value: it lands
        // in "commits must be ...", so it says what to send rather than
        // what the parameter is for. An agent that passes 10 instead of
        // "10" can only self-correct if the message names the type.
        commits: [
          "string.integer.parse",
          "@",
          { description: "a count of recent commits, written as a string", default: "10" }
        ]
      },
      output: { branch: "string", recent: "string[]", dirty: "string[]" },
      run: async (input, ctx) => {
        const root = ctx.workspace.workspaceRootDir()
        const branch = await ctx.exec("git", ["branch", "--show-current"], { cwd: root })
        const recent = await ctx.exec("git", ["log", "--oneline", "-n", `${input.commits}`], { cwd: root })
        const dirty = await ctx.exec("git", ["status", "--porcelain"], { cwd: root })
        return {
          branch: branch.stdout.trim(),
          recent: recent.stdout.split("\n").filter((line) => line.length > 0),
          dirty: dirty.stdout.split("\n").filter((line) => line.length > 0)
        }
      }
    },
    packages: {
      description: "workspace packages, structured",
      safety: "read",
      output: [{ name: "string", "version?": "string", dir: "string" }, "[]"],
      run: (_input, ctx) => {
        const root = ctx.workspace.workspaceRootDir()
        return ctx.workspace.packageList().map((pkg) => ({
          name: pkg.name,
          version: pkg.packageJson.version,
          dir: pkg.dirpath.startsWith(`${root}/`) ? pkg.dirpath.slice(root.length + 1) : pkg.dirpath
        }))
      }
    },
    check: {
      description: "run a package script with live output",
      safety: "action",
      input: {
        filter: [
          "string",
          "@",
          {
            description: "pnpm --filter selector",
            suggest: (ctx: SuggestContext) => ctx.workspace.packageNames(),
            cli: "<filter>"
          }
        ],
        script: ["string", "@", { description: "script to run", default: "typecheck" }],
        timeout: [
          "string.integer.parse",
          "@",
          { description: "a timeout in milliseconds, written as a string", default: "600000" }
        ]
      },
      output: { filter: "string", script: "string" },
      // `filter` is a pnpm selector, not a path, and the timeout is a
      // string because it parses through a morph
      mcp: {
        examples: [
          { args: { filter: "cmd-mesh" }, description: "typecheck one package" },
          {
            args: { filter: "cmd-mesh", script: "test" },
            description: "run a different script in that package"
          }
        ]
      },
      run: async (input, ctx) => {
        await ctx.exec("pnpm", ["--filter", input.filter, "run", input.script], {
          cwd: ctx.workspace.workspaceRootDir(),
          stdio: "inherit",
          timeoutMs: input.timeout,
          successCodes: [0]
        })
        return { filter: input.filter, script: input.script }
      }
    },
    ci,
    release,
    deps,
    git,
    external
  }
})
