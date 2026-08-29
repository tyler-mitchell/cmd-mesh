import { Array, Option, Record, String, pipe } from "effect"
import type {
  CommandSafety,
  ExternalCommandDecl,
  ExternalDecl,
  ParameterDescriptor,
  SuggestSource
} from "./types.js"

// importing a binary's observed command surface into the declaration
// model. the surface is what a binary accepts; a declaration is what
// this program promises about it. curation is the boundary between
// them, because no observed surface carries consequence or contracts.

/** one value slot: a positional, or an option's argument */
export interface ImportedArgument {
  readonly name: string
  readonly optional?: boolean
  readonly variadic?: boolean
  readonly suggest?: SuggestSource
}

/** one option and every token that names it (`["--message", "-m"]`) */
export interface ImportedOption {
  readonly names: ReadonlyArray<string>
  readonly description?: string
  readonly argument?: ImportedArgument
}

export interface ImportedCommand {
  readonly name: string
  readonly description?: string
  readonly argument?: ImportedArgument
  readonly options?: ReadonlyArray<ImportedOption>
}

/** what an observed surface cannot state, supplied per command.
 * `safety` is required: a surface describes how to type a command,
 * never what it does, and an agent client reads a command with no hints
 * as destructive. */
export interface CommandCuration {
  readonly safety: CommandSafety
  /** exactly the option tokens to keep — a real binary carries
   * 100-plus per command */
  readonly flags: ReadonlyArray<string>
}

/** a binary's surface plus the curation that turns it into a
 * declaration. a command absent from `curation` is not imported. */
export interface ExternalImport {
  readonly bin: string
  readonly description?: string
  readonly commands: ReadonlyArray<ImportedCommand>
  readonly curation: Readonly<globalThis.Record<string, CommandCuration>>
}

const describedBy = (description: string | undefined) =>
  Option.match(Option.fromNullishOr(description), {
    onNone: () => ({}),
    onSome: (described) => ({ description: described })
  })

const suggesting = (suggest: SuggestSource | undefined) =>
  Option.match(Option.fromNullishOr(suggest), {
    onNone: () => ({}),
    onSome: (source) => ({ suggest: source })
  })

const isLong = String.startsWith("--")

const isShort = (name: string): boolean => String.startsWith("-")(name) && !isLong(name)

const usageOf = (argument: ImportedArgument): string => {
  const token = argument.variadic === true ? `...${argument.name}` : argument.name
  return argument.optional === true ? `[${token}]` : `<${token}>`
}

const positionalParameter = (
  argument: ImportedArgument
): readonly [string, ParameterDescriptor] => [
  String.camelCase(argument.name),
  {
    type: "string",
    ...suggesting(argument.suggest),
    cli: { usage: usageOf(argument) }
  }
]

const flagParameter = (option: ImportedOption): readonly [string, ParameterDescriptor] => {
  const long = pipe(
    Array.findFirst(option.names, isLong),
    Option.orElse(() => Array.head(option.names)),
    Option.getOrElse(() => "")
  )
  return [
    String.camelCase(long),
    {
      type: option.argument === undefined ? "boolean" : "string",
      ...describedBy(option.description),
      ...(option.argument === undefined ? {} : suggesting(option.argument.suggest)),
      cli: Option.match(Array.findFirst(option.names, isShort), {
        onNone: () => long,
        onSome: (short) => `${long}, ${short}`
      })
    }
  ]
}

const commandOf = (command: ImportedCommand, curation: CommandCuration): ExternalCommandDecl => ({
  ...describedBy(command.description),
  safety: curation.safety,
  // the positional leads: argv order follows declaration order
  input: Record.fromEntries([
    ...Option.match(Option.fromNullishOr(command.argument), {
      onNone: () => [] as ReadonlyArray<readonly [string, ParameterDescriptor]>,
      onSome: (argument) => [positionalParameter(argument)]
    }),
    ...pipe(
      command.options ?? [],
      Array.filter((option) =>
        Array.some(option.names, (name) => Array.contains(curation.flags, name))),
      Array.map(flagParameter)
    )
  ]),
  output: "string"
})

/** turn a binary's observed command surface into an `external()`
 * declaration, keeping only the commands curation names */
export const importExternal = (source: ExternalImport): ExternalDecl => ({
  name: source.bin,
  ...describedBy(source.description),
  commands: Record.fromEntries(
    pipe(
      source.commands,
      Array.map((command) =>
        pipe(
          Record.get(source.curation, command.name),
          Option.map((curation) => [command.name, commandOf(command, curation)] as const)
        )),
      Array.getSomes
    )
  )
})
