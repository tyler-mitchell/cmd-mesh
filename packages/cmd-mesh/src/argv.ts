import { Array, Effect, Option, Record, String, pipe } from "effect"
import type { CompiledCommand, CompiledParameter } from "./compile.js"
import { CommandNotFound, MissingFlagValue, UnexpectedArgument, UnknownFlag } from "./errors.js"
import { InvalidInput } from "./errors.js"
import { parseWith } from "./invoke.js"
import { nearest } from "./suggest.js"

export type ArgvError = CommandNotFound | UnknownFlag | MissingFlagValue | UnexpectedArgument | InvalidInput

export type Routed =
  | {
    readonly _tag: "run"
    readonly command: CompiledCommand
    readonly record: globalThis.Record<string, unknown>
    /** `--json` was passed and the command declares no flag of that name */
    readonly json: boolean
  }
  | { readonly _tag: "help"; readonly command: CompiledCommand }
  | { readonly _tag: "version" }
  | { readonly _tag: "mcp" }
  | { readonly _tag: "complete"; readonly words: ReadonlyArray<string> }
  | { readonly _tag: "completionScript"; readonly shell: string }

interface FlagTable {
  readonly byToken: Readonly<globalThis.Record<string, CompiledParameter>>
  readonly negations: Readonly<globalThis.Record<string, CompiledParameter>>
}

const flagTable = (cmd: CompiledCommand): FlagTable => {
  const flags = Array.filter(cmd.parameters, (p) => p.binding._tag === "flag")
  const byToken = Record.fromEntries(
    Array.flatMap(flags, (p): ReadonlyArray<readonly [string, CompiledParameter]> =>
      p.binding._tag === "flag"
        ? Array.map(Array.prepend(p.binding.aliases, p.binding.name), (t) => [t, p] as const)
        : [])
  )
  // negations derive only from long-form names — a short-only boolean has
  // nothing to negate — and a declared flag always owns its own token
  const negations = pipe(
    Record.fromEntries(
      Array.flatMap(flags, (p): ReadonlyArray<readonly [string, CompiledParameter]> =>
        p.isBoolean && p.binding._tag === "flag" && String.startsWith("--")(p.binding.name)
          ? [[String.replace("--", "--no-")(p.binding.name), p] as const]
          : [])
    ),
    Record.filter((_, token) => Option.isNone(Record.get(byToken, token)))
  )
  return { byToken, negations }
}

const hasPositionals = (cmd: CompiledCommand): boolean =>
  Array.some(cmd.parameters, (p) => p.binding._tag === "positional")

interface WalkState {
  readonly record: globalThis.Record<string, unknown>
  readonly positionals: ReadonlyArray<CompiledParameter>
  readonly onlyPositionals: boolean
  readonly help: boolean
  readonly json: boolean
}

interface Walked {
  readonly command: CompiledCommand
  readonly record: globalThis.Record<string, unknown>
  readonly help: boolean
  readonly json: boolean
}

const assignPositional = (
  cmd: CompiledCommand,
  state: WalkState,
  token: string
): Effect.Effect<WalkState, ArgvError> =>
  pipe(
    Array.head(state.positionals),
    Option.match({
      onNone: () =>
        Record.isEmptyRecord(cmd.children) || state.onlyPositionals
          ? Effect.fail(new UnexpectedArgument({ path: cmd.path, token }))
          // a bare token aimed at a command with children and no free
          // positional slot is a mistyped subcommand, not a stray argument
          : Effect.fail(
            new CommandNotFound({
              path: cmd.path,
              token,
              near: nearest(token, Record.keys(cmd.children))
            })
          ),
      onSome: (p) =>
        p.binding._tag === "positional" && p.binding.variadic
          ? Effect.succeed({
            ...state,
            record: {
              ...state.record,
              [p.key]: Array.append((state.record[p.key] as ReadonlyArray<string> | undefined) ?? [], token)
            }
          })
          : Effect.succeed({
            ...state,
            record: { ...state.record, [p.key]: token },
            positionals: Array.drop(state.positionals, 1)
          })
    })
  )

/** one pass over the tokens, descending as it goes. at each step the
 * current command's own vocabulary decides what the head token is: a
 * child name descends (so flags are position-free and the subcommand
 * path is positional — `serve --port 4000 start`), a declared flag or
 * negation records its value, an undeclared `--help`/`--json` sets the
 * reserved marker and the walk continues (help lands on the deepest
 * command the line reaches), `--` locks the rest to positionals, and a
 * bare token fills a positional slot or is a mistyped subcommand. */
const walk = (
  cmd: CompiledCommand,
  table: FlagTable,
  tokens: ReadonlyArray<string>,
  state: WalkState
): Effect.Effect<Walked, ArgvError> =>
  pipe(
    Array.head(tokens),
    Option.match({
      onNone: () =>
        Effect.succeed({ command: cmd, record: state.record, help: state.help, json: state.json }),
      onSome: (token) => {
        const rest = Array.drop(tokens, 1)
        if (state.onlyPositionals || !String.startsWith("-")(token)) {
          if (!state.onlyPositionals && Option.isSome(Record.get(cmd.children, token))) {
            const child = Option.getOrThrow(Record.get(cmd.children, token))
            // ancestor flag values routed the line; the leaf owns its input
            return walk(child, flagTable(child), rest, {
              ...state,
              record: {},
              positionals: Array.filter(child.parameters, (p) => p.binding._tag === "positional")
            })
          }
          return assignPositional(cmd, state, token).pipe(
            Effect.flatMap((next) => walk(cmd, table, rest, next))
          )
        }
        if (token === "--") {
          return walk(cmd, table, rest, { ...state, onlyPositionals: true })
        }
        const eq = String.indexOf("=")(token)
        if (Option.isSome(eq)) {
          const name = String.substring(0, eq.value)(token)
          const value = String.substring(eq.value + 1)(token)
          return pipe(
            Record.get(table.byToken, name),
            Option.match({
              onNone: () =>
                Effect.fail(
                  new UnknownFlag({ path: cmd.path, flag: name, near: nearest(name, Record.keys(table.byToken)) })
                ),
              // the raw token is recorded verbatim: the token boundary's
              // ArkType morph owns literal coercion (booleans included)
              onSome: (p) =>
                walk(cmd, table, rest, { ...state, record: { ...state.record, [p.key]: value } })
            })
          )
        }
        // a declared flag owns its token before any reserved meaning or
        // derived negation
        const declared = Record.get(table.byToken, token)
        if (Option.isSome(declared)) {
          const p = declared.value
          if (p.isBoolean) {
            return walk(cmd, table, rest, { ...state, record: { ...state.record, [p.key]: true } })
          }
          return pipe(
            Array.head(rest),
            Option.match({
              onNone: () => Effect.fail(new MissingFlagValue({ path: cmd.path, flag: token })),
              onSome: (value) =>
                walk(cmd, table, Array.drop(rest, 1), {
                  ...state,
                  record: { ...state.record, [p.key]: value }
                })
            })
          )
        }
        if (token === "--help" || token === "-h") {
          return walk(cmd, table, rest, { ...state, help: true })
        }
        if (token === "--json") {
          return walk(cmd, table, rest, { ...state, json: true })
        }
        const negated = Record.get(table.negations, token)
        if (Option.isSome(negated)) {
          return walk(cmd, table, rest, {
            ...state,
            record: { ...state.record, [negated.value.key]: false }
          })
        }
        return Effect.fail(
          new UnknownFlag({ path: cmd.path, flag: token, near: nearest(token, Record.keys(table.byToken)) })
        )
      }
    })
  )

/** argv > env > default; an empty export counts as unset. Read directly —
 * this is the platform boundary, and the value must reach the token
 * pipeline exactly as the shell holds it. */
const applyEnv = (
  cmd: CompiledCommand,
  record: globalThis.Record<string, unknown>
): Effect.Effect<globalThis.Record<string, unknown>> =>
  Effect.sync(() =>
    pipe(
      cmd.parameters,
      Array.filter((p) => Option.isSome(p.env) && record[p.key] === undefined),
      Array.reduce(record, (acc, p) =>
        pipe(
          Option.fromNullishOr(globalThis.process.env[Option.getOrThrow(p.env)]),
          Option.filter(String.isNonEmpty),
          Option.match({
            onNone: () => acc,
            onSome: (value) => ({ ...acc, [p.key]: value })
          })
        ))
    ))

/** full cli routing: subcommands, reserved tokens, flags, positionals */
export const routeArgv = (
  root: CompiledCommand,
  rawArgv: ReadonlyArray<string>
): Effect.Effect<Routed, ArgvError> =>
  Effect.gen(function*() {
    // runners like `pnpm run` prefix forwarded args with "--"; a leading
    // separator before any routing has happened carries no information
    const argv = Array.head(rawArgv).pipe(Option.contains("--"))
      ? Array.drop(rawArgv, 1)
      : rawArgv
    // reserved subcommands yield to the program's own vocabulary: a child
    // with the name, or a root positional that could receive the token
    const reservedFree = !hasPositionals(root)
    const head = Array.head(argv)
    if (
      reservedFree
      && head.pipe(Option.contains("mcp"))
      && Option.isNone(Record.get(root.children, "mcp"))
    ) {
      return { _tag: "mcp" } as const
    }
    // the tab protocol: `complete <shell>` prints a script, `complete --
    // <words>` answers a completion request from the shell
    if (
      reservedFree
      && head.pipe(Option.contains("complete"))
      && Option.isNone(Record.get(root.children, "complete"))
    ) {
      const next = Array.head(Array.drop(argv, 1))
      return next.pipe(Option.contains("--"))
        ? { _tag: "complete", words: Array.drop(argv, 2) } as const
        : { _tag: "completionScript", shell: Option.getOrElse(next, () => "zsh") } as const
    }
    const versionDeclared = Array.some(root.parameters, (p) =>
      p.binding._tag === "flag"
      && Array.contains(Array.prepend(p.binding.aliases, p.binding.name), "--version"))
    if (head.pipe(Option.contains("--version")) && !versionDeclared) {
      return { _tag: "version" } as const
    }
    const walked = yield* walk(root, flagTable(root), argv, {
      record: {},
      positionals: Array.filter(root.parameters, (p) => p.binding._tag === "positional"),
      onlyPositionals: false,
      help: false,
      json: false
    })
    if (walked.help) {
      return { _tag: "help", command: walked.command } as const
    }
    const withEnv = yield* applyEnv(walked.command, walked.record)
    return { _tag: "run", command: walked.command, record: withEnv, json: walked.json } as const
  })

/** tokens record → handler input: the token boundary morphs cli strings
 * into values, then the value boundary applies remaining defaults,
 * requiredness for structured parameters, and command-level narrow */
export const parseTokens = (
  command: CompiledCommand,
  record: globalThis.Record<string, unknown>
): Effect.Effect<globalThis.Record<string, unknown>, InvalidInput> =>
  parseWith(
    command.tokenType,
    record,
    (summary) => new InvalidInput({ path: command.path, summary })
  ).pipe(
    Effect.flatMap((values) =>
      parseWith(
        command.valueType,
        values,
        (summary) => new InvalidInput({ path: command.path, summary })
      )
    )
  ) as Effect.Effect<globalThis.Record<string, unknown>, InvalidInput>
