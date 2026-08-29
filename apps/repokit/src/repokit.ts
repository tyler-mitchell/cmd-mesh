// repokit: the @cmd-mesh/core dogfood AND the repository's operational
// command surface. the closed-distribution operations come mounted
// from repo-ops (declared once, shared across repositories); the
// commands here are what is repository-specific. handlers are written
// the way a CONSUMER writes them — plain async functions over the
// promise surface, no Effect.
import { relative } from "node:path"
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
    cwd: ctx.workspace.workspaceRootDir()
  })
  if (result.exitCode > 1) {
    throw new Error(`git grep failed (${result.exitCode}): ${result.stderr.trim()}`)
  }
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
const { release, ci, deps, git } = repositoryOperations({ package: "cmd-mesh" })

export const repokit = program({
  name: "repokit",
  version: "0.1.0",
  description: "repository operations for humans and agents",
  commands: {
    search: {
      description: "search tracked files, structured results",
      input: {
        pattern: { type: "string", description: "regex to search for", cli: "<pattern>" },
        glob: {
          type: "string",
          description: "limit to a pathspec, e.g. 'packages/**/*.ts'",
          suggest: "filepaths",
          cli: "--glob, -g"
        }
      },
      output: [{ file: "string", line: "number", text: "string" }, "[]"],
      run: (input, ctx) =>
        gitGrep(ctx, [
          "-e",
          input.pattern,
          ...(input.glob === undefined ? [] : ["--", input.glob])
        ])
    },
    todos: {
      description: "collect TODO/FIXME comments",
      input: {
        assignee: { type: "string", description: "filter by @assignee", cli: "--assignee, -a" }
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
      cli: { hidden: true },
      input: {
        commits: { type: "string.integer.parse = '10'", description: "recent commits to include" }
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
      output: [{ name: "string", "version?": "string", dir: "string" }, "[]"],
      run: (_input, ctx) => {
        const root = ctx.workspace.workspaceRootDir()
        return ctx.workspace.packageList().map((pkg) => ({
          name: pkg.name,
          version: pkg.packageJson.version,
          dir: relative(root, pkg.dirpath)
        }))
      }
    },
    check: {
      description: "run a package script with live output",
      input: {
        filter: {
          type: "string",
          description: "pnpm --filter selector",
          suggest: (ctx: SuggestContext) => ctx.workspace.packageNames(),
          cli: "<filter>"
        },
        script: { type: "string = 'typecheck'", description: "script to run" },
        timeout: { type: "string.integer.parse = '600000'", description: "timeout in ms" }
      },
      output: { filter: "string", script: "string" },
      run: async (input, ctx) => {
        const result = await ctx.exec("pnpm", ["--filter", input.filter, "run", input.script], {
          cwd: ctx.workspace.workspaceRootDir(),
          stdio: "inherit",
          timeoutMs: input.timeout
        })
        if (result.exitCode !== 0) {
          throw new Error(`${input.script} failed with exit code ${result.exitCode}`)
        }
        return { filter: input.filter, script: input.script }
      }
    },
    ci,
    release,
    deps,
    git
  }
})
