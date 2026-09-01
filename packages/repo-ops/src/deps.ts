import { program } from "cmd-mesh"
import { git } from "./git.js"
import { captured, printText, text } from "./run.js"

export const deps = program({
  name: "deps",
  description: "dependabot PRs",
  commands: {
    list: {
      description: "open dependabot PRs",
      safety: "read",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "list", "--state", "open", "--search", "author:app/dependabot", "--limit", "100"])
    },
    merge: {
      description: "squash-merge one PR",
      safety: "action",
      input: {
        pr: ["string", "@", { description: "a PR number, written as a string", cli: "<pr>" }]
      },
      output: text,
      cli: { render: printText },
      // the number travels as a string, which an agent reading "PR
      // number" would not assume
      mcp: { examples: [{ args: { pr: "142" }, description: "squash-merge PR 142" }] },
      run: (input, ctx) => captured(ctx, "gh", ["pr", "merge", input.pr, "--squash"])
    },
    close: {
      description: "close one PR",
      safety: "action",
      input: {
        pr: ["string", "@", { description: "a PR number, written as a string", cli: "<pr>" }]
      },
      output: text,
      cli: { render: printText },
      mcp: { examples: [{ args: { pr: "142" }, description: "close PR 142" }] },
      run: (input, ctx) => captured(ctx, "gh", ["pr", "close", input.pr])
    },
    sync: {
      description: "fast-forward main from origin",
      safety: "action",
      output: text,
      cli: { render: printText },
      run: async (_input, ctx) => ({
        text: (await git.pull(
          { ffOnly: true, remote: "origin", branch: "main" },
          { cwd: ctx.workspace.workspaceRootDir() }
        )).trimEnd()
      })
    }
  }
})
