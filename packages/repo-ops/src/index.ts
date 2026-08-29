// the closed-distribution operational contract, declared once: the
// Bumpy release procedure, CI runs, and dependabot operations as
// mountable cmd-mesh modules. a repository mounts them into its own
// program; the one genuine configuration point is the published
// package name (registry-version). branch names and vocabularies are
// the playbook itself and stay interpreter-owned here.
import { delimiter, join } from "node:path"
import { program } from "cmd-mesh"
import type { Ctx } from "cmd-mesh"

export interface RepositoryOperationsConfig {
  readonly package: string
}

// workspace-local binaries (bumpy) must resolve however the bin was
// invoked — `pnpm run` puts node_modules/.bin on PATH, a direct
// `node dist/bin.js` or an mcp server does not
const anchored = (ctx: Ctx): { cwd: string; env: Readonly<Record<string, string>> } => {
  const cwd = ctx.workspace.workspaceRootDir()
  return {
    cwd,
    env: {
      ...process.env as Record<string, string>,
      PATH: [join(cwd, "node_modules", ".bin"), process.env.PATH ?? ""].join(delimiter)
    }
  }
}

// the two operational shapes, anchored at the workspace root
// (ctx.workspace owns that resolution). `streamed` hands the child the
// terminal (watchers, interactive tools) and succeeds only on the
// declared codes; `captured` returns stdout as `{ text }` for cli
// rendering and mcp structured content alike.
const streamed = async (ctx: Ctx, bin: string, args: ReadonlyArray<string>): Promise<{ done: true }> => {
  await ctx.exec(bin, args, { ...anchored(ctx), stdio: "inherit", successCodes: [0] })
  return { done: true }
}

const captured = async (
  ctx: Ctx,
  bin: string,
  args: ReadonlyArray<string>,
  successCodes: ReadonlyArray<number> = [0]
): Promise<{ text: string }> => {
  const result = await ctx.exec(bin, args, { ...anchored(ctx), successCodes })
  return { text: result.stdout.trimEnd() }
}

const text = { text: "string" } as const
const printText = (output: { text: string }) => output.text

export const repositoryOperations = (config: RepositoryOperationsConfig) => {
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
        run: (_input, ctx) => captured(ctx, "npm", ["view", config.package, "version"])
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

  return { release, ci, deps }
}
