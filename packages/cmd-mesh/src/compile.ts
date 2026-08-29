import { type, Type } from "arktype"
import { Array, Effect, Option, Predicate, Record, String, pipe } from "effect"
import type { DeclarationIssue } from "./errors.js"
import { InvalidDeclaration } from "./errors.js"
import { diagnostics, issueText } from "./diagnostics.js"
import type {
  CliCommandConfig,
  CliParameterConfig,
  CommandSafety,
  ExternalCommandDecl,
  ExternalDecl,
  McpCommandConfig,
  McpExample,
  Mounted,
  ParameterDef,
  ParameterDescriptor,
  SuggestGenerator
} from "./types.js"
import { mounted } from "./types.js"

// runtime interpreter model. static typing lives in types.ts; this side is
// deliberately untyped (any) — the declaration was already validated
// statically at the program()/external() boundary, and ArkType's fluent
// surface (get/out/array/narrow) lives on concrete subtypes of Type.

export type AnyType = any
export type { Type }

export type Binding =
  | {
    readonly _tag: "positional"
    readonly optional: boolean
    readonly variadic: boolean
    readonly display: string
  }
  | {
    readonly _tag: "flag"
    readonly name: string
    readonly aliases: ReadonlyArray<string>
    /** commander-style value slot (`--tag <tags...>`): occurrences append */
    readonly variadic: boolean
  }

export interface CompiledParameter {
  readonly key: string
  /** the verbatim ArkType definition from the declaration */
  readonly def: unknown
  readonly binding: Binding
  readonly description: Option.Option<string>
  /** named suggestion source ("folders", "filepaths") */
  readonly source: Option.Option<string>
  /** static suggestion values */
  readonly staticSuggestions: Option.Option<ReadonlyArray<string>>
  /** suggestion generator, run on demand */
  readonly generator: Option.Option<SuggestGenerator>
  readonly env: Option.Option<string>
  /** hidden from help and completion; still parses */
  readonly cliHidden: boolean
  /** hidden from the mcp tool schema; still validates if supplied */
  readonly mcpHidden: boolean
  readonly required: boolean
  readonly defaulted: boolean
  /** display snapshot of the default — help, spec, docs */
  readonly defaultValue: Option.Option<unknown>
  /** fresh default per invocation: re-runs the def's own default (and
   * factory) so one handler's mutation never bleeds into the next call */
  readonly defaultFactory: Option.Option<() => unknown>
  readonly isBoolean: boolean
  /** external-only: a binary-global option, emitted before the
   * subcommand path when argv is reconstructed */
  readonly global: boolean
  /** per-parameter token → value morph type */
  readonly inner: AnyType
}

export interface CompiledCommand {
  readonly kind: "internal" | "external"
  readonly name: string
  readonly path: ReadonlyArray<string>
  readonly description: string
  readonly parameters: ReadonlyArray<CompiledParameter>
  /** argv token record → handler input (morphs, defaults, narrow) */
  readonly tokenType: AnyType
  /** call/mcp value record → handler input (defaults, narrow) */
  readonly valueType: AnyType
  /** valueType without narrow — predicates break JSON Schema projection */
  readonly schemaType: AnyType
  readonly outputType: Option.Option<AnyType>
  readonly run: Option.Option<(input: any, ctx: any) => unknown>
  readonly children: Readonly<globalThis.Record<string, CompiledCommand>>
  readonly cliHidden: boolean
  /** alternative cli names for reaching this command from its parent */
  readonly cliAliases: ReadonlyArray<string>
  /** child that runs when this group is invoked without a subcommand */
  readonly cliDefault: Option.Option<string>
  /** invocation lines for the help Examples section */
  readonly cliExamples: ReadonlyArray<string>
  readonly mcpHidden: boolean
  readonly mcpName: Option.Option<string>
  readonly mcpAnnotations: Option.Option<Readonly<globalThis.Record<string, unknown>>>
  readonly mcpExamples: ReadonlyArray<McpExample>
  readonly safety: Option.Option<CommandSafety>
  /** cli-only presentation override for the command's output */
  readonly cliRender: Option.Option<(output: unknown) => string>
  /** present on external commands: binary, fixed leading argv, and the
   * exit codes that count as success */
  readonly external: Option.Option<{
    readonly bin: string
    readonly argPath: ReadonlyArray<string>
    readonly successCodes: ReadonlyArray<number>
  }>
}

interface RawCommandDecl {
  readonly description?: string
  readonly input?: globalThis.Record<string, ParameterDef>
  readonly output?: unknown
  readonly narrow?: (input: any, ctx: any) => boolean
  readonly run?: (input: any, ctx: any) => unknown
  readonly safety?: string
  readonly commands?: globalThis.Record<string, RawCommandDecl | Mounted>
  readonly cli?: CliCommandConfig<never>
  readonly mcp?: McpCommandConfig
}

const normalizeCli = (cli: string | CliParameterConfig | undefined): CliParameterConfig =>
  cli === undefined ? {} : String.isString(cli) ? { usage: cli } : cli

const normalizeDescriptor = (def: ParameterDef): ParameterDescriptor =>
  String.isString(def) ? { type: def } : def

const parseBinding = (key: string, usage: string): Binding => {
  const trimmed = String.trim(usage)
  if (String.isEmpty(trimmed)) {
    return { _tag: "flag", name: `--${String.kebabCase(key)}`, aliases: [], variadic: false }
  }
  if (String.startsWith("<")(trimmed) || String.startsWith("[")(trimmed)) {
    return {
      _tag: "positional",
      optional: String.startsWith("[")(trimmed),
      variadic: String.includes("...")(trimmed),
      display: trimmed
    }
  }
  // a flag part may carry a commander-style value slot: "--tag <tags...>"
  const tokens = pipe(
    trimmed,
    String.split(","),
    Array.map(String.trim),
    Array.filter(String.isNonEmpty),
    Array.map((part) => pipe(part, String.split(" "), Array.headNonEmpty))
  )
  const name = pipe(
    tokens,
    Array.findFirst(String.startsWith("--")),
    Option.orElse(() => Array.head(tokens)),
    Option.getOrElse(() => `--${String.kebabCase(key)}`)
  )
  const aliases = pipe(tokens, Array.filter((t) => t !== name))
  return { _tag: "flag", name, aliases, variadic: String.includes("...")(trimmed) }
}

type Attempt<A> = { readonly _tag: "ok"; readonly value: A } | { readonly _tag: "failed"; readonly problem: string }

const attempt = <A>(f: () => A): Attempt<A> =>
  Effect.runSync(
    Effect.match(Effect.try({ try: f, catch: (e) => e }), {
      onSuccess: (value) => ({ _tag: "ok", value } as const),
      onFailure: (e) => ({ _tag: "failed", problem: `${e}` } as const)
    })
  )

/** structural problems a single parameter can carry */
// A suggest string must be a named source. Other values give no candidates.
const namedSuggestSources = ["filepaths", "folders"]

const parameterIssues = (at: string, p: CompiledParameter): ReadonlyArray<DeclarationIssue> =>
  Array.flatMap(
    [
      p.binding._tag === "positional" && p.isBoolean ? [diagnostics.CMSH1002()] : [],
      p.binding._tag === "positional" && Option.isSome(p.env) ? [diagnostics.CMSH1003()] : [],
      p.binding._tag === "positional" && p.cliHidden ? [diagnostics.CMSH1004()] : [],
      p.binding._tag === "flag" && p.binding.variadic && p.isBoolean ? [diagnostics.CMSH1005()] : [],
      Option.match(p.source, {
        onNone: () => [],
        onSome: (source) =>
          Array.contains(namedSuggestSources, source)
            ? []
            : [diagnostics.CMSH1014({ source, known: Array.join(namedSuggestSources, ", ") })]
      })
    ],
    (found) => Array.map(found, (diagnostic) => ({ at, problem: issueText(diagnostic) }))
  )

/** cross-parameter problems: flag token collisions, positional ordering */
const commandIssues = (
  at: string,
  parameters: ReadonlyArray<CompiledParameter>
): ReadonlyArray<DeclarationIssue> => {
  const flagTokens = Array.flatMap(parameters, (p) =>
    p.binding._tag === "flag"
      ? Array.map(Array.prepend(p.binding.aliases, p.binding.name), (token) => [token, p.key] as const)
      : [])
  const collisions = pipe(
    flagTokens,
    Array.groupBy(([token]) => token),
    Record.toEntries,
    Array.flatMap(([token, owners]) =>
      owners.length > 1
        ? [{
          at,
          problem: issueText(diagnostics.CMSH1006({
            token,
            owners: Array.join(Array.map(owners, ([, key]) => key), " and ")
          }))
        }]
        : [])
  )
  const positionals = Array.filter(parameters, (p) => p.binding._tag === "positional")
  const misplacedVariadic = pipe(
    positionals,
    Array.findFirstIndex((p) => p.binding._tag === "positional" && p.binding.variadic),
    Option.flatMap((index) =>
      index < positionals.length - 1
        ? Option.some({ at, problem: issueText(diagnostics.CMSH1007()) })
        : Option.none()
    ),
    Option.match({ onNone: () => [] as ReadonlyArray<DeclarationIssue>, onSome: (issue) => [issue] })
  )
  return Array.appendAll(collisions, misplacedVariadic)
}

// TypeScript does not find all unknown fields. See docs/errors.md.
const descriptorFields = ["type", "description", "suggest", "required", "cli", "mcp"]
const cliFields = ["usage", "env", "hidden"]

const strayFields = (value: unknown, known: ReadonlyArray<string>): ReadonlyArray<string> =>
  Predicate.isObject(value) && !Predicate.isFunction(value)
    ? Array.filter(
      Record.keys(value as globalThis.Record<string, unknown>),
      (key) => !Array.contains(known, key)
    )
    : []

const strayIssues = (
  at: string,
  found: ReadonlyArray<{ readonly key: string; readonly known: ReadonlyArray<string> }>
): ReadonlyArray<DeclarationIssue> =>
  Array.map(found, ({ key, known }) => ({
    at,
    problem: issueText(diagnostics.CMSH1013({ key, known: Array.join(known, ", ") }))
  }))

// One list for all command forms. An incorrect name is not in the list.
const commandFields = [
  "description",
  "input",
  "output",
  "narrow",
  "run",
  "safety",
  "commands",
  "cli",
  "mcp",
  "successCodes",
  "name",
  "version",
  "resources",
  "bin"
]
const cliCommandFields = ["hidden", "alias", "default", "render", "examples"]
const mcpFields = ["hidden", "name", "annotations", "examples"]

/** An incorrect mcp field keeps a hidden command visible to agents. */
const commandFieldIssues = (at: string, decl: unknown): ReadonlyArray<DeclarationIssue> => {
  const nested = decl as { readonly cli?: unknown; readonly mcp?: unknown }
  return strayIssues(at, [
    ...Array.map(strayFields(decl, commandFields), (key) => ({ key, known: commandFields })),
    ...Array.map(strayFields(nested.cli, cliCommandFields), (key) => ({
      key: `cli.${key}`,
      known: cliCommandFields
    })),
    ...Array.map(strayFields(nested.mcp, mcpFields), (key) => ({ key: `mcp.${key}`, known: mcpFields }))
  ])
}

const descriptorIssues = (at: string, rawDef: ParameterDef): ReadonlyArray<DeclarationIssue> =>
  String.isString(rawDef) ? [] : strayIssues(at, [
    ...Array.map(strayFields(rawDef, descriptorFields), (key) => ({ key, known: descriptorFields })),
    ...Array.map(strayFields(rawDef.cli, cliFields), (key) => ({ key: `cli.${key}`, known: cliFields }))
  ])

const compileParameter = (key: string, rawDef: ParameterDef): CompiledParameter => {
  const descriptor = normalizeDescriptor(rawDef)
  const cli = normalizeCli(descriptor.cli)
  const binding = parseBinding(key, cli.usage ?? "")
  // probe the def at property position: defaults only exist there, and
  // applying the probe to {} both detects a default and evaluates it
  // through its own morph into the value domain.
  const probe = type({ v: descriptor.type } as never) as AnyType
  const probed = probe({})
  const defaulted = !(probed instanceof type.errors)
  const defaultValue = defaulted ? Option.some((probed as { v: unknown }).v) : Option.none()
  const inner = probe.get("v") as AnyType
  // a defaulted def's extracted type is the default wrapper; boolean-ness
  // must be read off the unwrapped output side
  const isBoolean = defaulted
    ? (inner.out.exclude("undefined") as AnyType).extends("boolean")
    : inner.extends("boolean")
  // authored arktype meta (`.describe(...)`) is a description source; a
  // default wrapper hides it one level down on the unwrapped output side
  const metaDescription = Option.fromNullishOr(
    (inner.meta as { readonly description?: string }).description
  ).pipe(
    Option.orElse(() =>
      defaulted
        ? Option.fromNullishOr(
          ((inner.out.exclude("undefined") as AnyType).meta as { readonly description?: string })
            .description
        )
        : Option.none()
    )
  )
  return {
    key,
    def: descriptor.type,
    binding,
    description: Option.fromNullishOr(descriptor.description).pipe(
      Option.orElse(() => metaDescription)
    ),
    source: String.isString(descriptor.suggest) ? Option.some(descriptor.suggest) : Option.none(),
    staticSuggestions: globalThis.Array.isArray(descriptor.suggest)
      ? Option.some(descriptor.suggest)
      : Option.none(),
    generator: Predicate.isFunction(descriptor.suggest)
      ? Option.some(descriptor.suggest as SuggestGenerator)
      : Option.none(),
    env: Option.fromNullishOr(cli.env),
    cliHidden: cli.hidden === true,
    mcpHidden: descriptor.mcp?.hidden === true,
    required: descriptor.required === true,
    defaulted,
    defaultValue,
    defaultFactory: defaulted ? Option.some(() => (probe({}) as { v: unknown }).v) : Option.none(),
    isBoolean,
    global: false,
    inner
  }
}

const isRequiredVariadic = (p: CompiledParameter): boolean =>
  p.binding._tag === "positional"
    ? p.binding.variadic && !p.binding.optional
    : p.binding.variadic && p.required

const isOptionalNoDefault = (p: CompiledParameter): boolean => {
  if (p.defaulted || p.isBoolean) return false
  if (p.binding._tag === "positional") {
    return p.binding.optional && !p.binding.variadic
  }
  return !p.required
}

const valueRequired = (p: CompiledParameter): boolean => {
  if (p.defaulted) return false
  if (p.binding.variadic) return isRequiredVariadic(p)
  if (p.isBoolean) return p.required
  return !isOptionalNoDefault(p)
}

const hiddenRequiredIssues = (
  at: string,
  parameters: ReadonlyArray<CompiledParameter>,
  commandHiddenFromMcp: boolean
): ReadonlyArray<DeclarationIssue> =>
  commandHiddenFromMcp ? [] : Array.flatMap(parameters, (p) =>
    p.mcpHidden && valueRequired(p)
      ? [{ at: `${at} · ${p.key}`, problem: issueText(diagnostics.CMSH1015()) }]
      : [])

const variadicOf = (base: AnyType, p: CompiledParameter): AnyType => {
  const array = base.array() as AnyType
  return isRequiredVariadic(p) ? (array.atLeastLength(1) as AnyType) : array
}

const isVariadic = (p: CompiledParameter): boolean => p.binding.variadic

/** a parameter consumes a raw string token when its INPUT domain accepts
 * strings — asked of the compiled type, not the def's JS representation,
 * so Type instances classify the same as the string defs they equal */
const takesRawToken = (p: CompiledParameter): boolean =>
  String.isString(p.def) || Effect.runSync(
    Effect.try(() => ((p.inner.in as AnyType).extract("string") as AnyType).expression !== "never").pipe(
      Effect.orElseSucceed(() => false)
    )
  )

/** a structured (non-string-def) parameter consumes a JSON token on the
 * cli: parse the token, then pipe into the declared definition. a
 * defaultable def is illegal as a `.to` target — a defaulted structured
 * param pipes into its unwrapped output type instead (defaults are the
 * value boundary's job on this path anyway) */
const jsonToken = (p: CompiledParameter): AnyType =>
  type("string.json.parse").to(
    (p.defaulted ? ((p.inner.out as AnyType).exclude("undefined")) : p.def) as never
  ) as AnyType

/** boolean flags cross the token boundary as presence booleans or as the
 * literal tokens of `--flag=value`; the literal set follows the effect
 * cli convention (true/false, yes/no, on/off, 1/0) */
const booleanTokenType = type("boolean")
  .or(type("'true' | '1' | 'yes' | 'on'").pipe(() => true))
  .or(type("'false' | '0' | 'no' | 'off'").pipe(() => false))

/** entry for the argv-token side: raw def strings keep ArkType-native
 * input-domain defaults; booleans default false; variadics become arrays;
 * structured defs take JSON tokens and stay optional here — requiredness
 * and defaults are enforced by the value boundary, which the cli path
 * always runs after this one */
const tokenEntry = (p: CompiledParameter): readonly [string, unknown] => {
  if (!takesRawToken(p)) {
    const wrapped = jsonToken(p)
    return [`${p.key}?`, isVariadic(p) ? variadicOf(wrapped, p) : wrapped]
  }
  // an optional variadic (`[...xs]`) is present-and-empty when omitted;
  // a required one (`<...xs>`) demands at least one value
  if (isVariadic(p)) {
    return isRequiredVariadic(p)
      ? [p.key, variadicOf(p.inner, p)]
      : [p.key, [variadicOf(p.inner, p), "=", () => []]]
  }
  // a required boolean stays required: presence is its true value and
  // omission is a reportable error, not a silent false
  if (p.isBoolean) {
    if (p.defaulted) {
      return [p.key, [booleanTokenType, "=", () => Option.getOrThrow(p.defaultFactory)()]]
    }
    return p.required ? [p.key, booleanTokenType] : [p.key, [booleanTokenType, "=", false]]
  }
  if (isOptionalNoDefault(p)) return [`${p.key}?`, p.inner]
  return [p.key, p.def]
}

/** entry for the value side: output-domain types with defaults evaluated
 * through the morph at compile time. a defaulted prop's extracted .out
 * carries `| undefined` from the default wrapper — strip it, or it breaks
 * the JSON Schema projection. */
const valueEntry = (p: CompiledParameter): readonly [string, unknown] => {
  const rawOut = p.inner.out as AnyType
  const out = p.defaulted ? (rawOut.exclude("undefined") as AnyType) : rawOut
  if (isVariadic(p)) {
    return isRequiredVariadic(p)
      ? [p.key, variadicOf(out, p)]
      : [p.key, [variadicOf(out, p), "=", () => []]]
  }
  if (p.isBoolean && !p.defaulted) {
    return p.required ? [p.key, out] : [p.key, [out, "=", false]]
  }
  if (p.defaulted) {
    return [p.key, [out, "=", () => Option.getOrThrow(p.defaultFactory)()]]
  }
  if (isOptionalNoDefault(p)) return [`${p.key}?`, out]
  return [p.key, out]
}

const assemble = (
  parameters: ReadonlyArray<CompiledParameter>,
  entry: (p: CompiledParameter) => readonly [string, unknown]
): AnyType => type(Record.fromEntries(Array.map(parameters, entry)) as never) as AnyType

const withNarrow = (t: AnyType, narrow: ((input: any, ctx: any) => boolean) | undefined): AnyType =>
  narrow === undefined ? t : (t.narrow(narrow) as AnyType)

// a program module is a callable function, an external module a plain
// object — the marker check must see both
const isMounted = (value: unknown): value is Mounted & { readonly [mounted]: CompiledCommand } =>
  (Predicate.isObject(value) || Predicate.isFunction(value)) && mounted in (value as object)

/** rewrite the display paths of a compiled subtree when it mounts elsewhere */
export const repath = (cmd: CompiledCommand, path: ReadonlyArray<string>): CompiledCommand => ({
  ...cmd,
  path,
  children: Record.map(cmd.children, (child, name) => repath(child, Array.append(path, name)))
})

type Collected = readonly [CompiledCommand, ReadonlyArray<DeclarationIssue>]

const collectCommand = (
  name: string,
  path: ReadonlyArray<string>,
  decl: RawCommandDecl,
  inherited: Readonly<globalThis.Record<string, ParameterDef>> = {},
  inheritedNarrow?: (input: any, ctx: any) => boolean
): Collected => {
  const at = Array.join(path, " ")
  // program-level options (the root's input) join every command — same
  // model as an external's binary-global options. own keys win.
  const merged = { ...inherited, ...decl.input }
  const attempts = pipe(
    Record.toEntries(merged),
    Array.map(([key, def]) => ({ key, result: attempt(() => compileParameter(key, def)) } as const))
  )
  const parameters = pipe(
    Array.flatMap(attempts, ({ result }) => result._tag === "ok" ? [result.value] : []),
    Array.map((p) =>
      Option.isSome(Record.get(inherited, p.key)) && (decl.input?.[p.key]) === undefined
        ? { ...p, global: true }
        : p
    )
  )
  const outputAttempt = decl.output === undefined
    ? undefined
    : attempt(() => type(decl.output as never) as AnyType)
  const ownIssuesBase = pipe(
    Array.flatMap(attempts, ({ key, result }) =>
      result._tag === "failed"
        ? [{ at: `${at} · ${key}`, problem: issueText(diagnostics.CMSH1001({ error: result.problem })) }]
        : []),
    Array.appendAll(
      Array.flatMap(Record.toEntries(merged), ([key, def]) => descriptorIssues(`${at} · ${key}`, def))
    ),
    Array.appendAll(Array.flatMap(parameters, (p) => parameterIssues(`${at} · ${p.key}`, p))),
    Array.appendAll(hiddenRequiredIssues(at, parameters, decl.mcp?.hidden === true)),
    Array.appendAll(commandIssues(at, parameters)),
    Array.appendAll(
      outputAttempt?._tag === "failed"
        ? [{
          at: `${at} · output`,
          problem: issueText(diagnostics.CMSH1001({ error: outputAttempt.problem }))
        }]
        : []
    )
  )
  // with a broken declaration the types are placeholders; program() throws
  // the aggregate before anything can invoke them. assembly itself can
  // also fail to parse — that is a declaration problem too, never a raw
  // ParseError escaping the aggregate
  const assemblyAttempt = ownIssuesBase.length > 0
    ? undefined
    : attempt(() => ({
      tokenType: assemble(parameters, tokenEntry),
      schemaType: assemble(parameters, valueEntry)
    }))
  const assemblyIssues: ReadonlyArray<DeclarationIssue> = assemblyAttempt?._tag === "failed"
    ? [{ at, problem: issueText(diagnostics.CMSH1001({ error: assemblyAttempt.problem })) }]
    : []
  const assembly = assemblyAttempt?._tag === "ok"
    ? assemblyAttempt.value
    : { tokenType: type({}) as AnyType, schemaType: type({}) as AnyType }
  const ownIssues = Array.appendAll(ownIssuesBase, assemblyIssues)
  // narrow lives on the value boundary only: the cli path runs token
  // parsing first and the value boundary second, so it still applies
  // once. a root narrow travels with the root's options — an invariant
  // over program-level values holds wherever they are supplied.
  const valueType = withNarrow(withNarrow(assembly.schemaType, inheritedNarrow), decl.narrow)
  // only the PROGRAM root's input propagates (path length 1) — mirrors
  // externals, where only binary-root globals join every command.
  // mounted modules are finished programs and keep their own model.
  const passedDown = path.length === 1 ? merged : inherited
  const passedNarrow = path.length === 1 ? decl.narrow : inheritedNarrow
  const childPairs = Record.map(decl.commands ?? {}, (child, childName): Collected =>
    isMounted(child)
      ? [repath(child[mounted], Array.append(path, childName)), []] as const
      : collectCommand(
        childName,
        Array.append(path, childName),
        child as RawCommandDecl,
        passedDown,
        passedNarrow
      ))
  const children = Record.map(childPairs, ([child]) => child)
  // a subcommand name — real or alias — must resolve to exactly one child
  const nameClaims = pipe(
    Record.toEntries(children),
    Array.flatMap(([childName, child]) =>
      Array.map(Array.prepend(child.cliAliases, childName), (token) => [token, childName] as const))
  )
  const aliasIssues = pipe(
    nameClaims,
    Array.groupBy(([token]) => token),
    Record.toEntries,
    Array.flatMap(([token, owners]) =>
      owners.length > 1
        ? [{
          at,
          problem: issueText(diagnostics.CMSH1012({
            token,
            owners: Array.join(Array.map(owners, ([, owner]) => owner), " and ")
          }))
        }]
        : [])
  )
  // `cli.default` may be spelled as an alias — resolve it to the child's
  // canonical name HERE, so every downstream lookup (routing, help,
  // completion) stays a plain record access
  const resolvedDefault = Option.fromNullishOr(decl.cli?.default).pipe(
    Option.map((name) =>
      Option.isSome(Record.get(children, name)) ? Option.some(name) : pipe(
        Record.toEntries(children),
        Array.findFirst(([, child]) => Array.contains(child.cliAliases, name)),
        Option.map(([realName]) => realName)
      )
    )
  )
  const defaultIssues = pipe(
    Option.fromNullishOr(decl.cli?.default),
    Option.match({
      onNone: () => [] as ReadonlyArray<DeclarationIssue>,
      onSome: (name) =>
        Array.flatMap(
          [
            decl.run === undefined ? [] : [diagnostics.CMSH1008()],
            Option.isSome(Option.flatten(resolvedDefault)) ? [] : [diagnostics.CMSH1009({ name })]
          ],
          (found) => Array.map(found, (diagnostic) => ({ at, problem: issueText(diagnostic) }))
        )
    })
  )
  const safetyIssues: ReadonlyArray<DeclarationIssue> =
    decl.safety !== undefined && !Array.contains(["read", "action", "destructive"], decl.safety)
      ? [{ at, problem: issueText(diagnostics.CMSH1010({ got: `${decl.safety}` })) }]
      : []
  const exampleIssues: ReadonlyArray<DeclarationIssue> = pipe(
    (decl.mcp?.examples ?? []) as ReadonlyArray<McpExample>,
    Array.flatMap((example, index) =>
      (assembly.schemaType as AnyType).allows(example.args)
        ? []
        : [{
          at,
          problem: issueText(diagnostics.CMSH1011({ index, args: JSON.stringify(example.args) }))
        }]
    )
  )
  const command: CompiledCommand = {
    kind: "internal",
    name,
    path,
    description: decl.description ?? "",
    parameters,
    tokenType: assembly.tokenType,
    valueType,
    schemaType: assembly.schemaType,
    outputType: outputAttempt?._tag === "ok" ? Option.some(outputAttempt.value) : Option.none(),
    run: Option.fromNullishOr(decl.run),
    children,
    cliHidden: decl.cli?.hidden === true,
    cliAliases: pipe(
      Option.fromNullishOr(decl.cli?.alias),
      Option.match({
        onNone: () => [] as ReadonlyArray<string>,
        onSome: (alias) => String.isString(alias) ? [alias] : alias
      })
    ),
    cliDefault: Option.flatten(resolvedDefault),
    cliExamples: decl.cli?.examples ?? [],
    mcpHidden: decl.mcp?.hidden === true,
    mcpName: Option.fromNullishOr(decl.mcp?.name),
    mcpAnnotations: Option.fromNullishOr(decl.mcp?.annotations),
    mcpExamples: decl.mcp?.examples ?? [],
    safety: Option.fromNullishOr(decl.safety as CommandSafety | undefined),
    cliRender: Option.fromNullishOr(decl.cli?.render as ((output: unknown) => string) | undefined),
    external: Option.none()
  }
  const issues = pipe(
    ownIssues,
    Array.appendAll(commandFieldIssues(at, decl)),
    Array.appendAll(aliasIssues),
    Array.appendAll(defaultIssues),
    Array.appendAll(safetyIssues),
    Array.appendAll(exampleIssues),
    Array.appendAll(
      pipe(Record.toEntries(childPairs), Array.flatMap(([, [, childIssues]]) => childIssues))
    )
  )
  return [command, issues] as const
}

/** compile one command tree; throws InvalidDeclaration listing every
 * problem in the whole declaration at once */
export const compileCommand = (
  name: string,
  path: ReadonlyArray<string>,
  decl: RawCommandDecl
): CompiledCommand => {
  const [command, issues] = collectCommand(name, path, decl)
  if (issues.length > 0) {
    throw new InvalidDeclaration({ issues })
  }
  return command
}

const collectExternalCommand = (
  bin: string,
  globals: Readonly<globalThis.Record<string, ParameterDef>>,
  argPath: ReadonlyArray<string>,
  name: string,
  path: ReadonlyArray<string>,
  decl: ExternalCommandDecl
): Collected => {
  const { commands: _children, ...withoutChildren } = decl
  // a command redefining a binary-global key would make one token mean
  // two things in a single invocation — undiagnosable from the spawn
  const collisionIssues = pipe(
    Record.keys(decl.input ?? {}),
    Array.filter((key) => Option.isSome(Record.get(globals, key))),
    Array.map((key) => ({
      at: Array.join(path, " "),
      problem: `parameter ${key} redefines a binary-global option`
    }))
  )
  // the binary's global options join every command's own input at compile
  // time, so typed calls, schemas, help, and the cli walk need no extra
  // machinery — only spawn-time reconstruction reads the marker below
  const [base, ownIssues] = collectCommand(name, path, {
    ...withoutChildren,
    input: { ...globals, ...decl.input }
  })
  const marked = Array.map(base.parameters, (p) =>
    Option.isSome(Record.get(globals, p.key)) ? { ...p, global: true } : p)
  const childPairs = Record.map(decl.commands ?? {}, (child, childName): Collected =>
    collectExternalCommand(
      bin,
      globals,
      // the module key stays dot-callable; the binary receives its own
      // spelling, kebab-cased like derived flag names
      Array.append(argPath, String.kebabCase(childName)),
      childName,
      Array.append(path, childName),
      child
    ))
  const command: CompiledCommand = {
    ...base,
    kind: "external",
    parameters: marked,
    outputType: Option.some(type((decl.output ?? "string") as never) as AnyType),
    external: Option.some({ bin, argPath, successCodes: decl.successCodes ?? [0] }),
    children: Record.map(childPairs, ([child]) => child)
  }
  const issues = pipe(
    collisionIssues,
    Array.appendAll(ownIssues),
    Array.appendAll(commandFieldIssues(Array.join(path, " "), decl)),
    Array.appendAll(
      pipe(Record.toEntries(childPairs), Array.flatMap(([, [, childIssues]]) => childIssues))
    )
  )
  return [command, issues] as const
}

export const compileExternal = (decl: ExternalDecl): CompiledCommand => {
  const bin = decl.bin ?? decl.name
  const childPairs = Record.map(decl.commands, (child, childName): Collected =>
    collectExternalCommand(
      bin,
      decl.input ?? {},
      [String.kebabCase(childName)],
      childName,
      [decl.name, childName],
      child
    ))
  const issues = pipe(
    Record.toEntries(childPairs),
    Array.flatMap(([, [, childIssues]]) => childIssues),
    Array.appendAll(commandFieldIssues(decl.name, decl))
  )
  if (issues.length > 0) {
    throw new InvalidDeclaration({ issues })
  }
  return {
    kind: "external",
    name: decl.name,
    path: [decl.name],
    description: decl.description ?? "",
    parameters: [],
    tokenType: type({}) as AnyType,
    valueType: type({}) as AnyType,
    schemaType: type({}) as AnyType,
    outputType: Option.none(),
    run: Option.none(),
    children: Record.map(childPairs, ([child]) => child),
    cliHidden: false,
    cliAliases: [],
    cliDefault: Option.none(),
    cliExamples: [],
    mcpHidden: false,
    mcpName: Option.none(),
    mcpAnnotations: Option.none(),
    mcpExamples: [],
    safety: Option.none(),
    cliRender: Option.none(),
    external: Option.some({ bin, argPath: [], successCodes: [0] })
  }
}
