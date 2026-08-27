import { Array, Effect, Option, Record, String, pipe } from "effect"
import type { AnyType, CompiledCommand, CompiledParameter } from "./compile.js"
import type { SuggestGenerator } from "./types.js"

// the completion engine: candidates computed from the same compiled model
// that drives parsing. shell integration follows the callback convention —
// the installed bin answers `<bin> __complete <words...>` with one
// candidate per line; lines starting with ":" are directives the shell
// script maps to native completers (":files", ":dirs").

export const unitCandidates = (t: AnyType): ReadonlyArray<string> =>
  Effect.runSync(
    Effect.try(() =>
      pipe(
        t.select("unit") as ReadonlyArray<{ readonly unit: unknown }>,
        // a defaulted parameter's output type carries an `undefined`
        // branch from the default wrapper — never a typable candidate
        Array.flatMap((node): ReadonlyArray<string> =>
          node.unit === undefined || node.unit === null ? [] : [`${node.unit}`])
      )
    ).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
  )

const sourceDirective = (source: string): ReadonlyArray<string> =>
  source === "filepaths" || source === "files" ? [":files"]
    : source === "folders" || source === "directories" ? [":dirs"]
    : []

/** what can follow a parameter's flag: named-source directives, static
 * suggestions, then any literal values its output type enumerates */
export const parameterCandidates = (p: CompiledParameter): ReadonlyArray<string> =>
  pipe(
    Option.match(p.source, { onNone: () => [] as ReadonlyArray<string>, onSome: sourceDirective }),
    Array.appendAll(Option.getOrElse(p.staticSuggestions, () => [] as ReadonlyArray<string>)),
    Array.appendAll(unitCandidates(p.inner.out as AnyType))
  )

const flagCandidates = (cmd: CompiledCommand): ReadonlyArray<string> =>
  Array.flatMap(cmd.parameters, (p): ReadonlyArray<string> =>
    p.binding._tag === "flag"
      ? Array.appendAll(
        Array.prepend(p.binding.aliases, p.binding.name),
        p.isBoolean ? [String.replace("--", "--no-")(p.binding.name)] : []
      )
      : [])

const childCandidates = (cmd: CompiledCommand): ReadonlyArray<string> =>
  pipe(
    Record.toEntries(cmd.children),
    Array.flatMap(([name, child]: readonly [string, CompiledCommand]) => child.cliHidden ? [] : [name])
  )

const valueTakingFlag = (cmd: CompiledCommand, token: string): Option.Option<CompiledParameter> =>
  Array.findFirst(cmd.parameters, (p) =>
    p.binding._tag === "flag" && !p.isBoolean &&
    Array.contains(Array.prepend(p.binding.aliases, p.binding.name), token))

/** descend into subcommands while tokens name children, returning the
 * command plus the tokens it still has to interpret */
const routeWords = (
  root: CompiledCommand,
  words: ReadonlyArray<string>
): readonly [CompiledCommand, ReadonlyArray<string>] =>
  pipe(
    Array.head(words),
    Option.flatMap((head) => Record.get(root.children, head)),
    Option.match({
      onNone: () => [root, words] as const,
      onSome: (child) => routeWords(child, Array.drop(words, 1))
    })
  )

/** how many positional slots the remaining tokens already consumed —
 * bare tokens that are not values of a preceding value-taking flag */
const consumedPositionals = (cmd: CompiledCommand, tokens: ReadonlyArray<string>): number =>
  Array.reduce(tokens, { count: 0, awaitingValue: false }, (state, token) => {
    if (state.awaitingValue) return { count: state.count, awaitingValue: false }
    if (String.startsWith("-")(token)) {
      return { count: state.count, awaitingValue: Option.isSome(valueTakingFlag(cmd, token)) }
    }
    return { count: state.count + 1, awaitingValue: false }
  }).count

const pendingPositional = (
  cmd: CompiledCommand,
  preceding: ReadonlyArray<string>
): Option.Option<CompiledParameter> => {
  const positionals = Array.filter(cmd.parameters, (p) => p.binding._tag === "positional")
  return pipe(
    positionals,
    Array.get(consumedPositionals(cmd, preceding)),
    // a trailing variadic keeps accepting values
    Option.orElse(() =>
      Array.last(positionals).pipe(
        Option.filter((p) => p.binding._tag === "positional" && p.binding.variadic)
      ))
  )
}

/** the parameter the word under the cursor belongs to, if any */
const activeParameter = (
  root: CompiledCommand,
  words: ReadonlyArray<string>
): Option.Option<CompiledParameter> => {
  const current = Option.getOrElse(Array.last(words), () => "")
  const preceding = Array.dropRight(words, 1)
  const [target, remainder] = routeWords(root, preceding)
  return pipe(
    Array.last(preceding),
    Option.flatMap((token) => valueTakingFlag(target, token)),
    Option.orElse(() =>
      String.startsWith("-")(current) ? Option.none() : pendingPositional(target, remainder))
  )
}

/** the completion generator to run for the word under the cursor, if the
 * active parameter declares one */
export const generatorFor = (
  root: CompiledCommand,
  words: ReadonlyArray<string>
): Option.Option<SuggestGenerator> => Option.flatMap(activeParameter(root, words), (p) => p.generator)

/** completion candidates for a word list whose last element is the word
 * being completed (possibly empty) */
export const candidatesFor = (
  root: CompiledCommand,
  words: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const current = Option.getOrElse(Array.last(words), () => "")
  const preceding = Array.dropRight(words, 1)
  const [target, remainder] = routeWords(root, preceding)
  const previous = Array.last(preceding)
  const fromFlagValue = previous.pipe(
    Option.flatMap((token) => valueTakingFlag(target, token)),
    Option.map(parameterCandidates)
  )
  const general = () =>
    pipe(
      childCandidates(target),
      Array.appendAll(flagCandidates(target)),
      Array.appendAll(
        String.startsWith("-")(current)
          ? []
          : Option.match(pendingPositional(target, remainder), {
            onNone: () => [] as ReadonlyArray<string>,
            onSome: parameterCandidates
          })
      )
    )
  return pipe(
    Option.getOrElse(fromFlagValue, general),
    Array.filter((candidate) => String.startsWith(":")(candidate) || String.startsWith(current)(candidate))
  )
}

/** zsh completion script for an installed bin named `name` */
export const zshScript = (name: string): string =>
  `#compdef ${name}
# generated by @cmd-mesh/core — source or install into a completions dir
_${name}() {
  local -a lines values
  lines=("\${(@f)$(${name} __complete "\${words[@]:1:$((CURRENT-1))}" "\${words[CURRENT]}" 2>/dev/null)}")
  for line in "\${lines[@]}"; do
    case "$line" in
      :files) _files ;;
      :dirs) _files -/ ;;
      "") ;;
      *) values+=("$line") ;;
    esac
  done
  (( \${#values} )) && compadd -- "\${values[@]}"
}
compdef _${name} ${name}
`

/** bash completion script for an installed bin named `name` */
export const bashScript = (name: string): string =>
  `# generated by @cmd-mesh/core — source from your bashrc
_${name}_complete() {
  local IFS=$'\\n'
  local lines
  lines=$(${name} __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)
  COMPREPLY=()
  for line in $lines; do
    case "$line" in
      :files) COMPREPLY+=($(compgen -f -- "\${COMP_WORDS[COMP_CWORD]}")) ;;
      :dirs) COMPREPLY+=($(compgen -d -- "\${COMP_WORDS[COMP_CWORD]}")) ;;
      *) COMPREPLY+=("$line") ;;
    esac
  done
}
complete -F _${name}_complete ${name}
`
