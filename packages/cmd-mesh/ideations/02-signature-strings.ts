/**
 * candidate 02 — signature strings
 *
 * The grammar itself lives in string keys, the way ArkType embeds
 * constraints in string definitions. `"serve <directory>"` declares the
 * command and its positionals; `"--port, -p"` declares an option and its
 * alias; the value is a plain ArkType definition, including ArkType's own
 * input-side defaults. Fig metadata attaches through a descriptor object
 * ({ type, ...meta }, as in candidate 01) when needed.
 *
 * bet: densest, most ArkType-native feel. Pays for it with template-literal
 * type machinery, and positionals have no natural metadata slot.
 */

export const mesh = program({
  name: "mesh",
  commands: {
    "serve <directory>": {
      description: "serve a directory over http",
      "--port, -p": "string.integer.parse = '3000'",
      "--verbose, -v": "boolean",
      run: (input: ServeInput) => {
        return { served: input.directory, port: input.port };
      },
    },
    "build <...entries>": {
      description: "bundle entry files",
      "--out-dir": { type: "string = 'dist'", description: "output directory", complete: "folders" },
      run: (input: BuildInput) => {
        // note: --out-dir camelizes to outDir
        return { bundled: input.entries, into: input.outDir };
      },
    },
  },
});

// function projection — command names derive from the signature's first word:
export const usage = async () => {
  const server = await mesh.serve({ directory: "./public" }); // port defaults via ArkType
  const artifacts = await mesh.build({ entries: ["src/index.ts"], outDir: "out" });
  return { server, artifacts };
};

// open problem, depicted not solved: where does `<directory>`'s completion
// source live? a supplementary `arguments: { directory: { complete: "folders" } }`
// block would reintroduce candidate 01 inside 02.

// ── depicted inference ──────────────────────────────────────────────────────
// the real contract infers these from the signature strings; the annotations
// above vanish and handlers write bare `(input) => ...`.
type ServeInput = { directory: string; port: number; verbose: boolean };
type BuildInput = { entries: string[]; outDir: string };

// ── stub surface (shape only; internals undesigned) ─────────────────────────
declare function program(def: any): any;
