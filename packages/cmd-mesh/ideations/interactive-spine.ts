/**
 * SPINE — interactive cli projection (guided invocation)
 *
 * Entry: `module.cli.interactive(path?)` → Promise<number> (exit code).
 * Result: one command dispatched through the SAME `runCli` path argv
 * uses — the walk below only ASSEMBLES argv tokens. No second parse,
 * dispatch, render, or exit-code owner exists.
 *
 * Authorities:
 * - compiled model (compile.ts): CompiledCommand/CompiledParameter own
 *   children, visibility, bindings, defaults, unit candidates, suggest
 *   sources, and the per-parameter token morph `inner`.
 * - argv grammar (argv.ts): the assembled tokens obey the one token
 *   walk — child names descend, flags are position-free, `--` fences
 *   hyphen-leading positional values (external.test.ts precedent).
 * - dispatch/render/exit (module.ts runCli): usage 2 / runtime 1 /
 *   carried exitCode; cancellation here adds 130 (128+SIGINT), the
 *   shell convention for a user-interrupted invocation.
 * - prompts: @clack/prompts (bombshell-dev — the @bomb.sh/tab vendor).
 *   validate() hosts ArkType assert; cancel symbols end the walk.
 *
 * Praxis: internal composition is Effect (Effect.gen; clack calls cross
 * the boundary through Effect.tryPromise exactly like tab generators).
 * This artifact shows the composition unwrapped for review clarity —
 * the implementation translates 1:1 into Effect.fn/gen.
 */

// real internal imports; the clack primitives are declared below as a
// proven boundary (the dependency lands at implementation) — this keeps
// the artifact inside the package typecheck like 08-final.ts's stubs
import type { CompiledCommand, CompiledParameter } from "../src/compile.js"
import type { SuggestContext } from "../src/types.js"

// @clack/prompts surface used by the spine (pin + verify names against
// the pinned release at implementation; confirm/text/autocomplete are
// promptParameter's tools and appear in its leaf record)
declare const intro: (title: string) => void
declare const outro: (message: string) => void
declare const select: <T>(config: {
  message: string
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>
  initialValue?: T | undefined
}) => Promise<T | symbol>
declare const isCancel: (value: unknown) => value is symbol

/** module.ts wires this beside run/help/complete:
 *
 *   cli: {
 *     run, help, complete,
 *     interactive: (path?) =>
 *       promptArgv(compiled, makeSuggestCtx(), path).then((argv) =>
 *         argv === CANCELLED
 *           ? 130
 *           : runtime.runPromise(runCli(runtime, compiled, version, argv))
 *       )
 *   }
 *
 * CliProjection (types.ts) gains:
 *   interactive(path?: ReadonlyArray<string>): Promise<number>
 * main() is untouched — bins opt in with `await mesh.cli.interactive()`.
 * Non-TTY stdin fails fast before any prompt: exit 1 with one stderr
 * line (agents get told to use the non-interactive form).
 */
export const CANCELLED: unique symbol = Symbol.for("cmd-mesh/interactive-cancelled")

export const promptArgv = async (
  root: CompiledCommand,
  suggest: SuggestContext,          // makeCtx-derived: exec + project + workspace
  path?: ReadonlyArray<string>      // pre-selected words, alias-aware like cli.help
): Promise<ReadonlyArray<string> | typeof CANCELLED> => {
  intro(root.name)

  // ── phase 1: command selection ───────────────────────────────────
  // descend from the root (or the node `path` resolves to via childFor,
  // alias-aware like helpFor; an unresolvable word stops resolution and
  // selection simply begins at the deepest resolved node — the user
  // sees where they are from the label, no error path needed) until a
  // command with no further choice is reached. a node carrying BOTH a
  // run handler and children offers its children plus a "run this
  // command" self option — choosing self ends the walk there.
  let command = resolveStart(root, path)
  while (hasChoice(command)) {
    const visible = Object.values(command.children).filter((child) => !child.cliHidden)
    // a group's cliDefault is the select's initialValue, not an auto-pick
    const chosen = await select({
      message: pathLabel(command),
      options: [
        ...(isRunnable(command) ? [selfOption(command)] : []),
        ...visible.map((child) => ({
          value: child,
          label: lastWord(child),
          hint: child.description
        }))
      ],
      initialValue: defaultChild(command)
    })
    if (isCancel(chosen)) return cancelled()
    if (chosen === command) break // the self option: run this node
    command = chosen
  }

  // ── phase 2: one prompt per visible parameter, declaration order ──
  // compiled.parameters is already argv order for positionals; flags are
  // position-free so a single pass covers both. root-merged globals are
  // in `parameters` (marked global) and prompt like any other.
  const flags: Array<string> = []
  const positionals: Array<string> = []
  for (const p of command.parameters) {
    if (p.cliHidden) continue
    // generators see the same word vocabulary completion gives them:
    // the path words (root name excluded) plus tokens assembled so far,
    // in final argv order — one identity for "the words" everywhere
    const wordsSoFar = [...pathWords(command, root), ...flags, ...positionals]
    const value = await promptParameter(p, suggest, wordsSoFar)
    if (value === CANCELLED) return cancelled()
    if (value === undefined) continue                    // optional, skipped → defaults downstream
    emit(p, value, { flags, positionals })               // token grammar below
  }

  // ── phase 3: preview + dispatch hand-off ─────────────────────────
  // teach the non-interactive form, then hand the EXACT argv to runCli.
  // flags precede positionals; a hyphen-leading positional value forces
  // the `--` fence (the external argv-reconstruction rule, reused).
  const argv = [...pathWords(command, root), ...flags, ...fence(positionals)]
  outro(`> ${[root.name, ...argv].join(" ")}`)
  return argv
}

// ── the parameter prompt: one dispatch table, no free-form branching ──
// order of applicability is a spine fact:
//   boolean → confirm
//   enumerable units → select (defaulted value preselected)
//   named source ("files"/"filepaths"/"folders"/"directories")
//     → autocomplete over the same readdir listing completion shows
//   static suggestions and/or generator → autocomplete (generator runs
//     ONCE before the prompt with the words-so-far, exactly the
//     completeEffect contract; failures degrade to static candidates)
//   otherwise → text, validated per submit by the parameter's own token
//     morph: `p.inner(value)` returning type.errors → its summary is
//     the inline error. THE prompt-time validator IS the parse-time
//     type — no drift is possible.
// optionality: an optional parameter's empty submission returns
// undefined (omit token; compiled defaults apply at parseTokens).
// a required parameter's empty submission re-prompts via validate.
// variadic: text/autocomplete loops until an empty submission; each
// entry re-emits the flag (repeatable-flag grammar) or appends a
// positional.
declare const promptParameter: (
  p: CompiledParameter,
  suggest: SuggestContext,
  wordsSoFar: ReadonlyArray<string>
) => Promise<string | ReadonlyArray<string> | boolean | undefined | typeof CANCELLED>

// ── token emission (the argv grammar, verbatim from argv.ts rules) ──
// boolean true      → "--flag"          (nothing when false)
// boolean false     → "--no-flag"       (only when defaulted true)
// flag value        → "--flag", value   (variadic: repeated pairs;
//   REVISED at implementation: a declared flag consumes its next token
//   unconditionally (argv.ts walk), so hyphen-leading values need no
//   `=` form — the earlier rule was falsified by a consumer witness
//   and removed. invoke.ts's external reconstruction is the precedent.)
// positional        → value             (variadic: spread, in order)
declare const emit: (
  p: CompiledParameter,
  value: string | ReadonlyArray<string> | boolean,
  out: { flags: Array<string>; positionals: Array<string> }
) => void

// `--` fence exactly when some positional starts with "-"
declare const fence: (positionals: ReadonlyArray<string>) => ReadonlyArray<string>

// closed leaves (structure-free): resolveStart = helpFor's childFor
// reduction, stopping at the deepest resolved node on an unknown word;
// hasChoice = has visible children (a childless node never selects);
// isRunnable = run or external present; selfOption = the current node
// as a "run <name>" row; pathWords = command.path minus the root name;
// lastWord/pathLabel/defaultChild = display projections;
// cancelled = clack cancel("cancelled") then CANCELLED.
declare const resolveStart: (root: CompiledCommand, path?: ReadonlyArray<string>) => CompiledCommand
declare const hasChoice: (cmd: CompiledCommand) => boolean
declare const isRunnable: (cmd: CompiledCommand) => boolean
declare const selfOption: (cmd: CompiledCommand) => { value: CompiledCommand; label: string; hint: string }
declare const pathWords: (cmd: CompiledCommand, root: CompiledCommand) => ReadonlyArray<string>
declare const lastWord: (cmd: CompiledCommand) => string
declare const pathLabel: (cmd: CompiledCommand) => string
declare const defaultChild: (cmd: CompiledCommand) => CompiledCommand | undefined
declare const cancelled: () => typeof CANCELLED

/**
 * CLOSED-LEAF RECORD
 * - promptParameter: owner interactive.ts; in CompiledParameter +
 *   SuggestContext + words; out token value(s)/boolean/undefined/
 *   CANCELLED; pre: p not cliHidden; post: value satisfies p.inner or
 *   CANCELLED/undefined; effects: terminal I/O only; errors: clack
 *   cancel → CANCELLED (never throws); evidence: clack text/select/
 *   confirm/autocomplete cover every row of the dispatch table,
 *   validate() hosts p.inner.
 * - emit/fence: pure token assembly; the grammar rows above are the
 *   whole contract; evidence: identical rules already pass
 *   external.test.ts for reconstructed argv.
 * - resolveStart/isGroup/pathWords/…: field projections of
 *   CompiledCommand; two conforming implementations cannot differ
 *   structurally.
 *
 * PROVEN BOUNDARIES
 * - runCli dispatch + exit codes (module.ts, exercised by the whole
 *   suite); childFor alias resolution (argv.ts); unitCandidates +
 *   named-source listings (completion.ts); clack primitives
 *   (@clack/prompts — pin exact version at implementation; export
 *   names verified against the pinned README before first import).
 *
 * DISPLACED OWNERS: none — this projection adds a front-end; nothing
 * existing moves or duplicates. types.ts CliProjection and module.ts
 * cli wiring are the only two touched seams outside the new file.
 *
 * OPEN TO RATIFICATION (the only judgment calls; each has a default):
 * 1. exit 130 on cancel (128+SIGINT) — default YES.
 * 2. preview line via outro before dispatch — default YES (teaches the
 *    non-interactive form; Fig lineage).
 * 3. dependency: @clack/prompts as a regular dependency of cmd-mesh —
 *    default YES (same vendor as tab, no React weight; Ink rejected
 *    for guided invocation, remains open for a future full-TUI arc).
 */
