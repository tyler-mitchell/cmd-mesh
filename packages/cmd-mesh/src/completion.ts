import { RootCommand } from "@bomb.sh/tab"
import type { Command as TabCommand } from "@bomb.sh/tab"
import { readdirSync } from "node:fs"
import { Array, Effect, Option, Record, String, pipe } from "effect"
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
 * time — the sync filesystem read is the tab-handler seam */
const sourceCandidates = (source: string): ReadonlyArray<string> =>
  Effect.runSync(
    Effect.try(() => {
      const entries = readdirSync(".", { withFileTypes: true })
      if (source === "folders" || source === "directories") {
        return Array.flatMap(entries, (e) => e.isDirectory() ? [`${e.name}/`] : [])
      }
      if (source === "files" || source === "filepaths") {
        return Array.map(entries, (e) => e.isDirectory() ? `${e.name}/` : e.name)
      }
      return [] as ReadonlyArray<string>
    }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
  )

/** what can follow a parameter: named-source listings, static
 * suggestions, then any literal values its output type enumerates */
export const parameterCandidates = (p: CompiledParameter): ReadonlyArray<string> =>
  pipe(
    Option.match(p.source, { onNone: () => [] as ReadonlyArray<string>, onSome: sourceCandidates }),
    Array.appendAll(Option.getOrElse(p.staticSuggestions, () => [] as ReadonlyArray<string>)),
    Array.appendAll(unitCandidates(p.inner.out as AnyType))
  )

// ─── the tab projection ─────────────────────────────────────────────────────

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

const handlerFor = (p: CompiledParameter, extra: Extra) =>
(complete: (value: string, description: string) => void): void =>
  Array.forEach(
    Array.appendAll(extra(p), parameterCandidates(p)),
    (v) => complete(v, "")
  )

const registerParameters = (target: TabCommand, cmd: CompiledCommand, extra: Extra): void =>
  Array.forEach(cmd.parameters, (p) => {
    const description = Option.getOrElse(p.description, () => "")
    if (p.binding._tag === "positional") {
      target.argument(p.key, handlerFor(p, extra), p.binding.variadic)
      return
    }
    const alias = optionAlias(p)
    if (p.isBoolean) {
      // the handler-less signatures mark the option boolean for tab
      if (alias === undefined) target.option(optionKey(p), description)
      else target.option(optionKey(p), description, alias)
      return
    }
    target.option(optionKey(p), description, handlerFor(p, extra), alias)
  })

/** project the compiled tree into a fresh tab registry */
const buildTab = (compiled: CompiledCommand, extra: Extra): RootCommand => {
  const root = new RootCommand()
  registerParameters(root, compiled, extra)
  const walk = (cmd: CompiledCommand): void =>
    pipe(
      Record.toEntries(cmd.children),
      Array.forEach(([, child]) => {
        if (!child.cliHidden) {
          registerParameters(
            root.command(Array.join(Array.drop(child.path, 1), " "), child.description),
            child,
            extra
          )
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
  words: ReadonlyArray<string>
): Option.Option<SuggestGenerator> => {
  const fired: globalThis.Array<CompiledParameter> = []
  captureParse(
    buildTab(compiled, (p) => {
      fired.push(p)
      return []
    }),
    words
  )
  return Array.head(fired).pipe(Option.flatMap((p) => p.generator))
}

/** the protocol lines for a word list: tab's `value\tdescription` rows
 * plus its trailing `:directive`. `dynamic` carries generator output,
 * already resolved — it lands on whichever parameter tab activates */
export const completionLines = (
  compiled: CompiledCommand,
  words: ReadonlyArray<string>,
  dynamic: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const lines = captureParse(buildTab(compiled, () => dynamic), words)
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
 * powershell and rejects anything else */
export const completionScript = (compiled: CompiledCommand, shell: string): void =>
  buildTab(compiled, () => []).setup(compiled.name, compiled.name, shell)
