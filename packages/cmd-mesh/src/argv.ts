import { Array, Config, Effect, Option, Record, String, pipe } from "effect"
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
  | { readonly _tag: "completionScript"; readonly shell: "zsh" | "bash" }

/** descend into subcommands while the head token names a child */
const route = (
  cmd: CompiledCommand,
  tokens: ReadonlyArray<string>
): readonly [CompiledCommand, ReadonlyArray<string>] =>
  pipe(
    Array.head(tokens),
    Option.flatMap((head) => Record.get(cmd.children, head)),
    Option.match({
      onNone: () => [cmd, tokens] as const,
      onSome: (child) => route(child, Array.drop(tokens, 1))
    })
  )

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
  const negations = Record.fromEntries(
    Array.flatMap(flags, (p): ReadonlyArray<readonly [string, CompiledParameter]> =>
      p.isBoolean && p.binding._tag === "flag"
        ? [[String.replace("--", "--no-")(p.binding.name), p] as const]
        : [])
  )
  return { byToken, negations }
}

interface ScanState {
  readonly record: globalThis.Record<string, unknown>
  readonly positionals: ReadonlyArray<CompiledParameter>
  readonly onlyPositionals: boolean
}

const assignPositional = (
  cmd: CompiledCommand,
  state: ScanState,
  token: string
): Effect.Effect<ScanState, UnexpectedArgument> =>
  pipe(
    Array.head(state.positionals),
    Option.match({
      onNone: () => Effect.fail(new UnexpectedArgument({ path: cmd.path, token })),
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

const scan = (
  cmd: CompiledCommand,
  table: FlagTable,
  tokens: ReadonlyArray<string>,
  state: ScanState
): Effect.Effect<ScanState, ArgvError> =>
  pipe(
    Array.head(tokens),
    Option.match({
      onNone: () => Effect.succeed(state),
      onSome: (token) => {
        const rest = Array.drop(tokens, 1)
        if (state.onlyPositionals || !String.startsWith("-")(token)) {
          return assignPositional(cmd, state, token).pipe(
            Effect.flatMap((next) => scan(cmd, table, rest, next))
          )
        }
        if (token === "--") {
          return scan(cmd, table, rest, { ...state, onlyPositionals: true })
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
              onSome: (p) =>
                scan(cmd, table, rest, { ...state, record: { ...state.record, [p.key]: value } })
            })
          )
        }
        const negated = Record.get(table.negations, token)
        if (Option.isSome(negated)) {
          return scan(cmd, table, rest, {
            ...state,
            record: { ...state.record, [negated.value.key]: false }
          })
        }
        return pipe(
          Record.get(table.byToken, token),
          Option.match({
            onNone: () =>
              Effect.fail(
                new UnknownFlag({ path: cmd.path, flag: token, near: nearest(token, Record.keys(table.byToken)) })
              ),
            onSome: (p) => {
              if (p.isBoolean) {
                return scan(cmd, table, rest, { ...state, record: { ...state.record, [p.key]: true } })
              }
              return pipe(
                Array.head(rest),
                Option.match({
                  onNone: () => Effect.fail(new MissingFlagValue({ path: cmd.path, flag: token })),
                  onSome: (value) =>
                    scan(cmd, table, Array.drop(rest, 1), {
                      ...state,
                      record: { ...state.record, [p.key]: value }
                    })
                })
              )
            }
          })
        )
      }
    })
  )

/** argv > env: fill absent flag params from their declared env variables */
const applyEnv = (
  cmd: CompiledCommand,
  record: globalThis.Record<string, unknown>
): Effect.Effect<globalThis.Record<string, unknown>> =>
  Effect.reduce(
    Array.filter(cmd.parameters, (p) => Option.isSome(p.env) && record[p.key] === undefined),
    () => record,
    (acc, p: CompiledParameter) =>
      Effect.gen(function*() {
        const value = yield* Config.option(Config.string(Option.getOrThrow(p.env)))
        return Option.match(value, {
          onNone: () => acc,
          onSome: (v) => ({ ...acc, [p.key]: v })
        })
      }).pipe(Effect.orElseSucceed(() => acc))
  )

const hasHelpToken = Array.some<string>((t) => t === "--help" || t === "-h")

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
    if (Array.head(argv).pipe(Option.contains("mcp")) && Option.isNone(Record.get(root.children, "mcp"))) {
      return { _tag: "mcp" } as const
    }
    // shell-completion callback: everything after the marker is the word
    // list, last word being the one under the cursor
    if (Array.head(argv).pipe(Option.contains("__complete"))) {
      return { _tag: "complete", words: Array.drop(argv, 1) } as const
    }
    if (
      Array.head(argv).pipe(Option.contains("completion"))
      && Option.isNone(Record.get(root.children, "completion"))
    ) {
      const shell = Option.getOrElse(Array.head(Array.drop(argv, 1)), () => "zsh")
      return { _tag: "completionScript", shell: shell === "bash" ? "bash" : "zsh" } as const
    }
    if (hasHelpToken(argv)) {
      const [command] = route(root, Array.filter(argv, (t) => !String.startsWith("-")(t)))
      return { _tag: "help", command } as const
    }
    if (Array.head(argv).pipe(Option.contains("--version"))) {
      return { _tag: "version" } as const
    }
    const [command, routedRest] = route(root, argv)
    // reserved --json output flag, honored unless the command claims it
    const table0 = flagTable(command)
    const jsonReserved = Option.isNone(Record.get(table0.byToken, "--json"))
    const json = jsonReserved && Array.contains(routedRest, "--json")
    const rest = json ? Array.filter(routedRest, (t) => t !== "--json") : routedRest
    if (command === root && Option.isSome(Array.head(rest)) && !Record.isEmptyRecord(root.children)) {
      const head = Option.getOrThrow(Array.head(rest))
      if (!String.startsWith("-")(head) && root.parameters.length === 0) {
        return yield* new CommandNotFound({
          path: root.path,
          token: head,
          near: nearest(head, Record.keys(root.children))
        })
      }
    }
    const scanned = yield* scan(command, table0, rest, {
      record: {},
      positionals: Array.filter(command.parameters, (p) => p.binding._tag === "positional"),
      onlyPositionals: false
    })
    const withEnv = yield* applyEnv(command, scanned.record)
    return { _tag: "run", command, record: withEnv, json } as const
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
