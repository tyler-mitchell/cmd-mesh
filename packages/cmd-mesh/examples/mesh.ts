// the shared example program: a small dev tool exercising every contract
// surface — used by demo.ts, bin.ts, and the test suite.
import { external, program } from "../src/index.js";

export const git = external({
  name: "git",
  commands: {
    status: {
      description: "working tree status",
      input: {
        short: [["boolean", "@", { cli: "--short, -s" }], "=", false],
        branch: [["boolean", "@", { cli: "--branch, -b" }], "=", false],
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
          [
            "string.integer.parse",
            "@",
            {
              description: "traversal depth",
              cli: "--depth, -d",
              env: "MESH_DEPTH",
            },
          ],
          "=",
          "2",
        ],
        verbose: [["boolean", "@", { cli: "--verbose, -v" }], "=", false],
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
      input: {
        entries: ["string[] >= 1", "@", { cli: "<...entries>" }],
        outDir: [
          ["string", "@", { description: "output directory" }],
          "=",
          "dist",
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
          output: { entries: "number" },
          run: () => ({ entries: 0 }),
        },
        clear: {
          description: "drop the cache",
          // a void command: side effect only, nothing to report
          run: () => undefined,
        },
      },
    },
    disk: {
      description: "disk usage of cwd via ctx.exec",
      run: async (_input, ctx) => {
        const result = await ctx.exec("du", ["-sh", "."]);
        return { surface: ctx.surface, usage: result.stdout.trim() };
      },
    },
    git,
  },
});
