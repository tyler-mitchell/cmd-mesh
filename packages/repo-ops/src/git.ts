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
      safety: "read",
      input: {
        short: { type: "boolean", cli: "--short, -s" },
        branch: { type: "boolean", cli: "--branch, -b" }
      },
      output: "string"
    },
    log: {
      description: "commit history",
      safety: "read",
      input: {
        oneline: { type: "boolean", cli: "--oneline" },
        count: { type: "string", description: "limit to n commits", cli: "--max-count, -n" }
      },
      output: "string"
    },
    diff: {
      description: "changes against the index or a ref",
      safety: "read",
      input: {
        staged: { type: "boolean", cli: "--staged" },
        path: { type: "string", cli: "[path]" }
      },
      output: "string"
    },
    add: {
      description: "stage paths",
      safety: "action",
      input: {
        paths: { type: "string", suggest: "filepaths", cli: "<...paths>" }
      },
      output: "string"
    },
    commit: {
      description: "record a commit",
      safety: "action",
      input: {
        message: { type: "string", description: "commit message", required: true, cli: "--message, -m" },
        all: { type: "boolean", description: "stage tracked changes first", cli: "--all, -a" }
      },
      output: "string"
    },
    push: {
      description: "push a ref",
      safety: "action",
      input: {
        remote: { type: "string", cli: "[remote]" },
        branch: { type: "string", cli: "[branch]" }
      },
      output: "string"
    },
    pull: {
      description: "pull a ref",
      safety: "action",
      input: {
        ffOnly: { type: "boolean", cli: "--ff-only" }
      },
      output: "string"
    }
  }
})
