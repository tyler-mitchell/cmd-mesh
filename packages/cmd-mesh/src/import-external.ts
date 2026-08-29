import { Array, Option, Record, String, pipe } from "effect"
import type { CommandSafety, ExternalCommandDecl, ExternalDecl, ParameterDescriptor } from "./types.js"

// importing a foreign command description into the declaration model.
// `format` names the source grammar and travels as data — the verb is
// this model's, never the source tool's.

/** a Fig argument: one positional slot, or an option's value slot */
export interface FigArg {
  readonly name: string
  readonly isOptional?: boolean
  readonly isVariadic?: boolean
  readonly template?: string
}

export interface FigOption {
  readonly name: string | ReadonlyArray<string>
  readonly description?: string
  readonly args?: FigArg
}

export interface FigSubcommand {
  readonly name: string
  readonly description?: string
  readonly args?: FigArg
  readonly options?: ReadonlyArray<FigOption>
}

/** what the source grammar cannot express, supplied per subcommand.
 * `safety` is required: a completion spec describes how to type a
 * command, never what it does, and an agent client reads a command with
 * no hints as destructive. */
export interface CommandCuration {
  readonly safety: CommandSafety
  /** exactly the flag tokens to keep — an uncurated program carries
   * 100-plus options per command */
  readonly flags: ReadonlyArray<string>
}

/** an import request in Fig's completion-spec grammar
 * (withfig/autocomplete) */
export interface FigImport {
  readonly format: "fig"
  readonly bin: string
  readonly subcommands: ReadonlyArray<FigSubcommand>
  readonly curation: Readonly<globalThis.Record<string, CommandCuration>>
}

export type ExternalImport = FigImport

/** the named suggestion sources this model resolves; any other Fig
 * template is runtime-only and carries no declarative meaning */
const completionSources: ReadonlyArray<string> = ["filepaths", "folders"]

const suggestOf = (template: string | undefined) =>
  pipe(
    Option.fromNullishOr(template),
    Option.filter((source) => Array.contains(completionSources, source)),
    Option.match({
      onNone: () => ({}),
      onSome: (suggest) => ({ suggest })
    })
  )

const describedBy = (description: string | undefined) =>
  Option.match(Option.fromNullishOr(description), {
    onNone: () => ({}),
    onSome: (described) => ({ description: described })
  })

const isLong = String.startsWith("--")

const isShort = (name: string): boolean => String.startsWith("-")(name) && !isLong(name)

const namesOf = (name: string | ReadonlyArray<string>): ReadonlyArray<string> =>
  String.isString(name) ? [name] : name

const positionalUsage = (arg: FigArg): string => {
  const token = arg.isVariadic === true ? `...${arg.name}` : arg.name
  return arg.isOptional === true ? `[${token}]` : `<${token}>`
}

const positionalParameter = (arg: FigArg): readonly [string, ParameterDescriptor] => [
  String.camelCase(arg.name),
  {
    type: "string",
    ...suggestOf(arg.template),
    cli: { usage: positionalUsage(arg) }
  }
]

const flagParameter = (option: FigOption): readonly [string, ParameterDescriptor] => {
  const names = namesOf(option.name)
  const long = pipe(
    Array.findFirst(names, isLong),
    Option.orElse(() => Array.head(names)),
    Option.getOrElse(() => "")
  )
  return [
    String.camelCase(long),
    {
      type: option.args === undefined ? "boolean" : "string",
      ...describedBy(option.description),
      ...(option.args === undefined ? {} : suggestOf(option.args.template)),
      cli: Option.match(Array.findFirst(names, isShort), {
        onNone: () => long,
        onSome: (short) => `${long}, ${short}`
      })
    }
  ]
}

const kept = (option: FigOption, allow: ReadonlyArray<string>): boolean =>
  Array.some(namesOf(option.name), (name) => Array.contains(allow, name))

const commandOf = (sub: FigSubcommand, curation: CommandCuration): ExternalCommandDecl => ({
  ...describedBy(sub.description),
  safety: curation.safety,
  // the positional leads: argv order follows declaration order
  input: Record.fromEntries([
    ...Option.match(Option.fromNullishOr(sub.args), {
      onNone: () => [] as ReadonlyArray<readonly [string, ParameterDescriptor]>,
      onSome: (arg) => [positionalParameter(arg)]
    }),
    ...pipe(
      sub.options ?? [],
      Array.filter((option) => kept(option, curation.flags)),
      Array.map(flagParameter)
    )
  ]),
  output: "string"
})

/** convert a foreign command description into an `external()`
 * declaration. runtime-only fields of the source grammar (Fig's
 * generators, insertValue, icon, priority) carry no declarative meaning
 * and drop; only curated subcommands reach the result. */
export const importExternal = (source: ExternalImport): ExternalDecl => ({
  name: source.bin,
  description: `the ${source.bin} binary as a typed surface`,
  commands: Record.fromEntries(
    pipe(
      source.subcommands,
      Array.map((sub) =>
        pipe(
          Record.get(source.curation, sub.name),
          Option.map((curation) => [sub.name, commandOf(sub, curation)] as const)
        )),
      Array.getSomes
    )
  )
})
