// repokit: the @cmd-mesh/core dogfood AND the repository's operational
// command surface — the closed-distribution script contract declared
// once, so the same operations are root scripts, a typed library, and
// mcp tools. handlers are written the way a CONSUMER writes them —
// plain async functions over the promise surface, no Effect.
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

// the two operational shapes. `streamed` hands the child the terminal
// (watchers, interactive tools) and succeeds only on the declared
// codes; `captured` returns stdout as `{ text }` for cli rendering and
// mcp structured content alike. both anchor at the repository root.
const streamed = async (ctx: Ctx, bin: string, args: ReadonlyArray<string>): Promise<{ done: true }> => {
  await ctx.exec(bin, args, { cwd: await repoRoot(ctx), stdio: "inherit", successCodes: [0] })
  return { done: true }
}

const captured = async (
  ctx: Ctx,
  bin: string,
  args: ReadonlyArray<string>,
  successCodes: ReadonlyArray<number> = [0]
): Promise<{ text: string }> => {
  const result = await ctx.exec(bin, args, { cwd: await repoRoot(ctx), successCodes })
  return { text: result.stdout.trimEnd() }
}

const text = { text: "string" } as const
const printText = (output: { text: string }) => output.text

// the operational groups are mounted subprograms — the contract's
// nesting mechanism, and the one shape that keeps bare (input, ctx)
// handler inference intact below the first level

const ci = program({
  name: "ci",
  description: "CI runs on GitHub",
  commands: {
    list: {
      description: "recent workflow runs",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "gh", ["run", "list", "--limit", "10"])
    },
    watch: {
      description: "watch one run to completion",
      mcp: { hidden: true },
      input: { run: { type: "string", description: "run id", cli: "<run>" } },
      run: (input, ctx) => streamed(ctx, "gh", ["run", "watch", "--exit-status", input.run])
    },
    logs: {
      description: "failed-job logs",
      mcp: { hidden: true },
      input: { run: { type: "string", description: "run id", cli: "[run]" } },
      run: (input, ctx) =>
        streamed(ctx, "gh", ["run", "view", "--log-failed", ...(input.run === undefined ? [] : [input.run])])
    },
    rerun: {
      description: "re-run a failed run",
      input: { run: { type: "string", description: "run id", cli: "[run]" } },
      output: text,
      cli: { render: printText },
      run: (input, ctx) =>
        captured(ctx, "gh", ["run", "rerun", ...(input.run === undefined ? [] : [input.run])])
    },
    cancel: {
      description: "cancel a run",
      input: { run: { type: "string", description: "run id", cli: "[run]" } },
      output: text,
      cli: { render: printText },
      run: (input, ctx) =>
        captured(ctx, "gh", ["run", "cancel", ...(input.run === undefined ? [] : [input.run])])
    },
    dispatch: {
      description: "dispatch the ci workflow",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "gh", ["workflow", "run", "ci.yml"])
    }
  }
})

const promote = program({
  name: "promote",
  description: "the main → release promotion PR",
  commands: {
    pr: {
      description: "show the open promotion PR",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "list", "--head", "main", "--base", "release", "--state", "open", "--limit", "1"])
    },
    create: {
      description: "open the promotion PR",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "create", "--head", "main", "--base", "release", "--fill"])
    },
    merge: {
      description: "queue the promotion merge",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "gh", ["pr", "merge", "main", "--merge", "--auto"])
    }
  }
})

const release = program({
  name: "release",
  description: "the Bumpy release procedure",
  commands: {
    add: {
      description: "author a bump file (interactive)",
      mcp: { hidden: true },
      input: { args: { type: "string", description: "bumpy add arguments", cli: "[...args]" } },
      run: (input, ctx) => streamed(ctx, "bumpy", ["add", ...input.args])
    },
    check: {
      description: "every changed package has a bump",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "bumpy", ["check", "--strict"])
    },
    status: {
      description: "pending bumps and planned versions",
      output: text,
      cli: { render: printText },
      // bumpy exits 1 when nothing is pending, with the JSON still on
      // stdout — a report-style exit, not a failure
      run: (_input, ctx) => captured(ctx, "bumpy", ["status", "--json"], [0, 1])
    },
    push: {
      description: "push the daily branch",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "git", ["push", "origin", "main"])
    },
    pr: {
      description: "show the open version PR",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", [
          "pr", "list", "--head", "bumpy/version-packages", "--base", "release", "--state", "open", "--limit", "1"
        ])
    },
    merge: {
      description: "queue the version PR squash merge",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "merge", "bumpy/version-packages", "--auto", "--squash"])
    },
    update: {
      description: "update the version PR branch",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "gh", ["pr", "update-branch", "bumpy/version-packages"])
    },
    "registry-version": {
      description: "published version on npm",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "npm", ["view", "cmd-mesh", "version"])
    },
    sync: {
      description: "synchronize main forward from release",
      input: {
        merge: { type: "boolean", description: "merge-pull when histories diverged", cli: "--merge" }
      },
      output: text,
      cli: { render: printText },
      run: (input, ctx) =>
        captured(
          ctx,
          "git",
          input.merge
            ? ["pull", "--no-rebase", "--no-edit", "origin", "release"]
            : ["pull", "--ff-only", "origin", "release"]
        )
    },
    promote
  }
})

const deps = program({
  name: "deps",
  description: "dependabot PRs",
  commands: {
    list: {
      description: "open dependabot PRs",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "list", "--state", "open", "--search", "author:app/dependabot", "--limit", "100"])
    },
    merge: {
      description: "squash-merge one PR",
      input: { pr: { type: "string", description: "PR number", cli: "<pr>" } },
      output: text,
      cli: { render: printText },
      run: (input, ctx) => captured(ctx, "gh", ["pr", "merge", input.pr, "--squash"])
    },
    close: {
      description: "close one PR",
      input: { pr: { type: "string", description: "PR number", cli: "<pr>" } },
      output: text,
      cli: { render: printText },
      run: (input, ctx) => captured(ctx, "gh", ["pr", "close", input.pr])
    },
    sync: {
      description: "fast-forward main from origin",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "git", ["pull", "--ff-only", "origin", "main"])
    }
  }
})

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
    ci,
    release,
    deps
  }
})
