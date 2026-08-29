import { autocomplete, confirm, intro, isCancel, outro, select, text } from "@clack/prompts"
import { type } from "arktype"
import { Array, Data, Effect, Option, Record, String as StringModule, pipe } from "effect"
import { childFor } from "./argv.js"
import type { AnyType, CompiledCommand, CompiledParameter } from "./compile.js"
import { sourceCandidates, unitCandidates } from "./completion.js"
import type { SuggestContext } from "./types.js"

// the interactive projection's walk: guided prompts that ASSEMBLE argv.
// dispatch, parsing, rendering, and exit codes stay owned by the cli
// path the assembled tokens are handed to — prompting can never drift
// from parsing because each prompt validates with the parameter's own
// token morph. contract: ideations/interactive-spine.ts.

/** the user ended the walk (clack cancel symbol); the wiring maps this
 * to exit 130 — the shell's interrupted-invocation convention */
export class PromptCancelled extends Data.TaggedError("PromptCancelled")<{}> {}

const SKIP = Symbol.for("cmd-mesh/interactive-skip")

const prompt = <T>(run: () => Promise<T | symbol>): Effect.Effect<T, PromptCancelled> =>
  Effect.tryPromise({ try: run, catch: () => new PromptCancelled() }).pipe(
    Effect.flatMap((value) =>
      isCancel(value) ? Effect.fail(new PromptCancelled()) : Effect.succeed(value as T)
    )
  )

const visibleChildren = (cmd: CompiledCommand): ReadonlyArray<CompiledCommand> =>
  pipe(
    Record.toEntries(cmd.children),
    Array.flatMap(([, child]) => child.cliHidden ? [] : [child])
  )

const isRunnable = (cmd: CompiledCommand): boolean =>
  Option.isSome(cmd.run) || Option.isSome(cmd.external)

const lastWord = (cmd: CompiledCommand): string =>
  Option.getOrElse(Array.last(cmd.path), () => cmd.name)

/** deepest-match start: an unresolvable word stops resolution and the
 * walk simply begins there — the label shows the user where they are */
const resolveStart = (root: CompiledCommand, path: ReadonlyArray<string>): CompiledCommand =>
  Array.reduce(path, root, (at, word) => Option.getOrElse(childFor(at, word), () => at))

const initialChild = (cmd: CompiledCommand): CompiledCommand | undefined =>
  pipe(
    Option.flatMap(cmd.cliDefault, (name) => Record.get(cmd.children, name)),
    Option.getOrUndefined
  )

/** phase 1: descend by select until a command with no further choice —
 * a runnable node with children offers itself as the first option */
const chooseCommand = (
  command: CompiledCommand
): Effect.Effect<CompiledCommand, PromptCancelled> =>
  Effect.suspend(() => {
    const children = visibleChildren(command)
    if (!Array.isReadonlyArrayNonEmpty(children)) return Effect.succeed(command)
    const initial = initialChild(command)
    return prompt(() =>
      select<CompiledCommand>({
        message: Array.join(command.path, " "),
        options: [
          ...(isRunnable(command)
            ? [{ value: command, label: `run ${lastWord(command)}`, hint: command.description }]
            : []),
          ...Array.map(children, (child) => ({
            value: child,
            label: lastWord(child),
            hint: child.description
          }))
        ],
        ...(initial === undefined ? {} : { initialValue: initial })
      })
    ).pipe(
      Effect.flatMap((chosen) => chosen === command ? Effect.succeed(command) : chooseCommand(chosen))
    )
  })

// ── one prompt per parameter ────────────────────────────────────────

/** the parameter's own token morph is the validator — undefined means
 * the token parses, a string is the inline error to show */
const tokenError = (p: CompiledParameter) => (value: string): string | undefined => {
  const out = (p.inner as AnyType)(value)
  return out instanceof type.errors ? out.summary : undefined
}

const label = (p: CompiledParameter): string =>
  pipe(
    Option.getOrElse(p.description, () => p.key),
    (base) => p.binding._tag === "flag" ? `${base} (${p.binding.name})` : `${base} <${p.key}>`
  )

const defaultedTrue = (p: CompiledParameter): boolean =>
  p.defaulted && Option.contains(p.defaultValue, true)

/** candidate values for autocomplete: generator output (run once with
 * the words so far, failures degrade), static suggestions, then the
 * named-source listing completion shows */
const candidatesFor = (
  p: CompiledParameter,
  suggest: SuggestContext
): Effect.Effect<ReadonlyArray<string>> =>
  pipe(
    Option.match(p.generator, {
      onNone: () => Effect.succeed([] as ReadonlyArray<string>),
      onSome: (generator) =>
        Effect.tryPromise(async () => generator(suggest)).pipe(
          Effect.orElseSucceed(() => [] as ReadonlyArray<string>)
        )
    }),
    Effect.map((dynamic) =>
      pipe(
        dynamic,
        Array.appendAll(Option.getOrElse(p.staticSuggestions, () => [] as ReadonlyArray<string>)),
        Array.appendAll(Option.match(p.source, {
          onNone: () => [] as ReadonlyArray<string>,
          onSome: (source) => sourceCandidates(source, "")
        })),
        Array.dedupe
      )
    )
  )

const skippable = (p: CompiledParameter): boolean => !p.required || p.defaulted

/** one value for one parameter: boolean → confirm; enumerable units →
 * select; candidates → autocomplete; otherwise validated text. an
 * optional parameter offers "(skip)" / empty submission → SKIP. */
const promptValue = (
  p: CompiledParameter,
  suggest: SuggestContext
): Effect.Effect<string | boolean | typeof SKIP, PromptCancelled> =>
  Effect.gen(function*() {
    if (p.isBoolean) {
      return yield* prompt(() =>
        confirm({ message: label(p), initialValue: defaultedTrue(p) })
      )
    }
    const units = unitCandidates((p.inner as AnyType).out as AnyType)
    if (Array.isReadonlyArrayNonEmpty(units)) {
      const initial = pipe(p.defaultValue, Option.map((v) => `${v}`), Option.getOrUndefined)
      return yield* prompt(() =>
        select<string | typeof SKIP>({
          message: label(p),
          options: [
            ...Array.map(units, (unit) => ({ value: unit as string | typeof SKIP, label: unit })),
            ...(skippable(p) ? [{ value: SKIP as string | typeof SKIP, label: "(skip)" }] : [])
          ],
          ...(initial === undefined ? {} : { initialValue: initial })
        })
      )
    }
    const candidates = yield* candidatesFor(p, suggest)
    if (Array.isReadonlyArrayNonEmpty(candidates)) {
      return yield* prompt(() =>
        autocomplete<string | typeof SKIP>({
          message: label(p),
          options: [
            ...Array.map(candidates, (value) => ({ value: value as string | typeof SKIP, label: value })),
            ...(skippable(p) ? [{ value: SKIP as string | typeof SKIP, label: "(skip)" }] : [])
          ]
        })
      )
    }
    const placeholder = pipe(
      p.defaultValue,
      Option.map((v) => `default: ${v}`),
      Option.orElse(() => skippable(p) ? Option.some("empty to skip") : Option.none()),
      Option.getOrUndefined
    )
    const entered = yield* prompt(() =>
      text({
        message: label(p),
        ...(placeholder === undefined ? {} : { placeholder }),
        validate: (value) =>
          value === undefined || value === ""
            ? skippable(p) ? undefined : "required"
            : tokenError(p)(value)
      })
    )
    return entered === undefined || entered === "" ? SKIP : entered
  })

/** variadic parameters collect until an empty/skip submission */
const collectVariadic = (
  p: CompiledParameter,
  suggest: SuggestContext,
  collected: ReadonlyArray<string | boolean>
): Effect.Effect<ReadonlyArray<string | boolean>, PromptCancelled> =>
  promptValue(p, suggest).pipe(
    Effect.flatMap((value) =>
      value === SKIP
        ? Effect.succeed(collected)
        : collectVariadic(p, suggest, Array.append(collected, value))
    )
  )

const promptParameter = (
  p: CompiledParameter,
  suggest: SuggestContext
): Effect.Effect<ReadonlyArray<string | boolean>, PromptCancelled> =>
  p.binding.variadic
    ? collectVariadic(p, suggest, [])
    : promptValue(p, suggest).pipe(
      Effect.map((value) => value === SKIP ? [] : [value])
    )

// ── token emission (the argv grammar) ───────────────────────────────

const negated = (name: string): string => StringModule.replace(/^--/, "--no-")(name)

const emit = (
  p: CompiledParameter,
  values: ReadonlyArray<string | boolean>,
  acc: { readonly flags: ReadonlyArray<string>; readonly positionals: ReadonlyArray<string> }
): { readonly flags: ReadonlyArray<string>; readonly positionals: ReadonlyArray<string> } => {
  if (p.binding._tag === "positional") {
    return {
      flags: acc.flags,
      positionals: Array.appendAll(acc.positionals, Array.map(values, (v) => `${v}`))
    }
  }
  const name = p.binding.name
  const tokens = Array.flatMap(values, (value): ReadonlyArray<string> => {
    if (value === true) return [name]
    if (value === false) return defaultedTrue(p) ? [negated(name)] : []
    // a declared flag consumes the next token unconditionally, so even
    // hyphen-leading values are safe in the two-token form (argv.ts)
    return [name, value]
  })
  return { flags: Array.appendAll(acc.flags, tokens), positionals: acc.positionals }
}

/** flags precede positionals; a hyphen-leading positional forces the
 * end-of-options fence — the external argv-reconstruction rule */
const fenced = (positionals: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.some(positionals, StringModule.startsWith("-"))
    ? Array.prepend(positionals, "--")
    : positionals

// ── the walk: entry to assembled argv ───────────────────────────────

/** guided invocation. returns the assembled argv (relative to the
 * program root — exactly what `cli.run(argv)` takes) or fails with
 * PromptCancelled. `makeSuggest` binds the interpreter's exec and
 * repository surfaces to the words assembled so far, the vocabulary
 * completion generators already receive. */
export const promptArgv = (
  root: CompiledCommand,
  makeSuggest: (words: ReadonlyArray<string>) => SuggestContext,
  path: ReadonlyArray<string>
): Effect.Effect<ReadonlyArray<string>, PromptCancelled> =>
  Effect.gen(function*() {
    yield* Effect.sync(() => intro(root.name))
    const command = yield* chooseCommand(resolveStart(root, path))
    const pathWords = Array.drop(command.path, 1)
    const assembled = yield* Effect.reduce(
      Array.filter(command.parameters, (p) => !p.cliHidden),
      () => ({ flags: [] as ReadonlyArray<string>, positionals: [] as ReadonlyArray<string> }),
      (acc, p) =>
        promptParameter(
          p,
          makeSuggest([...pathWords, ...acc.flags, ...acc.positionals])
        ).pipe(Effect.map((values) => emit(p, values, acc)))
    )
    const argv = [...pathWords, ...assembled.flags, ...fenced(assembled.positionals)]
    // teach the non-interactive form before dispatch
    yield* Effect.sync(() => outro(`> ${Array.join([root.name, ...argv], " ")}`))
    return argv
  })
