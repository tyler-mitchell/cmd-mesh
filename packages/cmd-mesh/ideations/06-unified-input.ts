/**
 * candidate 06 — unified input
 *
 * One construct for everything the command consumes. arguments/options is
 * an argv-surface distinction, not a semantic one — both land as keys of
 * the same typed input object — so the declaration has a single `input`
 * map and each parameter's metadata states how argv binds it: `at:
 * "position"` for positionals, a derived `--key` flag otherwise.
 *
 * precedent: clap (an Arg without a flag name is positional) and argparse
 * (`add_argument("path")` vs `add_argument("--port")`).
 *
 * positional order rides on declaration order. runtime key order is
 * reliable in JS; nothing type-level needs order (handler inference is an
 * order-free object), so the wrinkle stays confined to help/completion
 * rendering, which is runtime anyway.
 */

export const { mesh } = program({
  name: "mesh",
  description: "demo dev tool",
  commands: {
    serve: {
      description: "serve a directory over http",
      input: {
        directory: { type: "string", at: "position", description: "directory to serve", complete: "folders" },
        port: { type: "string.integer.parse", alias: "p", description: "port to bind", default: 3000 },
        verbose: { type: "boolean", alias: "v" },
      },
      run: (input: ServeInput) => ({ served: input.directory, port: input.port }),
    },
    build: {
      description: "bundle entry files",
      input: {
        entries: { type: "string", at: "position", variadic: true, complete: "filepaths" },
        outDir: { type: "string", default: "dist", complete: "folders" },
      },
      run: (input: BuildInput) => ({ bundled: input.entries, into: input.outDir }),
    },
  },
});

// argv projection reads the metadata:
//   mesh serve ./public --port 8080 -v
//   mesh build src/a.ts src/b.ts --out-dir out
// function projection never distinguished them to begin with:
export const usage = async () => {
  const server = await mesh.serve({ directory: "./public", port: 8080 });
  const artifacts = await mesh.build({ entries: ["src/index.ts"] });
  return { server, artifacts };
};

// what the split candidates state structurally (arguments: vs options:),
// this candidate states as data — one fewer construct, but the cli shape
// is no longer legible from the block structure alone.

// ── depicted inference ──────────────────────────────────────────────────────
type ServeInput = { directory: string; port: number; verbose: boolean };
type BuildInput = { entries: string[]; outDir: string };

// ── stub surface (shape only; internals undesigned) ─────────────────────────
declare function program(def: any): any;
