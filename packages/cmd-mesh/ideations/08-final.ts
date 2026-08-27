/**
 * candidate 08 — final iteration
 *
 * 07 with four revisions. The reframe underneath them: the declaration
 * defines TOOLS — typed functions with a rich schema — and CLI and MCP are
 * peer projections of the same data. The line between "CLI command" and
 * "MCP tool" is thin (both are a named, described, typed function invoked
 * with a bag of arguments), so nothing in the core model is CLI-shaped;
 * CLI-ness and MCP-ness live in per-surface config blocks.
 *
 * REVISIONS OVER 07
 *
 * 1. Plain return. `program({ name: "mesh" })` returns the module
 *    directly; `name` stays in the declaration as the canonical program
 *    name for help, MCP tool prefixes, and mounting. The destructured
 *    `{ [name]: module }` return bought single-source naming at the cost
 *    of an exotic return shape — dropped.
 *
 * 2. Nesting by reference. `commands` values are inline declarations OR
 *    already-built modules — a program mounts other programs, and an
 *    `external` module mounts exactly the same way, so the separate
 *    `externals:` key is gone. One mounting mechanism, arbitrary depth,
 *    and subprograms remain independently usable/testable/publishable.
 *
 * 3. Surface blocks. A parameter's universal core is `type` +
 *    `description` (both surfaces need them). Everything argv-specific —
 *    usage notation, completion source, env fallback — moves under `cli:`,
 *    with the bare string shorthand `cli: "--port, -p"` ≡
 *    `cli: { usage: "--port, -p" }`. `mcp:` is the symmetric block at
 *    parameter, command, and program level (hidden, name overrides,
 *    annotations). MCP input/output schemas come free: the input object is
 *    one ArkType type and ArkType already projects to JSON Schema.
 *
 * 4. `ctx`. Handlers receive `(input, ctx)` where ctx is INTERPRETER-OWNED
 *    capability, not user dependency injection (user wiring still lives in
 *    module scope). `ctx.exec` is a thin tinyexec wrapper; routing process
 *    execution through ctx instead of a bare import makes every spawn
 *    observable per invocation, inherits the invocation's cwd/env, and is
 *    mockable in tests and sandboxable under MCP. `ctx.surface` says which
 *    projection invoked the handler ("cli" | "mcp" | "call").
 *
 * THE `external` SELL (and its de-risking)
 *
 * `ctx.exec` and `external` sit on opposite sides of one line: ctx.exec is
 * for a binary as IMPLEMENTATION DETAIL (one-off, stringly, private);
 * `external` is for a binary as SURFACE. Declaring the surface buys:
 *   - a typed programmatic API (`git.status({ short: true })` — args
 *     typechecked, defaults applied, stdout morphed to typed data) instead
 *     of hand-assembled argv arrays,
 *   - mountability — the binary's subcommands join your help/completions,
 *   - the killer: MCP projection of arbitrary binaries. `external` is the
 *     shortest path from "binary on disk" to "typed, described, schema'd
 *     agent tool" — which is the mesh thesis itself.
 * And the de-risk: because mounting is by reference, `external` is purely
 * additive. Adopting this contract does not require deciding it now; the
 * core is complete without it.
 */

// a subprogram is just a program — built independently, mounted by reference:
const cache = program({
  name: "cache",
  description: "task cache",
  commands: {
    clear: {
      description: "drop the cache",
      run: () => ({ cleared: true }),
    },
    stat: {
      description: "cache statistics",
      output: { entries: "number", bytes: "number" },
      run: () => ({ entries: 0, bytes: 0 }),
    },
  },
});

// a binary as surface — same grammar, fulfilled through tinyexec:
export const git = external({
  name: "git",
  bin: "git",
  commands: {
    status: {
      description: "working tree status",
      input: {
        short: { type: "boolean", cli: "--short, -s" },
      },
      // stdout contract; a morph here parses porcelain into structured data
      output: "string",
    },
    add: {
      description: "stage paths",
      input: {
        paths: { type: "string", cli: { usage: "<...paths>", complete: "filepaths" } },
      },
    },
  },
});

export const mesh = program({
  name: "mesh",
  version: "0.0.0",
  description: "demo dev tool",
  commands: {
    serve: {
      description: "serve a directory over http",
      input: {
        directory: {
          type: "string",
          description: "directory to serve",
          cli: { usage: "<directory>", complete: "folders" },
        },
        port: {
          type: "string.integer.parse = '3000'",
          description: "port to bind",
          cli: { usage: "--port, -p", env: "MESH_PORT" },
        },
        verbose: { type: "boolean", cli: "--verbose, -v" },
        tlsCert: { type: "string", cli: { complete: "filepaths" }, mcp: { hidden: true } },
        tlsKey: { type: "string", cli: { complete: "filepaths" }, mcp: { hidden: true } },
      },
      narrow: (input: ServeInput, ctx: NarrowContext) =>
        (input.tlsCert === undefined) === (input.tlsKey === undefined) ||
        ctx.reject("--tls-cert and --tls-key must be given together"),
      run: (input: ServeInput) => ({ served: input.directory, port: input.port }),
    },
    build: {
      description: "bundle entry files",
      input: {
        entries: { type: "string", cli: { usage: "<...entries>", complete: "filepaths" } },
        outDir: { type: "string = 'dist'", description: "output directory", cli: { complete: "folders" } },
      },
      output: { bundled: "string[]", into: "string" },
      run: (input: BuildInput) => ({ bundled: input.entries, into: input.outDir }),
    },
    snapshot: {
      description: "stage everything and report status",
      input: {
        short: { type: "boolean", cli: "--short, -s" },
      },
      run: async (input: SnapshotInput, ctx: Ctx) => {
        // binary as surface — typed, morphed, part of the mesh:
        const report = await git.status({ short: input.short });
        // binary as implementation detail — one-off, private, stringly:
        const size = await ctx.exec("du", ["-sh", "."]);
        return { report, size: size.stdout };
      },
      cli: { hidden: true },
      mcp: { name: "mesh_snapshot" }, // derived default; shown as override
    },
    cache, // mounted subprogram → mesh.cache.clear(), `mesh cache clear`
    git, //   mounted external   → mesh.git.status(),  `mesh git status -s`
  },
});

/**
 * GRAMMAR RULES (interpreter-owned, not per-declaration)
 *
 * - positionals: required `<x>`, optional `[x]`, variadic `<...xs>`;
 *   order of appearance in `input` is argv order.
 * - flags: optional unless `required: true`; absent and undefaulted ⇒
 *   `undefined`. `boolean` flags default false; `--no-x` negation free.
 * - omitted `cli` on a non-positional derives `--kebab-case` from the
 *   camelCase key (`outDir` ⇔ `--out-dir`).
 * - binding precedence: argv > cli.env > ArkType default.
 * - mcp tool names derive by flattening (`mesh cache clear` ⇒
 *   `mesh_cache_clear`); `mcp.name` overrides. `cli.hidden` / `mcp.hidden`
 *   drop a command or parameter from one surface without touching the other.
 * - `--help`/`--version`/completion are routed by `main` before handlers.
 */

// ── the module surface ──────────────────────────────────────────────────────
export const usage = async () => {
  const server = await mesh.serve({ directory: "./public", port: 8080 });
  const artifacts = await mesh.build({ entries: ["src/index.ts"] });
  const stats = await mesh.cache.stat();
  const direct = await git.status({ short: false });

  // compiled ArkType Types — validation and introspection without running:
  //   mesh.serve.args     mesh.build.output
  // projections, both peers of the function surface:
  //   mesh.main(argv)        the CLI (parse, route, render, exit code)
  //   mesh.complete(words)   shell completion
  //   mesh.help("serve")     rendered help
  //   mesh.mcp.tools         MCP tool list (JSON Schema via ArkType)
  //   mesh.mcp.serve()       attach as an MCP server
  //   mesh.spec              the declaration as pure data, functions stripped

  return { server, artifacts, stats, direct };
};

// entry point — the single imperative edge:
//   await mesh.main(process.argv.slice(2))

// ── depicted inference ──────────────────────────────────────────────────────
type ServeInput = {
  directory: string;
  port: number;
  verbose: boolean;
  tlsCert?: string;
  tlsKey?: string;
};
type BuildInput = { entries: string[]; outDir: string };
type SnapshotInput = { short: boolean };
type NarrowContext = { reject: (reason: string) => boolean };
type Ctx = {
  exec: (bin: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  surface: "cli" | "mcp" | "call";
};

// ── stub surface (shape only; internals undesigned) ─────────────────────────
declare function program(def: any): any;
declare function external(def: any): any;
