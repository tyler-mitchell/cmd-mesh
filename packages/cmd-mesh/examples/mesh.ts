// the shared example program: a small dev tool exercising every contract
// surface — used by demo.ts, bin.ts, and the test suite.
import { external, program } from "../src/index.js";

export const git = external({
  name: "git",
  commands: {
    status: {
      description: "working tree status",
      input: {
        short: { type: "boolean", cli: "--short, -s" },
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
    serve: {
      description: "serve a directory over http",
      input: {
        directory: {
          type: "string",
          description: "directory to serve",
          suggest: "folders",
          cli: "<directory>",
        },
        port: {
          type: "string.integer.parse = '3000'",
          description: "port to bind",
          cli: { usage: "--port, -p", env: "MESH_PORT" },
        },
        verbose: { type: "boolean", cli: "--verbose, -v" },
        tlsCert: { type: "string" },
        // object ArkType defs are first-class: real object on the
        // call/mcp surface, JSON token on the cli
        tlsKey: { type: { a: "string" } },
      },
      narrow: (input, ctx) =>
        (input.tlsCert === undefined) === (input.tlsKey === undefined) ||
        ctx.reject({ expected: "--tls-cert and --tls-key together" }),
      run: (input) => ({
        served: input.directory,
        port: input.port,
        verbose: input.verbose,
      }),
    },
    build: {
      description: "bundle entry files",
      input: {
        entries: { type: "string", cli: "<...entries>" },
        outDir: { type: "string = 'dist'", description: "output directory" },
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
