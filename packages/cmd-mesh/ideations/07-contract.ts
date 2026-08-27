/**
 * candidate 07 — the contract
 *
 * The proposed final surface, decided on merit alone. Every choice below
 * names its justification; where it disagrees with 01–06, the disagreement
 * is the point.
 *
 * DECISIONS
 *
 * 1. `program` returns `{ [name]: module }` (05). The declaration's `name`
 *    is the single source of the binding, and the typed function module is
 *    the product — argv, completion, help, and MCP are all just callers.
 *    Mechanically a mapped type over one const literal key; the callable-
 *    with-properties shape is exactly ArkType's own `Type`.
 *
 * 2. One `input` map per command (06), not arguments/options blocks (01).
 *    The split is an argv-surface fact, not a semantic one — handler input
 *    is one object either way — and hardcoded blocks cannot absorb other
 *    binding modes (env, prompts). Binding is per-parameter metadata.
 *
 * 3. The argv binding is a `cli` string in standard usage notation:
 *    `"<directory>"` required positional, `"[dir]"` optional positional,
 *    `"<...entries>"` variadic, `"--port, -p"` flag with alias. This takes
 *    what signature strings (02) got right — surface syntax as data — and
 *    scopes it to where string parsing stays trivial: one binding, not a
 *    whole signature. It is also literally the help-text fragment, so the
 *    declaration reads like the usage line it produces. Omitted `cli` on a
 *    non-positional derives `--kebab-case` from the camelCase key.
 *
 * 4. Defaults are ArkType-native, input-side: `"string.integer.parse =
 *    '3000'"`. One semantic system instead of two: the default flows
 *    through the same morph pipeline as real input (a bad default cannot
 *    bypass validation, which meta-level output defaults would), and
 *    defaulted parameters become optional at every call surface for free.
 *    The whole command input compiles as ONE ArkType object type whose
 *    property definitions are the parameter `type` strings — parameter
 *    defs are property-position ArkType, nothing invented.
 *
 * 5. A parameter is a bare definition string or a flat descriptor
 *    `{ type, ...meta }`. `type` is safely reserved: an input parameter
 *    consumes exactly one CLI token, so nested object definitions never
 *    occur at input parameter position. (Outputs have no such constraint —
 *    see 7.)
 *
 * 6. Unified authoring, extracted spec — not spec-and-bind (03). Two
 *    authoring sites is a standing misalignment risk; `spec` on the module
 *    is the serializable projection (functions stripped), and zero-load
 *    consumption is a build-time extraction concern, not a contract shape.
 *
 * 7. Symmetric `output` contracts. Externals need one (a stdout morph is
 *    the only way a binary's result becomes typed data); internal commands
 *    take the same optional key because composition, MCP tool schemas, and
 *    `--json` rendering all want a declared output boundary. Output defs
 *    are unrestricted ArkType (objects fine).
 *
 * 8. Direct calls use assert semantics: invalid input throws ArkErrors.
 *    TS already guards typed call sites, so runtime failure there is a
 *    programmer error; boundary callers who want non-throwing validation
 *    have the compiled Type at `module.args`. The CLI projection catches
 *    and renders.
 *
 * 9. External binaries (04) are contracts in the same grammar, fulfilled
 *    through tinyexec, returning the same module shape — so the mesh
 *    composes by plain object reference and `externals` join completion,
 *    help, and argv routing. Nonzero exit rejects; the `output` contract
 *    applies to success stdout.
 *
 * DELIBERATE ABSENCES
 *
 * - No context/dependency injection. Handlers close over module scope;
 *   the host language already owns wiring. The contract owns exactly one
 *   boundary: input in, output out.
 * - No whole-signature strings (02). Template-literal parsing of full
 *   signatures is a heavy inference bet and positionals lose their
 *   metadata home.
 * - No Effect in the surface. Effect stays an internal runtime candidate;
 *   everything public is a plain promise.
 */

export const { git } = external({
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
        paths: { type: "string", cli: "<...paths>", complete: "filepaths" },
      },
    },
  },
});

export const { mesh } = program({
  name: "mesh",
  version: "0.0.0",
  description: "demo dev tool",
  commands: {
    serve: {
      description: "serve a directory over http",
      input: {
        directory: { type: "string", cli: "<directory>", description: "directory to serve", complete: "folders" },
        port: { type: "string.integer.parse = '3000'", cli: "--port, -p", env: "MESH_PORT", description: "port to bind" },
        verbose: { type: "boolean", cli: "--verbose, -v" },
        tlsCert: { type: "string", complete: "filepaths" },
        tlsKey: { type: "string", complete: "filepaths" },
      },
      // cross-field invariant — ArkType narrow over the assembled input:
      narrow: (input: ServeInput, ctx: NarrowContext) =>
        (input.tlsCert === undefined) === (input.tlsKey === undefined) ||
        ctx.reject("--tls-cert and --tls-key must be given together"),
      run: (input: ServeInput) => ({ served: input.directory, port: input.port }),
    },
    build: {
      description: "bundle entry files",
      input: {
        entries: { type: "string", cli: "<...entries>", complete: "filepaths" },
        outDir: { type: "string = 'dist'", description: "output directory", complete: "folders" },
      },
      // declared output boundary — unrestricted ArkType, objects fine:
      output: { bundled: "string[]", into: "string" },
      run: (input: BuildInput) => ({ bundled: input.entries, into: input.outDir }),
    },
    cache: {
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
    },
    snapshot: {
      description: "stage everything and report status",
      input: {
        short: { type: "boolean", cli: "--short, -s" },
      },
      run: async (input: SnapshotInput) => {
        await git.add({ paths: ["."] });
        return git.status({ short: input.short });
      },
    },
  },
  externals: { git },
});

/**
 * GRAMMAR RULES (interpreter-owned, not per-declaration)
 *
 * - positionals: required `<x>`, optional `[x]`, variadic `<...xs>`;
 *   order of appearance in `input` is argv order.
 * - flags: optional unless `required: true`; absent and undefaulted ⇒
 *   `undefined` in the input type. `boolean` flags default false; `--no-x`
 *   negation comes free.
 * - binding precedence: argv > env > ArkType default.
 * - camelCase keys ⇔ kebab-case flags both ways (`outDir` ⇔ `--out-dir`).
 * - `--help`/`--version`/completion requests are routed by `main` before
 *   any handler runs.
 */

// ── the module surface ──────────────────────────────────────────────────────
export const usage = async () => {
  // every command is a typed function; subcommands are nested modules:
  const server = await mesh.serve({ directory: "./public", port: 8080 });
  const artifacts = await mesh.build({ entries: ["src/index.ts"] }); // outDir defaulted
  const stats = await mesh.cache.stat();
  const report = await mesh.snapshot({ short: true });
  const direct = await git.status({ short: false });

  // compiled ArkType Types, usable without running anything:
  //   mesh.serve.args              Type of ServeInput — .assert / .allows / introspection
  //   mesh.build.output            Type of the declared output
  // projections:
  //   mesh.main(argv)              the CLI (parse, route, render, exit code)
  //   mesh.complete(words)         shell completion (Fig-grade, from the same data)
  //   mesh.help("serve")           rendered help
  //   mesh.spec                    the declaration as pure data, functions stripped —
  //                                what completion daemons and MCP projections consume

  return { server, artifacts, stats, report, direct };
};

// entry point — the single imperative edge:
//   await mesh.main(process.argv.slice(2))

// ── depicted inference ──────────────────────────────────────────────────────
// the real contract infers all of these from the declaration; annotations
// vanish and handlers write bare `(input) => ...`.
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

// ── stub surface (shape only; internals undesigned) ─────────────────────────
declare function program(def: any): any;
declare function external(def: any): any;
