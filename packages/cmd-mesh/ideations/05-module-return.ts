/**
 * candidate 05 — module return
 *
 * `program` does not return "a program" — it returns a module keyed by the
 * declared name, so the declaration's `name` is the single source of the
 * binding: `const { mesh } = program({ name: "mesh", ... })`. The value is
 * a callable module — the function itself, carrying subcommands, schemas,
 * and projections as properties. The CLI stops being the product; the
 * typed function module is, and argv is just one caller of it.
 *
 * precedent, not invention: ArkType scopes export modules keyed by
 * declared names, and ArkType's own `Type` is exactly this shape — a
 * callable carrying its introspection surface. the type mechanics are a
 * mapped type over one literal key: { [k in def["name"]]: Module<def> }.
 */

export const { mesh } = program({
  name: "mesh",
  description: "demo dev tool",
  commands: {
    serve: {
      description: "serve a directory over http",
      arguments: {
        directory: { type: "string", description: "directory to serve", complete: "folders" },
      },
      options: {
        port: { type: "string.integer.parse", alias: "p", default: 3000 },
        verbose: { type: "boolean", alias: "v" },
      },
      run: (input: ServeInput) => ({ served: input.directory, port: input.port }),
    },
    build: {
      description: "bundle entry files",
      arguments: {
        entries: { type: "string", variadic: true, complete: "filepaths" },
      },
      options: {
        outDir: { type: "string", default: "dist", complete: "folders" },
      },
      run: (input: BuildInput) => ({ bundled: input.entries, into: input.outDir }),
    },
  },
});

// the module IS the function surface:
export const usage = async () => {
  const server = await mesh.serve({ directory: "./public", port: 8080 });
  const artifacts = await mesh.build({ entries: ["src/index.ts"] });

  // schemas are compiled ArkType Types, usable without running anything:
  //   mesh.serve.args            Type<{ directory: string; port: number; verbose: boolean }>
  //   mesh.serve.args.assert(x)  standalone validation, ArkType error surface
  //   mesh.spec                  the declaration back out as pure data (03's projection)
  //   mesh.main(argv)            the cli projection
  //   mesh.complete(line)        the completion projection

  return { server, artifacts };
};

// a single-command program collapses to a bare typed function:
export const { greet } = program({
  name: "greet",
  arguments: {
    who: { type: "string", description: "who to greet" },
  },
  run: (input: GreetInput) => `hello ${input.who}`,
});
//   await greet({ who: "tyler" })   and still   greet.args, greet.main(argv)

// symmetry: external() returns the same module shape, so the mesh composes
// by plain object reference — no adapter layer between internal and external:
//   const { git } = external({ bin: "git", ... })
//   program({ name: "mesh", commands: { ... }, externals: { git } })

// ── depicted inference ──────────────────────────────────────────────────────
type ServeInput = { directory: string; port: number; verbose: boolean };
type BuildInput = { entries: string[]; outDir: string };
type GreetInput = { who: string };

// ── stub surface (shape only; internals undesigned) ─────────────────────────
declare function program(def: any): any;
