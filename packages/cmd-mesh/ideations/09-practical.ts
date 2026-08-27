/**
 * 09 — worked practical example of the adopted contract (08)
 *
 * `repokit`: a repo-ops tool that genuinely serves two audiences from one
 * declaration — a developer at a shell and an agent over MCP — because
 * every command is just a typed, described function and both surfaces are
 * projections.
 *
 * What makes the dual surface earn its keep here:
 * - `search`/`todos` return STRUCTURED data (output contracts): the CLI
 *   projection renders it, the MCP projection hands agents JSON matching
 *   the declared schema. No `--json` flag needed — that flag exists in
 *   other tools only because their output contract is a terminal string.
 * - `release` is `mcp: { hidden: true }` — humans only. `context` is
 *   `cli: { hidden: true }` — agents only. Same model, surfaces diverge
 *   by one key.
 * - `bump: "'patch' | 'minor' | 'major'"` — one ArkType union drives shell
 *   completion of the three words AND the JSON Schema enum.
 * - handlers shell out through `ctx.exec` (rg, git) — binaries as
 *   implementation detail; no external contracts needed for this tool.
 *
 * One grammar addition over 08: `main` routes a reserved `mcp` subcommand
 * to `mcp.serve()`, so the installed bin IS the MCP server:
 *
 *   humans:  repokit search "hack" -g "src/**"        (completion, --help)
 *   agents:  claude mcp add repokit -- repokit mcp
 */

export const repokit = program({
  name: "repokit",
  version: "0.1.0",
  description: "repository operations for humans and agents",
  commands: {
    search: {
      description: "search tracked files, structured results",
      input: {
        pattern: { type: "string", description: "regex to search", cli: "<pattern>" },
        glob: { type: "string", description: "limit to a glob", cli: "--glob, -g" },
      },
      output: [{ file: "string", line: "number", text: "string" }, "[]"],
      run: async (input: SearchInput, ctx: Ctx) => {
        const args = ["--json", input.pattern, ...(input.glob === undefined ? [] : ["--glob", input.glob])];
        const found = await ctx.exec("rg", args);
        return found.stdout
          .split("\n")
          .filter((line) => line.startsWith('{"type":"match"'))
          .map((line) => {
            const event = JSON.parse(line);
            return {
              file: event.data.path.text as string,
              line: event.data.line_number as number,
              text: (event.data.lines.text as string).trim(),
            };
          });
      },
    },
    todos: {
      description: "collect TODO/FIXME comments",
      input: {
        assignee: { type: "string", description: "filter by @assignee", cli: "--assignee, -a" },
      },
      output: [{ file: "string", line: "number", tag: "'TODO' | 'FIXME'", text: "string" }, "[]"],
      run: async (input: TodosInput, ctx: Ctx) => {
        const found = await ctx.exec("rg", ["--line-number", "TODO|FIXME"]);
        return found.stdout
          .split("\n")
          .filter(Boolean)
          .filter((line) => input.assignee === undefined || line.includes(`@${input.assignee}`))
          .map((line) => {
            const [file = "", lineNumber = "", ...rest] = line.split(":");
            const text = rest.join(":").trim();
            return {
              file,
              line: Number(lineNumber),
              tag: text.startsWith("FIXME") ? ("FIXME" as const) : ("TODO" as const),
              text,
            };
          });
      },
    },
    release: {
      description: "version bump, changelog, publish",
      mcp: { hidden: true }, // humans only — agents do not publish
      input: {
        bump: { type: "'patch' | 'minor' | 'major'", description: "semver increment", cli: "<bump>" },
        dryRun: { type: "boolean", description: "plan without writing", cli: "--dry-run, -n" },
        token: { type: "string", description: "registry token", cli: { env: "REPOKIT_TOKEN" } },
      },
      run: (input: ReleaseInput) => ({ planned: input.bump, dry: input.dryRun }),
    },
    context: {
      description: "orient an agent: branch, recent commits, dirty files",
      cli: { hidden: true }, // agents only — humans have git itself
      input: {
        commits: { type: "string.integer.parse = '10'", description: "recent commits to include" },
      },
      output: { branch: "string", recent: "string[]", dirty: "string[]" },
      run: async (input: ContextInput, ctx: Ctx) => {
        const branch = await ctx.exec("git", ["branch", "--show-current"]);
        const recent = await ctx.exec("git", ["log", "--oneline", "-n", String(input.commits)]);
        const dirty = await ctx.exec("git", ["status", "--porcelain"]);
        return {
          branch: branch.stdout.trim(),
          recent: recent.stdout.split("\n").filter(Boolean),
          dirty: dirty.stdout.split("\n").filter(Boolean),
        };
      },
    },
  },
});

// ── shipping it ─────────────────────────────────────────────────────────────
// package.json:  "bin": { "repokit": "./dist/bin.js" }
// bin.ts:        await repokit.main(process.argv.slice(2))
//
// the same install serves:
//   $ repokit search "parseConfig" --glob "src/**"     human, rendered table
//   $ repokit release minor --dry-run                  human, hidden from MCP
//   claude mcp config: { "command": "repokit", "args": ["mcp"] }
//     → tools repokit_search, repokit_todos, repokit_context
//       with JSON Schemas projected from the ArkType input/output types
//
// and everything is still a library:
//   const matches = await repokit.search({ pattern: "parseConfig" })

// ── depicted inference ──────────────────────────────────────────────────────
type SearchInput = { pattern: string; glob?: string };
type TodosInput = { assignee?: string };
type ReleaseInput = { bump: "patch" | "minor" | "major"; dryRun: boolean; token?: string };
type ContextInput = { commits: number };
type Ctx = {
  exec: (bin: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  surface: "cli" | "mcp" | "call";
};

// ── stub surface (shape only; internals undesigned) ─────────────────────────
declare function program(def: any): any;
