// the shared example program: a small dev tool exercising every contract
// surface — used by demo.ts, bin.ts, and the test suite. It is also what
// a reader copies, so it declares `safety` on every command and keeps a
// default in the parameter's own metadata.
import { external, program } from "../src/index.js";

export const git = external({
  name: "git",
  commands: {
    status: {
      description: "working tree status",
      safety: "read",
      input: {
        short: ["boolean", "@", { cli: "--short, -s", default: false }],
        branch: ["boolean", "@", { cli: "--branch, -b", default: false }],
      },
      output: "string",
    },
  },
});

export const mesh = program({
  name: "mesh",
  version: "0.1.0",
  description: "demo dev tool",
  commands: {
    snapshot: {
      description: "record a directory snapshot",
      safety: "action",
      input: {
        directory: [
          "string",
          "@",
          {
            description: "directory to snapshot",
            suggest: "folders",
            cli: "<directory>",
          },
        ],
        depth: [
          "string.integer.parse | number.integer",
          "@",
          {
            description: "a traversal depth",
            cli: { usage: "--depth, -d", env: "MESH_DEPTH" },
            default: "2",
          },
        ],
        verbose: ["boolean", "@", { cli: "--verbose, -v", default: false }],
        "signCert?": "string",
        // object ArkType defs are first-class: real object on the
        // call/mcp surface, JSON token on the cli
        "signKey?": { a: "string" },
      },
      narrow: (input, ctx) =>
        (input.signCert === undefined) === (input.signKey === undefined) ||
        ctx.reject({ expected: "--sign-cert and --sign-key together" }),
      // a sync handler is a sync typed function — no promise involved
      run: (input) => ({
        snapped: input.directory,
        depth: input.depth,
        verbose: input.verbose,
      }),
    },
    build: {
      description: "bundle entry files",
      safety: "action",
      input: {
        entries: ["string[] >= 1", "@", { cli: "<...entries>" }],
        outDir: [
          "string",
          "@",
          { description: "an output directory", default: "dist" },
        ],
      },
      output: { bundled: "string[]", into: "string" },
      run: (input) => ({ bundled: [...input.entries], into: input.outDir }),
    },
    cache: {
      description: "task cache",
      commands: {
        stat: {
          description: "cache statistics",
          safety: "read",
          output: { entries: "number" },
          run: () => ({ entries: 0 }),
        },
        clear: {
          description: "drop the cache",
          // dropping a cache is not recoverable from the tool
          safety: "destructive",
          // a void command: side effect only, nothing to report
          run: () => undefined,
        },
      },
    },
    disk: {
      description: "disk usage of cwd via ctx.exec",
      safety: "read",
      run: async (_input, ctx) => {
        const result = await ctx.exec("du", ["-sh", "."]);
        return { surface: ctx.surface, usage: result.stdout.trim() };
      },
    },
    git,
  },
});
