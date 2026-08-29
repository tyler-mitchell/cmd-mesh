import { RootCommand } from "@bomb.sh/tab"
import type { Command as TabCommand } from "@bomb.sh/tab"
import { readdirSync } from "node:fs"
import { Array, Effect, Option, Record, String, pipe } from "effect"
import { childFor } from "./argv.js"
import type { AnyType, CompiledCommand, CompiledParameter } from "./compile.js"
import type { SuggestGenerator } from "./types.js"

// the completion engine: the compiled model projected into tab
// (@bomb.sh/tab), the Cobra-protocol completion engine the js ecosystem
// standardized on. tab owns word matching, shell scripts (zsh, bash,
// fish, powershell), the `complete <shell>` / `complete -- <words>`
// protocol, and package-manager delegation (`pnpm exec bin <TAB>`). we
// own candidates: static suggestions, enumerated literals, named
// filesystem sources, and Fig-style async generators. tab handlers are
// synchronous, so a generator resolves between two parses — a probe
// parse asks tab which parameter is active, the real parse emits.

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

/** named sources resolve against the working directory at completion
 * time — the sync filesystem read is the tab-handler seam. the current
 * word's directory part steers the listing (`src/co<TAB>` lists src/),
 * and entries carry that prefix so the shell's own filter matches.
 * exported: the interactive projection offers the same listing. */
export const sourceCandidates = (source: string, current: string): ReadonlyArray<string> =>
  Effect.runSync(
    Effect.try(() => {
      const dir = current.slice(0, current.lastIndexOf("/") + 1)
      const entries = readdirSync(dir === "" ? "." : dir, { withFileTypes: true })
      if (source === "folders" || source === "directories") {
        return Array.flatMap(entries, (e) => e.isDirectory() ? [`${dir}${e.name}/`] : [])
      }
      if (source === "files" || source === "filepaths") {
        return Array.map(entries, (e) => e.isDirectory() ? `${dir}${e.name}/` : `${dir}${e.name}`)
      }
      return [] as ReadonlyArray<string>
    }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
  )

/** what can follow a parameter: named-source listings, static
 * suggestions, then any literal values its output type enumerates */
const parameterCandidates = (p: CompiledParameter, current: string): ReadonlyArray<string> =>
  pipe(
    Option.match(p.source, {
      onNone: () => [] as ReadonlyArray<string>,
      onSome: (source) => sourceCandidates(source, current)
    }),
    Array.appendAll(Option.getOrElse(p.staticSuggestions, () => [] as ReadonlyArray<string>)),
    Array.appendAll(unitCandidates(p.inner.out as AnyType))
  )

// ─── the tab projection ─────────────────────────────────────────────────────

/** rewrite alias tokens to the real subcommand names tab knows —
 * completion must agree with the parser (`pm ws l<TAB>` completes).
 * only tokens that resolve as a child of the current node descend; a
 * flag value that happens to spell an alias below a non-command
 * position is out of walk order and never matches. */
export const canonicalWords = (
  compiled: CompiledCommand,
  words: ReadonlyArray<string>
): ReadonlyArray<string> =>
  Array.mapAccum(words, compiled, (cmd, word) =>
    pipe(
      childFor(cmd, word),
      Option.match({
        onNone: () => [cmd, word] as const,
        onSome: (child) => [child, Option.getOrElse(Array.last(child.path), () => word)] as const
      })
    )
  )[1]

/** tab stores option names dash-less and renders `--name` / `-a` itself */
const optionKey = (p: CompiledParameter): string =>
  p.binding._tag === "flag" ? String.replace(/^-+/, "")(p.binding.name) : p.key

const optionAlias = (p: CompiledParameter): string | undefined =>
  p.binding._tag === "flag"
    ? pipe(
      p.binding.aliases,
      Array.findFirst((a) => String.startsWith("-")(a) && !String.startsWith("--")(a)),
      Option.map(String.replace(/^-/, "")),
      Option.getOrUndefined
    )
    : undefined

/** extra candidates for one parameter, asked for only when tab decides
 * that parameter is the active one — which is what makes the probe work */
type Extra = (p: CompiledParameter) => ReadonlyArray<string>

const handlerFor = (p: CompiledParameter, extra: Extra, current: string) =>
(complete: (value: string, description: string) => void): void =>
  Array.forEach(
    Array.appendAll(extra(p), parameterCandidates(p, current)),
    (v) => complete(v, "")
  )

const registerParameters = (
  target: TabCommand,
  cmd: CompiledCommand,
  extra: Extra,
  current: string
): void =>
  Array.forEach(cmd.parameters, (p) => {
    if (p.cliHidden) return
    const description = Option.getOrElse(p.description, () => "")
    if (p.binding._tag === "positional") {
      target.argument(p.key, handlerFor(p, extra, current), p.binding.variadic)
      return
    }
    const alias = optionAlias(p)
    if (p.isBoolean) {
      // the handler-less signatures mark the option boolean for tab
      if (alias === undefined) target.option(optionKey(p), description)
      else target.option(optionKey(p), description, alias)
      return
    }
    target.option(optionKey(p), description, handlerFor(p, extra, current), alias)
  })

/** project the compiled tree into a fresh tab registry. a group with a
 * default child also carries that child's parameters — completion must
 * agree with the parser, which sends group-level flags to the default */
const withDefaultChild = (
  target: TabCommand,
  cmd: CompiledCommand,
  extra: Extra,
  current: string
): void =>
  pipe(
    Option.flatMap(cmd.cliDefault, (name) => Record.get(cmd.children, name)),
    Option.match({
      onNone: () => undefined,
      onSome: (child) => registerParameters(target, child, extra, current)
    })
  )

const buildTab = (compiled: CompiledCommand, extra: Extra, current: string): RootCommand => {
  const root = new RootCommand()
  registerParameters(root, compiled, extra, current)
  withDefaultChild(root, compiled, extra, current)
  const walk = (cmd: CompiledCommand): void =>
    pipe(
      Record.toEntries(cmd.children),
      Array.forEach(([, child]) => {
        if (!child.cliHidden) {
          const node = root.command(Array.join(Array.drop(child.path, 1), " "), child.description)
          registerParameters(node, child, extra, current)
          withDefaultChild(node, child, extra, current)
        }
        walk(child)
      })
    )
  walk(compiled)
  return root
}

/** run one tab parse, capturing the protocol lines it prints */
const captureParse = (root: RootCommand, words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const lines: globalThis.Array<string> = []
  const log = globalThis.console.log
  globalThis.console.log = (...args: ReadonlyArray<unknown>) => {
    lines.push(Array.join(Array.map(args, (a) => `${a}`), " "))
  }
  Effect.runSync(
    Effect.try(() => root.parse([...words])).pipe(
      Effect.ensuring(Effect.sync(() => {
        globalThis.console.log = log
      })),
      Effect.orElseSucceed(() => undefined)
    )
  )
  return lines
}

/** the generator to run for the word under the cursor. tab calls exactly
 * the active parameter's handler, so a discarded probe parse is the
 * lookup — no second routing implementation */
export const generatorFor = (
  compiled: CompiledCommand,
  rawWords: ReadonlyArray<string>
): Option.Option<SuggestGenerator> => {
  const words = canonicalWords(compiled, rawWords)
  const fired: globalThis.Array<CompiledParameter> = []
  captureParse(
    buildTab(compiled, (p) => {
      fired.push(p)
      return []
    }, Option.getOrElse(Array.last(words), () => "")),
    words
  )
  return Array.head(fired).pipe(Option.flatMap((p) => p.generator))
}

/** the protocol lines for a word list: tab's `value\tdescription` rows
 * plus its trailing `:directive`. `dynamic` carries generator output,
 * already resolved — it lands on whichever parameter tab activates */
export const completionLines = (
  compiled: CompiledCommand,
  rawWords: ReadonlyArray<string>,
  dynamic: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const words = canonicalWords(compiled, rawWords)
  const lines = captureParse(
    buildTab(compiled, () => dynamic, Option.getOrElse(Array.last(words), () => "")),
    words
  )
  // past the end-of-options separator every word is a value — the parser
  // will never read a flag there, so flags are not candidates
  return Array.contains(Array.dropRight(words, 1), "--")
    ? Array.filter(lines, (line) => !String.startsWith("-")(line))
    : lines
}

/** candidate values only — protocol rows stripped of descriptions and
 * the directive line. the module surface's `complete()` */
export const candidateValues = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  pipe(
    lines,
    Array.filter((line) => !String.startsWith(":")(line) && String.isNonEmpty(line)),
    Array.map((line) =>
      pipe(
        String.indexOf("\t")(line),
        Option.match({ onNone: () => line, onSome: (i) => String.substring(0, i)(line) })
      ))
  )

/** print a shell completion script; tab supports zsh, bash, fish, and
 * powershell and rejects anything else. the script targets the name the
 * user actually invokes — the installed bin — which may differ from the
 * program's declared name. */
export const completionScript = (
  compiled: CompiledCommand,
  shell: string,
  binName?: string
): void => {
  const name = binName ?? compiled.name
  return buildTab(compiled, () => [], "").setup(name, name, shell)
}
