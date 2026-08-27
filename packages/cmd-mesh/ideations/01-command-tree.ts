/**
 * candidate 01 — command tree
 *
 * The program is one nested object literal. A parameter is a bare ArkType
 * definition string, or a flat descriptor object ({ type, ...meta }) when
 * Fig-grade metadata is needed. One interpreter (`program`) reads the tree
 * and hands back callable projections.
 *
 * `type` is safely reserved: a parameter consumes exactly one CLI token,
 * so nested ArkType object definitions never occur at parameter position.
 *
 * bet: explicit keys everywhere. Cheapest inference, most keystrokes.
 */

export const mesh = program({
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
      run: (input: ServeInput) => {
        return { served: input.directory, port: input.port };
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
      run: (input: BuildInput) => {
        return { bundled: input.entries, into: input.outDir };
      },
    },
  },
});

// cli projection — the single imperative edge, at the entry point:
//   await mesh.main(process.argv.slice(2))

// function projection — same commands, same validation, no argv:
export const usage = async () => {
  const server = await mesh.serve({ directory: "./public", port: 8080 });
  const artifacts = await mesh.build({ entries: ["src/index.ts"] }); // outDir defaults
  return { server, artifacts };
};

// ── depicted inference ──────────────────────────────────────────────────────
// the real contract infers these from the declaration; the annotations above
// vanish and handlers write bare `(input) => ...`.
type ServeInput = { directory: string; port: number; verbose: boolean };
type BuildInput = { entries: string[]; outDir: string };

// ── stub surface (shape only; internals undesigned) ─────────────────────────
declare function program(def: any): any;
