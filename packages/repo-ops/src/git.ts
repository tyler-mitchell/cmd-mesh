import { external } from "cmd-mesh"

// the git binary as SURFACE: typed calls (git.commit({ message })), cli
// subcommands, and mcp tools from one declaration. one file per program.
// the daily vocabulary, curated; anything beyond it is a ctx.exec
// implementation detail at the call site.
export const git = external({
  name: "git",
  description: "the git binary as a typed surface",
  commands: {
    status: {
      description: "working tree status",
      safety: "read",
      input: {
        short: ["boolean", "@", { cli: "--short, -s", default: false }],
        branch: ["boolean", "@", { cli: "--branch, -b", default: false }]
      },
      output: "string"
    },
    log: {
      description: "commit history",
      safety: "read",
      input: {
        oneline: ["boolean", "@", { cli: "--oneline", default: false }],
        "count?": ["string", "@", { description: "limit to n commits", cli: "--max-count, -n" }]
      },
      output: "string"
    },
    diff: {
      description: "changes against the index or a ref",
      safety: "read",
      input: {
        staged: ["boolean", "@", { cli: "--staged", default: false }],
        "path?": ["string", "@", { cli: "[path]" }]
      },
      output: "string"
    },
    add: {
      description: "stage paths",
      safety: "action",
      input: {
        paths: ["string[] >= 1", "@", { suggest: "filepaths", cli: "<...paths>" }]
      },
      output: "string"
    },
    commit: {
      description: "record a commit",
      safety: "action",
      input: {
        // no `?` and no default: required
        message: ["string", "@", { description: "commit message", cli: "--message, -m" }],
        all: ["boolean", "@", { description: "stage tracked changes first", cli: "--all, -a", default: false }]
      },
      output: "string"
    },
    push: {
      description: "push a ref",
      safety: "action",
      input: {
        "remote?": ["string", "@", { cli: "[remote]" }],
        "branch?": ["string", "@", { cli: "[branch]" }]
      },
      output: "string"
    },
    pull: {
      description: "pull a ref",
      safety: "action",
      input: {
        ffOnly: ["boolean", "@", { cli: "--ff-only", default: false }]
      },
      output: "string"
    }
  }
})
