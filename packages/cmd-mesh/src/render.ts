import { Array, Formatter, Option, Predicate, Record, String, pipe } from "effect"
import type { AnyType, CompiledCommand, CompiledParameter } from "./compile.js"
import { unitCandidates } from "./completion.js"

export const positionalDisplay = (p: CompiledParameter): string =>
  p.binding._tag === "positional" ? p.binding.display : ""

export const flagDisplay = (p: CompiledParameter): string =>
  p.binding._tag === "flag"
    ? pipe(Array.prepend(p.binding.aliases, p.binding.name), Array.join(", "))
    : ""

const defaultDisplay = (p: CompiledParameter): string =>
  Option.match(p.defaultValue, {
    onNone: () => "",
    onSome: (value) => ` (default: ${JSON.stringify(value)})`
  })

/** the hint is derived from the parameter's own name, the citty/clap way */
const valueHint = (p: CompiledParameter): string =>
  p.isBoolean ? "" : ` <${String.kebabCase(p.key)}>`

/** enumerated literals render as a possible-values suffix, the clap way —
 * except booleans, whose "values" are flag presence and --no-x */
const possibleValues = (p: CompiledParameter): string => {
  if (p.isBoolean) return ""
  const units = unitCandidates(p.inner.out as AnyType)
  return units.length > 0 ? ` [possible values: ${Array.join(units, ", ")}]` : ""
}

const requiredDisplay = (p: CompiledParameter): string => p.required ? " (required)" : ""

const optionLines = (p: CompiledParameter): ReadonlyArray<string> => {
  const description = Option.getOrElse(p.description, () => "")
  const base = `  ${String.padEnd(28)(`${flagDisplay(p)}${valueHint(p)}`)}${description}${requiredDisplay(p)}${
    defaultDisplay(p)
  }${possibleValues(p)}`
  // a boolean that defaults to true is turned OFF, not on — surface the
  // negation the parser already accepts
  const negation = p.isBoolean
    && Option.contains(p.defaultValue, true)
    && p.binding._tag === "flag"
    && String.startsWith("--")(p.binding.name)
    ? [`  ${String.padEnd(28)(String.replace("--", "--no-")(p.binding.name))}disable ${String.kebabCase(p.key)}`]
    : []
  return Array.prepend(negation, base)
}

const argumentLine = (p: CompiledParameter): string => {
  const description = Option.getOrElse(p.description, () => "")
  return `  ${String.padEnd(28)(positionalDisplay(p))}${description}${defaultDisplay(p)}${possibleValues(p)}`
}

const commandLine = (defaultName: Option.Option<string>) =>
([name, child]: readonly [string, CompiledCommand]): string => {
  const names = Array.join(Array.prepend(child.cliAliases, name), ", ")
  // bare-invocation behavior belongs on the help screen, not just in spec
  const marked = Option.contains(defaultName, name) ? `${names} (default)` : names
  return `  ${String.padEnd(28)(marked)}${child.description}`
}

const section = (title: string, lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines.length === 0 ? [] : Array.prependAll(lines, ["", `${title}:`])

// the mcp rows belong to `main()`, the composed bin. a program whose bin
// is `cli.run()` has no mcp surface, so listing them there would lie.
const builtinLines = (cmd: CompiledCommand, mcp: boolean): ReadonlyArray<string> =>
  Array.flatMap(
    [
      ["complete <shell>", "print a zsh, bash, fish, or powershell completion script"],
      ...(mcp
        ? ([
          ["mcp", "serve this program to agents over stdio"],
          ["mcp install", "register this program with an editor"]
        ] as const)
        : [])
    ] as const,
    ([name, description]) =>
      Option.isNone(Record.get(cmd.children, pipe(name, String.split(" "), Array.headNonEmpty)))
        ? [`  ${String.padEnd(28)(name)}${description}`]
        : []
  )

/** the one-line invocation shape, shared by help and usage errors */
export const usageLine = (cmd: CompiledCommand): string => {
  const positionals = pipe(
    cmd.parameters,
    Array.filter((p) => p.binding._tag === "positional"),
    Array.map(positionalDisplay)
  )
  const flags = Array.filter(cmd.parameters, (p) => p.binding._tag === "flag" && !p.cliHidden)
  const visibleChildren = pipe(
    Record.toEntries(cmd.children),
    Array.filter(([, child]) => !child.cliHidden)
  )
  return pipe(
    [
      Array.join(cmd.path, " "),
      ...(visibleChildren.length === 0 ? [] : ["<command>"]),
      ...positionals,
      ...(flags.length === 0 ? [] : ["[options]"])
    ],
    Array.join(" ")
  )
}

/** render help for one command from the compiled model. `builtins` adds
 * the reserved subcommands — pass it for the program root only, and
 * `mcp` with it when the bin is `main()` rather than `cli.run()` */
export const renderHelp = (
  cmd: CompiledCommand,
  options?: { readonly builtins?: boolean; readonly mcp?: boolean }
): string => {
  const flags = Array.filter(cmd.parameters, (p) => p.binding._tag === "flag" && !p.cliHidden)
  const visibleChildren = pipe(
    Record.toEntries(cmd.children),
    Array.filter(([, child]) => !child.cliHidden)
  )
  const usage = usageLine(cmd)
  return pipe(
    [
      ...(String.isEmpty(cmd.description) ? [] : [cmd.description, ""]),
      `Usage: ${usage}`,
      ...section("Commands", Array.map(visibleChildren, commandLine(cmd.cliDefault))),
      ...section(
        "Arguments",
        pipe(
          cmd.parameters,
          Array.filter((p) => p.binding._tag === "positional"),
          Array.map(argumentLine)
        )
      ),
      ...section("Options", Array.flatMap(flags, optionLines)),
      ...section("Examples", Array.map(cmd.cliExamples, (example) => `  ${example}`)),
      ...(options?.builtins === true
        ? section("Built-in", builtinLines(cmd, options.mcp === true))
        : [])
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
 * flat records as aligned rows (the grep convention), everything else
 * through Formatter.format — which handles BigInt, Dates, Maps, and
 * circular references instead of throwing. agents never see this — mcp
 * responses and `--json` carry strict json. */
export const renderResult = (value: unknown): string =>
  value === undefined ? ""
    : String.isString(value) ? value
    : globalThis.Array.isArray(value) && value.length > 0 && Array.every(value, isFlatRecord)
    ? columnRows(value as ReadonlyArray<globalThis.Record<string, unknown>>)
    : Formatter.format(value)
