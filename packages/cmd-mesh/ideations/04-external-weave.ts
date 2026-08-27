/**
 * candidate 04 — external weave
 *
 * The leg the others do not settle: external binaries as first-class,
 * typed members of the mesh. An `external` contract describes an existing
 * binary in the same grammar as internal commands; the interpreter
 * fulfills calls through tinyexec, morphs stdout through an ArkType
 * `output` definition, and weaves the binary into the program's
 * completions, help, and argv routing.
 *
 * Authoring style here borrows candidate 01's tree; this candidate
 * composes with whichever of 01–03 wins.
 */

const git = external({
  bin: "git",
  commands: {
    status: {
      description: "working tree status",
      options: {
        short: { type: "boolean", alias: "s" },
      },
      // stdout contract — any ArkType morph works, so porcelain output
      // could parse straight into structured data instead of a string:
      output: "string",
    },
    add: {
      description: "stage paths",
      arguments: {
        paths: { type: "string", variadic: true, complete: "filepaths" },
      },
    },
  },
});

// direct call → tinyexec runs `git status -s`, output validated by contract:
//   const status = await git.status({ short: true })  // status: string

export const mesh = program({
  name: "mesh",
  commands: {
    snapshot: {
      description: "stage everything and report status",
      options: {
        short: { type: "boolean", alias: "s" },
      },
      run: async (input: SnapshotInput) => {
        // internal commands compose externals as plain typed functions:
        await git.add({ paths: ["."] });
        return git.status({ short: input.short });
      },
    },
  },
  // woven in: `mesh git status -s` routes through tinyexec, and git's
  // subcommands join mesh's completion/help surface:
  externals: { git },
});

export const usage = async () => {
  const report = await mesh.snapshot({ short: true });
  const direct = await git.status({ short: false });
  return { report, direct };
};

// ── depicted inference ──────────────────────────────────────────────────────
type SnapshotInput = { short: boolean };

// ── stub surface (shape only; internals undesigned) ─────────────────────────
declare function program(def: any): any;
declare function external(def: any): any;
