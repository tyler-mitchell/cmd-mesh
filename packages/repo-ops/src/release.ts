import { program } from "cmd-mesh"
import { captured, printText, streamed, text } from "./run.js"

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

// the one repository-specific fact the procedure needs is the
// published package name (registry-version), so release is a factory
export const createRelease = (packageName: string) =>
  program({
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
        run: (_input, ctx) => captured(ctx, "npm", ["view", packageName, "version"])
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
