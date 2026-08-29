import { program } from "cmd-mesh"
import { captured, printText, streamed, text } from "./run.js"

export const ci = program({
  name: "ci",
  description: "CI runs on GitHub",
  commands: {
    list: {
      description: "recent workflow runs",
      safety: "read",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "gh", ["run", "list", "--limit", "10"])
    },
    watch: {
      description: "watch one run to completion",
      safety: "read",
      mcp: { hidden: true },
      input: { run: { type: "string", description: "run id", cli: "<run>" } },
      run: (input, ctx) => streamed(ctx, "gh", ["run", "watch", "--exit-status", input.run])
    },
    logs: {
      description: "failed-job logs",
      safety: "read",
      mcp: { hidden: true },
      input: { run: { type: "string", description: "run id", cli: "[run]" } },
      run: (input, ctx) =>
        streamed(ctx, "gh", ["run", "view", "--log-failed", ...(input.run === undefined ? [] : [input.run])])
    },
    rerun: {
      description: "re-run a failed run",
      safety: "action",
      input: { run: { type: "string", description: "run id", cli: "[run]" } },
      output: text,
      cli: { render: printText },
      run: (input, ctx) =>
        captured(ctx, "gh", ["run", "rerun", ...(input.run === undefined ? [] : [input.run])])
    },
    cancel: {
      description: "cancel a run",
      safety: "action",
      input: { run: { type: "string", description: "run id", cli: "[run]" } },
      output: text,
      cli: { render: printText },
      run: (input, ctx) =>
        captured(ctx, "gh", ["run", "cancel", ...(input.run === undefined ? [] : [input.run])])
    },
    dispatch: {
      description: "dispatch the ci workflow",
      safety: "action",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "gh", ["workflow", "run", "ci.yml"])
    }
  }
})
