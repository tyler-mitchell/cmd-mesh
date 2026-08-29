import { external } from "cmd-mesh"

// the git binary as SURFACE (the 08 external thesis): typed calls
// (git.commit({ message })), cli subcommands, and mcp tools from one
// declaration. one file per program, the Fig convention. the daily
// vocabulary, curated; anything beyond it is a ctx.exec implementation
// detail at the call site.
export const git = external({
  name: "git",
  description: "the git binary as a typed surface",
  commands: {
    status: {
      description: "working tree status",
      input: {
        short: { type: "boolean", cli: "--short, -s" },
        branch: { type: "boolean", cli: "--branch, -b" }
      },
      output: "string"
    },
    log: {
      description: "commit history",
      input: {
        oneline: { type: "boolean", cli: "--oneline" },
        count: { type: "string", description: "limit to n commits", cli: "--max-count, -n" }
      },
      output: "string"
    },
    diff: {
      description: "changes against the index or a ref",
      input: {
        staged: { type: "boolean", cli: "--staged" },
        path: { type: "string", cli: "[path]" }
      },
      output: "string"
    },
    add: {
      description: "stage paths",
      input: {
        paths: { type: "string", cli: { usage: "<...paths>", complete: "filepaths" } }
      },
      output: "string"
    },
    commit: {
      description: "record a commit",
      input: {
        message: { type: "string", description: "commit message", required: true, cli: "--message, -m" },
        all: { type: "boolean", description: "stage tracked changes first", cli: "--all, -a" }
      },
      output: "string"
    },
    push: {
      description: "push a ref",
      input: {
        remote: { type: "string", cli: "[remote]" },
        branch: { type: "string", cli: "[branch]" }
      },
      output: "string"
    },
    pull: {
      description: "pull a ref",
      input: {
        ffOnly: { type: "boolean", cli: "--ff-only" }
      },
      output: "string"
    }
  }
})
