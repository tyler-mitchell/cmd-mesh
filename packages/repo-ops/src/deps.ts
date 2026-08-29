import { program } from "cmd-mesh"
import { captured, printText, text } from "./run.js"

export const deps = program({
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
