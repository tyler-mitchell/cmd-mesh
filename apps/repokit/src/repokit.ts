// repokit: the @cmd-mesh/core dogfood. handlers are written the way a
// CONSUMER writes them — plain async functions over the promise surface,
// no Effect — because exercising the real consumer contract is the point.
import { readFile, writeFile } from "node:fs/promises"
import { relative } from "node:path"
import { program } from "cmd-mesh"
import type { Ctx, SuggestContext } from "cmd-mesh"

interface GrepLine {
  readonly file: string
  readonly line: number
  readonly text: string
}

// repo tools operate on the whole repository, wherever they were invoked
const repoRoot = async (ctx: Ctx): Promise<string> => {
  const result = await ctx.exec("git", ["rev-parse", "--show-toplevel"])
  if (result.exitCode !== 0) throw new Error("not inside a git repository")
  return result.stdout.trim()
}

// `git grep` exit code 1 means "no matches" — only >1 is a failure
const gitGrep = async (ctx: Ctx, args: ReadonlyArray<string>): Promise<ReadonlyArray<GrepLine>> => {
  const result = await ctx.exec("git", ["grep", "-n", "-I", "--untracked", ...args], {
    cwd: await repoRoot(ctx)
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

const bumpSegment = { major: 0, minor: 1, patch: 2 } as const

// completion generators must be hoisted (or have annotated parameters):
// an inline arrow is context-sensitive and would collapse the command's
// type inference
const packageManifests = ({ workspace }: SuggestContext): ReadonlyArray<string> => {
  const root = workspace.workspaceRootDir() ?? process.cwd()
  return workspace
    .packageList({ includeRoot: true })
    .map((pkg) => relative(root, pkg.path))
}

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
        const root = await repoRoot(ctx)
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
        const root = ctx.workspace.workspaceRootDir() ?? process.cwd()
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
          cwd: await repoRoot(ctx),
          stdio: "inherit",
          timeoutMs: input.timeout
        })
        if (result.exitCode !== 0) {
          throw new Error(`${input.script} failed with exit code ${result.exitCode}`)
        }
        return { filter: input.filter, script: input.script }
      }
    },
    release: {
      description: "bump a package version",
      mcp: { hidden: true },
      input: {
        bump: {
          type: "'patch' | 'minor' | 'major'",
          description: "semver increment",
          cli: "<bump>"
        },
        pkg: {
          type: "string = './package.json'",
          description: "manifest to bump",
          // Fig-style generator: real manifests from the repo, on demand
          suggest: packageManifests,
          cli: "--pkg"
        },
        dryRun: { type: "boolean", description: "plan without writing", cli: "--dry-run, -n" }
      },
      output: { pkg: "string", from: "string", to: "string", written: "boolean" },
      run: async (input) => {
        const source = await readFile(input.pkg, "utf8")
        const manifest = JSON.parse(source) as { version?: string }
        const from = manifest.version
        if (from === undefined) throw new Error(`${input.pkg} has no version field`)
        const parts = from.split(".").map(Number)
        if (parts.length !== 3 || parts.some(Number.isNaN)) {
          throw new Error(`${input.pkg} version "${from}" is not plain semver`)
        }
        const index = bumpSegment[input.bump]
        const next = parts.map((n, i) => (i < index ? n : i === index ? n + 1 : 0)).join(".")
        if (!input.dryRun) {
          await writeFile(input.pkg, source.replace(`"version": "${from}"`, `"version": "${next}"`))
        }
        return { pkg: input.pkg, from, to: next, written: !input.dryRun }
      }
    }
  }
})
