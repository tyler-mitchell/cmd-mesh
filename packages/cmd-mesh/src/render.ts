import { Array, Option, Predicate, Record, String, pipe } from "effect"
import type { AnyType, CompiledCommand, CompiledParameter } from "./compile.js"
import { unitCandidates } from "./completion.js"

const positionalDisplay = (p: CompiledParameter): string =>
  p.binding._tag === "positional" ? p.binding.display : ""

const flagDisplay = (p: CompiledParameter): string =>
  p.binding._tag === "flag"
    ? pipe(Array.prepend(p.binding.aliases, p.binding.name), Array.join(", "))
    : ""

const defaultDisplay = (p: CompiledParameter): string =>
  Option.match(p.defaultValue, {
    onNone: () => "",
    onSome: (value) => ` (default: ${JSON.stringify(value)})`
  })

const valueHint = (p: CompiledParameter): string => p.isBoolean ? "" : " <value>"

/** enumerated literals render as a possible-values suffix, the clap way —
 * except booleans, whose "values" are flag presence and --no-x */
const possibleValues = (p: CompiledParameter): string => {
  if (p.isBoolean) return ""
  const units = unitCandidates(p.inner.out as AnyType)
  return units.length > 0 ? ` [possible values: ${Array.join(units, ", ")}]` : ""
}

const requiredDisplay = (p: CompiledParameter): string => p.required ? " (required)" : ""

const optionLine = (p: CompiledParameter): string => {
  const description = Option.getOrElse(p.description, () => "")
  return `  ${String.padEnd(28)(`${flagDisplay(p)}${valueHint(p)}`)}${description}${requiredDisplay(p)}${
    defaultDisplay(p)
  }${possibleValues(p)}`
}

const argumentLine = (p: CompiledParameter): string => {
  const description = Option.getOrElse(p.description, () => "")
  return `  ${String.padEnd(28)(positionalDisplay(p))}${description}${defaultDisplay(p)}${possibleValues(p)}`
}

const commandLine = ([name, child]: readonly [string, CompiledCommand]): string =>
  `  ${String.padEnd(28)(name)}${child.description}`

const section = (title: string, lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines.length === 0 ? [] : Array.prependAll(lines, ["", `${title}:`])

const builtinLines = (cmd: CompiledCommand): ReadonlyArray<string> =>
  Array.flatMap(
    [
      ["mcp", "serve this program's tools over stdio (mcp)"],
      ["complete <shell>", "print a zsh, bash, fish, or powershell completion script"]
    ] as const,
    ([name, description]) =>
      Option.isNone(Record.get(cmd.children, pipe(name, String.split(" "), Array.headNonEmpty)))
        ? [`  ${String.padEnd(28)(name)}${description}`]
        : []
  )

/** render help for one command from the compiled model. `builtins` adds
 * the reserved subcommands — pass it for the program root only */
export const renderHelp = (cmd: CompiledCommand, options?: { readonly builtins?: boolean }): string => {
  const positionals = pipe(
    cmd.parameters,
    Array.filter((p) => p.binding._tag === "positional"),
    Array.map(positionalDisplay)
  )
  const flags = Array.filter(cmd.parameters, (p) => p.binding._tag === "flag")
  const visibleChildren = pipe(
    Record.toEntries(cmd.children),
    Array.filter(([, child]) => !child.cliHidden)
  )
  const usage = pipe(
    [
      Array.join(cmd.path, " "),
      ...(visibleChildren.length === 0 ? [] : ["<command>"]),
      ...positionals,
      ...(flags.length === 0 ? [] : ["[options]"])
    ],
    Array.join(" ")
  )
  return pipe(
    [
      ...(String.isEmpty(cmd.description) ? [] : [cmd.description, ""]),
      `Usage: ${usage}`,
      ...section("Commands", Array.map(visibleChildren, commandLine)),
      ...section(
        "Arguments",
        pipe(
          cmd.parameters,
          Array.filter((p) => p.binding._tag === "positional"),
          Array.map(argumentLine)
        )
      ),
      ...section("Options", Array.map(flags, optionLine)),
      ...(options?.builtins === true ? section("Built-in", builtinLines(cmd)) : [])
    ],
    Array.join("\n")
  )
}

const isFlatRecord = (value: unknown): value is globalThis.Record<string, unknown> =>
  Predicate.isObject(value)
  && !globalThis.Array.isArray(value)
  && !Predicate.isFunction(value)
  && pipe(
    Record.toEntries(value as globalThis.Record<string, unknown>),
    Array.every(([, v]) => !Predicate.isObject(v))
  )

const columnRows = (rows: ReadonlyArray<globalThis.Record<string, unknown>>): string => {
  const keys = pipe(
    Array.head(rows),
    Option.map(Record.keys),
    Option.getOrElse(() => [] as ReadonlyArray<string>)
  )
  const widths = Array.map(keys, (key) =>
    pipe(
      rows,
      Array.map((row) => `${row[key] ?? ""}`.length),
      Array.reduce(0, (max, len) => len > max ? len : max)
    ))
  return pipe(
    rows,
    Array.map((row) =>
      pipe(
        keys,
        Array.map((key, i) => String.padEnd(widths[i] ?? 0)(`${row[key] ?? ""}`)),
        Array.join("  "),
        String.trimEnd
      )),
    Array.join("\n")
  )
}

/** render a command result for a human terminal: strings raw, arrays of
 * flat records as aligned rows (the grep convention), everything else as
 * pretty json. agents never see this — mcp responses carry json. */
export const renderResult = (value: unknown): string =>
  value === undefined ? ""
    : String.isString(value) ? value
    : globalThis.Array.isArray(value) && value.length > 0 && Array.every(value, isFlatRecord)
    ? columnRows(value as ReadonlyArray<globalThis.Record<string, unknown>>)
    : JSON.stringify(value, null, 2)
