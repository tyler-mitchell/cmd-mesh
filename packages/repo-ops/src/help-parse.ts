// Reading a binary's own `-h` output is how a generated external surface
// starts: the binary is present, its help describes the version actually
// installed, and no corpus has to be vendored. git and pnpm print the
// same shape, so one reader serves both:
//
//     -v, --[no-]verbose        be verbose
//         --[no-]porcelain[=<version>]
//                               machine-readable output
//
// The output is a DRAFT for a person to curate, so a line this cannot
// read is reported rather than guessed at.

export interface HelpFlag {
  readonly long: string
  readonly short?: string
  /** `--[no-]x`, so the negated spelling is part of the contract */
  readonly negatable: boolean
  /** the value's placeholder name, when the flag takes one */
  readonly value?: string
  /** `--x[=<v>]` — the flag is usable with and without its value */
  readonly optionalValue: boolean
  readonly description: string
}

/** ` -v, --[no-]verbose[=<mode>]  be verbose` — the leading spelling of
 * an option line, with everything after it treated as description */
const head =
  /^\s{2,}(?:-(?<short>[A-Za-z0-9]),\s+)?--(?<negatable>\[no-\])?(?<long>[A-Za-z0-9][\w-]*)(?<value>(?:\[?=<(?<named>[^>]+)>\]?)|(?:\s<(?<spaced>[^>]+)>))?\s*(?<description>.*)$/

const isContinuation = (line: string): boolean => /^\s{10,}\S/.test(line)

export const parseHelpFlags = (help: string): ReadonlyArray<HelpFlag> => {
  const lines = help.split("\n")
  return lines.flatMap((line, index) => {
    const match = head.exec(line)
    if (match?.groups === undefined) return []
    const g = match.groups
    // a description that did not fit continues on the following indented
    // lines, which is how both git and pnpm wrap
    const wrapped = lines
      .slice(index + 1)
      .reduce<{ readonly done: boolean; readonly parts: ReadonlyArray<string> }>(
        (acc, next) =>
          acc.done || !isContinuation(next) || head.test(next)
            ? { done: true, parts: acc.parts }
            : { done: false, parts: [...acc.parts, next.trim()] },
        { done: false, parts: [] }
      ).parts
    const value = g["named"] ?? g["spaced"]
    return [{
      long: g["long"]!,
      ...(g["short"] === undefined ? {} : { short: g["short"] }),
      negatable: g["negatable"] !== undefined,
      ...(value === undefined ? {} : { value }),
      optionalValue: g["value"]?.startsWith("[") === true,
      description: [g["description"]!.trim(), ...wrapped].filter((p) => p !== "").join(" ")
    }]
  })
}

/** `--max-count` → `maxCount`, the key a declaration would use */
export const flagKey = (long: string): string =>
  long.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

export interface DraftCommand {
  readonly name: string
  readonly description: string
  readonly flags: ReadonlyArray<HelpFlag>
}

/** a whole `external({...})` declaration, as source a person then edits.
 * `safety` is deliberately absent: help text does not say whether a
 * command mutates, and guessing it would put a wrong hint in front of
 * an agent. The emitted comment says so at the one place it matters. */
export const declareExternal = (
  bin: string,
  commands: ReadonlyArray<DraftCommand>
): string => {
  const body = commands.map((command) => {
    const input = command.flags.length === 0
      ? ""
      : `      input: {\n${
        command.flags.map((f) => `    ${declareFlag(f)}`).join(",\n")
      }\n      },\n`
    return `    ${JSON.stringify(command.name)}: {\n`
      + `      description: ${JSON.stringify(command.description)},\n`
      + `      // TODO set safety: "read" | "action" | "destructive"\n`
      + input
      + `      output: "string"\n`
      + `    }`
  }).join(",\n")
  return `// Drafted from \`${bin} -h\`. Curate before use: set each\n`
    + `// command's safety, narrow the string types the binary really\n`
    + `// accepts, and delete what you do not want to expose.\n`
    + `import { external } from "cmd-mesh"\n\n`
    + `export const ${flagKey(bin)} = external({\n`
    + `  name: ${JSON.stringify(bin)},\n`
    + `  commands: {\n${body}\n  }\n})\n`
}

/** one parameter of a cmd-mesh external declaration, as source text. A
 * valued flag is a string because argv carries strings; a person
 * curating the draft narrows it to what the binary really accepts. */
export const declareFlag = (flag: HelpFlag): string => {
  const key = flagKey(flag.long)
  const usage = flag.short === undefined
    ? `--${flag.long}`
    : `--${flag.long}, -${flag.short}`
  const meta = [
    ...(flag.description === "" ? [] : [`description: ${JSON.stringify(flag.description)}`]),
    `cli: ${JSON.stringify(usage)}`,
    ...(flag.value === undefined ? [`default: false`] : [])
  ].join(", ")
  const type = flag.value === undefined ? `"boolean"` : `"string"`
  // every drafted flag is optional: a boolean gets `default: false`, and
  // a valued one gets `?`. Help text never says a flag is mandatory, so
  // emitting a required parameter makes the command uncallable — which
  // is exactly what the first real run of this generator did.
  const optional = flag.value === undefined ? "" : "?"
  return `  ${JSON.stringify(`${key}${optional}`)}: [${type}, "@", { ${meta} }]`
}
