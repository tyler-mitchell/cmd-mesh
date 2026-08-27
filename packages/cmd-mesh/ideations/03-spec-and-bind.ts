/**
 * candidate 03 — spec and bind
 *
 * The spec is pure serializable data — no tuples, no functions, nothing
 * that could not live in a .json file. Handlers arrive separately through
 * `bind`, typed FROM the spec. Projections that need no behavior
 * (completion specs, help text, MCP tool listings, docs) consume the spec
 * alone without loading a single handler.
 *
 * bet: maximum homoiconicity and projectability; the cost is a second
 * authoring site and a path-keyed handler map to keep aligned.
 */

export const spec = {
  name: "mesh",
  description: "demo dev tool",
  commands: {
    serve: {
      description: "serve a directory over http",
      arguments: {
        directory: { type: "string", description: "directory to serve", complete: "folders" },
      },
      options: {
        port: { type: "string.integer.parse", alias: "p", description: "port to bind", default: 3000 },
        verbose: { type: "boolean", alias: "v" },
      },
    },
    build: {
      description: "bundle entry files",
      arguments: {
        entries: { type: "string", variadic: true, complete: "filepaths" },
      },
      options: {
        outDir: { type: "string", description: "output directory", complete: "folders", default: "dist" },
      },
    },
  },
} as const satisfies Spec;

export const mesh = bind(spec, {
  serve: (input: ServeInput) => {
    return { served: input.directory, port: input.port };
  },
  build: (input: BuildInput) => {
    return { bundled: input.entries, into: input.outDir };
  },
  // unresolved: nested subcommands would key as "remote add" path strings
});

// spec-only projections, no handlers loaded:
//   toCompletionSpec(spec)   toHelp(spec)   toMcpTools(spec)

// function projection:
export const usage = async () => {
  const server = await mesh.serve({ directory: "./public", port: 8080 });
  const artifacts = await mesh.build({ entries: ["src/index.ts"] });
  return { server, artifacts };
};

// ── depicted inference ──────────────────────────────────────────────────────
// `bind` infers these from the spec; the annotations above vanish and
// handlers write bare `(input) => ...`.
type ServeInput = { directory: string; port: number; verbose: boolean };
type BuildInput = { entries: string[]; outDir: string };

// ── stub surface (shape only; internals undesigned) ─────────────────────────
type Spec = { name: string; description?: string; commands: Record<string, object> };
declare function bind<const spec extends Spec>(spec: spec, handlers: any): any;
