/**
 * 10 — HKT contracts, at the authoring level
 *
 * Sketches only. Every line below is what a CONSUMER writes. The
 * machinery that would make it work is deliberately absent.
 *
 * The bet: commands are declared as named contracts and referenced by
 * name, instead of one object literal handed to `program()`. What that
 * buys, if it holds:
 *
 *   · a command's shape can be reused, derived, and referenced from
 *     other declarations, because it is a name rather than a position
 *   · a subtree nests by reference, so mounting stops being the only
 *     way to build depth
 *   · which surface a command reaches becomes part of the declaration
 *     rather than a filter applied afterwards
 *
 * Two things here are measured, not guessed: a contract containing other
 * contracts infers exactly two levels deep, and a bare handler written
 * against such a contract typechecks without annotation. Everything
 * else is a sketch.
 */

// ── A. Commands as named contracts ────────────────────────────────────
// The shapes are named once. A command references them by name, and so
// can anything else.

const mesh = registry({
  ServeInput: { port: "string.integer.parse = '3000'", entry: "string" },
  ServeOutput: { url: "string" },
  Serve: "Command<'serve', ServeInput, ServeOutput>",

  BuildInput: { entry: "string", minify: "boolean" },
  BuildOutput: { bytes: "number" },
  Build: "Command<'build', BuildInput, BuildOutput>"
})

// depicted inference: the annotation states what the contract supplies
mesh.Serve.run((input: { port: number; entry: string }) => ({ url: `:${input.port}` }))

// ── B. A subtree is a contract that holds contracts ───────────────────
// Depth without mounting a separate compiled program.

registry({
  Status: "Command<'status', StatusInput, TextOutput>",
  Commit: "Command<'commit', CommitInput, TextOutput>",
  Git: "Group<'git', { status: Status, commit: Commit }>"
})

// ── C. Derive one command's input from another ────────────────────────
// The reuse a descriptor record cannot express, because a name can be
// operated on and a position cannot.

registry({
  DeployInput: "Omit<ServeInput, 'entry'> & { target: 'staging' | 'production' }",
  Deploy: "Command<'deploy', DeployInput, ServeOutput>",

  // the dry run is the same command minus the side effect
  DryRun: "Command<'plan', DeployInput, { steps: string[] }>"
})

// ── D. The surface is declared, not filtered ──────────────────────────
// Today every visible runnable command becomes a tool and hiding is a
// flag. Here the agent surface is its own named thing, so a command that
// is not in it does not exist for agents at the type level.

registry({
  Serve: "Command<'serve', ServeInput, ServeOutput>",
  Destroy: "Command<'destroy', DestroyInput, TextOutput>",

  Cli: "Surface<'cli', { serve: Serve, destroy: Destroy }>",
  Agent: "Surface<'mcp', { serve: Serve }>"
})

// ── E. Safety as a set operation over the registry ────────────────────
// Rather than declaring safety per command and filtering later, the
// agent surface is derived from the commands that carry a safety.

registry({
  Read: "CommandsWhere<Mesh, safety = 'read'>",
  Agent: "Surface<'mcp', Read>"
})

// ── F. Ordering carried by the contract ───────────────────────────────
// repo-ops has a real procedure: a bump exists, then main is pushed,
// then the version PR opens, then it merges. Nothing today stops a
// caller invoking those out of order.

registry({
  Pending: "Release<'pending', { bumps: string[] }>",
  Pushed: "Release<'pushed', { bumps: string[], sha: string }>",
  Merged: "Release<'merged', { version: string }>",

  // each step names the state it consumes and the state it produces
  Push: "Step<Pending, Pushed>",
  Merge: "Step<Pushed, Merged>"
})

// ── G. A binary declared once, its commands referenced ────────────────
// The founding image, with the surface reusable by name.

const git = binary({
  StatusInput: { short: "boolean", branch: "boolean" },
  CommitInput: { message: "string", all: "boolean" },
  Status: "Command<'status', StatusInput, TextOutput>",
  Commit: "Command<'commit', CommitInput, TextOutput>"
})

await git.Commit({ message: "fix: parser", all: true })

// ── stubs so the sketches above read as shape ─────────────────────────

declare function registry(defs: Record<string, unknown>): any
declare function binary(defs: Record<string, unknown>): any

export { git, mesh }
