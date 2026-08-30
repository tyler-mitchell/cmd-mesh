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
  const seen = new Set<string>()
  return lines.flatMap((line, index) => {
    const match = head.exec(line)
    if (match?.groups === undefined) return []
    const g = match.groups
    const long = g["long"]!
    // pnpm documents --filter once per selector form, and a wrapped
    // example line can end mid-word: neither is a second flag
    if (seen.has(long) || long.endsWith("-")) return []
    seen.add(long)
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
      long,
      ...(g["short"] === undefined ? {} : { short: g["short"] }),
      negatable: g["negatable"] !== undefined,
      ...(value === undefined ? {} : { value }),
      optionalValue: g["value"]?.startsWith("[") === true,
      description: [g["description"]!.trim(), ...wrapped].filter((p) => p !== "").join(" ")
    }]
  })
}

export interface HelpPositional {
  readonly name: string
  readonly optional: boolean
  readonly variadic: boolean
}

/** the operands in a usage line:
 *
 *     usage: git status [<options>] [--] [<pathspec>...]
 *     usage: git show [<options>] <object>...
 *
 * `[<options>]` and `[--]` are notation, not operands, so they are
 * skipped. A name is taken only from the FIRST usage line: git prints
 * an alternate line for `git show`, whose operands are not status's. */
const operand = /(?<open>\[?)<(?<name>[a-z][\w-]*)>(?<inner>\.\.\.)?\]?(?<outer>\.\.\.)?/g

export const parseHelpPositionals = (help: string): ReadonlyArray<HelpPositional> => {
  const usage = help.split("\n").find((line) => line.startsWith("usage:"))
  if (usage === undefined) return []
  const seen = new Set<string>()
  return [...usage.matchAll(operand)].flatMap((match) => {
    const g = match.groups!
    const name = g["name"]!
    if (name === "options" || seen.has(name)) return []
    seen.add(name)
    return [{
      name,
      optional: g["open"] === "[",
      variadic: g["inner"] !== undefined || g["outer"] !== undefined
    }]
  })
}

/** the subcommands a group documents in its own usage block:
 *
 *     usage: git remote [-v | --verbose]
 *        or: git remote add [-t <branch>] ... <name> <url>
 *        or: git remote [-v | --verbose] show [-n] <name>
 *
 * A group names its children only here — there is no command table like
 * the one at the top level. The child is the first bare word after the
 * path, which is NOT always the next token: `show` follows a flag
 * group. A line with no bare word is the group's own usage. */
export const parseHelpSubcommands = (
  help: string,
  path: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const prefix = path.join(" ")
  const seen = new Set<string>()
  return help.split("\n").flatMap((line) => {
    const usage = /^\s*(?:usage:|or:)\s+(?<rest>.*)$/.exec(line)?.groups?.["rest"]
    if (usage === undefined || !usage.startsWith(prefix)) return []
    const child = usage
      .slice(prefix.length)
      .trim()
      .split(/\s+/)
      .find((token) => /^[a-z][\w-]*$/.test(token))
    if (child === undefined || seen.has(child)) return []
    seen.add(child)
    return [child]
  })
}

/** a positional as declaration source. Always optional: a usage line
 * marks what the binary accepts, and a drafted surface that forces an
 * argument is one a caller cannot use. */
export const declarePositional = (positional: HelpPositional): string => {
  const key = flagKey(positional.name)
  const notation = positional.variadic ? `[...${key}]` : `[${key}]`
  const type = positional.variadic ? `"string[]"` : `"string"`
  const meta = positional.variadic
    ? `cli: ${JSON.stringify(notation)}, default: () => []`
    : `cli: ${JSON.stringify(notation)}`
  const optional = positional.variadic ? "" : "?"
  return `  ${JSON.stringify(`${key}${optional}`)}: [${type}, "@", { ${meta} }]`
}

/** a subcommand line in a binary's top-level help:
 *
 *     clone      Clone a repository into a new directory     (git)
 *  i, install    Install all dependencies for a project      (pnpm)
 *
 * The alias column is optional and reads like the one on an option
 * line. A name never starts with `-`, which is what separates these
 * from the options the same help also prints. */
const commandLine =
  /^\s{2,}(?:(?<alias>[a-z][\w-]*),\s+)?(?<name>[a-z][\w-]*)\s{2,}(?<description>\S.*)$/

export interface HelpCommand {
  readonly name: string
  readonly description: string
  /** the short spelling the binary also accepts, when it prints one */
  readonly alias?: string
}

export const parseHelpCommands = (help: string): ReadonlyArray<HelpCommand> => {
  const seen = new Set<string>()
  return help.split("\n").flatMap((line) => {
    const match = commandLine.exec(line)
    if (match?.groups === undefined) return []
    const name = match.groups["name"]!
    const alias = match.groups["alias"]
    // git lists some commands under more than one heading
    if (seen.has(name)) return []
    seen.add(name)
    return [{
      name,
      description: match.groups["description"]!.trim(),
      ...(alias === undefined ? {} : { alias })
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
  readonly positionals?: ReadonlyArray<HelpPositional>
  readonly commands?: ReadonlyArray<DraftCommand>
  /** the short spelling the binary accepts, when its help prints one */
  readonly alias?: string
}

/** a whole `external({...})` declaration, as source a person then edits.
 * `safety` is deliberately absent: help text does not say whether a
 * command mutates, and guessing it would put a wrong hint in front of
 * an agent. The emitted comment says so at the one place it matters. */
export const declareExternal = (
  bin: string,
  commands: ReadonlyArray<DraftCommand>
): string => {
  const declareCommand = (command: DraftCommand, pad: string): string => {
    // positionals first: a reader looks for them before the flags, and
    // cmd-mesh takes their order from the declaration
    const parameters = [
      ...(command.positionals ?? []).map((p) => `${pad}  ${declarePositional(p)}`),
      ...command.flags.map((f) => `${pad}  ${declareFlag(f)}`)
    ]
    const input = parameters.length === 0
      ? ""
      : `${pad}  input: {\n${parameters.join(",\n")}\n${pad}  },\n`
    const children = command.commands ?? []
    const nested = children.length === 0
      ? ""
      : `${pad}  commands: {\n${
        children.map((child) => declareCommand(child, `${pad}    `)).join(",\n")
      }\n${pad}  },\n`
    // a group that only routes has no output of its own
    const output = children.length === 0 ? `${pad}  output: "string"\n` : ""
    // the binary already answers to the short spelling, so the drafted
    // surface should too
    const alias = command.alias === undefined
      ? ""
      : `${pad}  cli: { alias: [${JSON.stringify(command.alias)}] },\n`
    return `${pad}${JSON.stringify(command.name)}: {\n`
      + `${pad}  description: ${JSON.stringify(command.description)},\n`
      + `${pad}  // TODO set safety: "read" | "action" | "destructive"\n`
      + alias
      + input
      + nested
      + output
      + `${pad}}`
  }
  const body = commands.map((command) => declareCommand(command, "    ")).join(",\n")
  return `// Drafted from \`${bin} -h\`. Curate before use: set each\n`
    + `// command's safety, narrow the string types the binary really\n`
    + `// accepts, and delete what you do not want to expose.\n`
    + `//\n`
    + `// A binary's short help is not always its whole surface: \`git log\`\n`
    + `// documents neither --oneline nor --max-count there, though both\n`
    + `// work. Add what you need; nothing here is a complete mirror.\n`
    + `//\n`
    + `// A flag is drafted as a boolean unless its help marks a value —\n`
    + `// \`<mode>\` or \`[=<mode>]\`. pnpm's \`--depth -1\` shows the value in\n`
    + `// prose only, so it arrives here as a boolean and needs changing.\n`
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
