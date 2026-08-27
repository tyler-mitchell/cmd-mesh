import { type, Type } from "arktype"
import { Array, Effect, Option, Predicate, Record, String, pipe } from "effect"
import type { DeclarationIssue } from "./errors.js"
import { InvalidDeclaration } from "./errors.js"
import type {
  CliParameterConfig,
  ExternalCommandDecl,
  ExternalDecl,
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
  readonly mcpHidden: boolean
  readonly required: boolean
  readonly defaulted: boolean
  readonly defaultValue: Option.Option<unknown>
  readonly isBoolean: boolean
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
  readonly mcpHidden: boolean
  readonly mcpName: Option.Option<string>
  readonly mcpAnnotations: Option.Option<Readonly<globalThis.Record<string, unknown>>>
  /** cli-only presentation override for the command's output */
  readonly cliRender: Option.Option<(output: unknown) => string>
  /** present on external commands: binary plus fixed leading argv */
  readonly external: Option.Option<{ readonly bin: string; readonly argPath: ReadonlyArray<string> }>
}

interface RawCommandDecl {
  readonly description?: string
  readonly input?: globalThis.Record<string, ParameterDef>
  readonly output?: unknown
  readonly narrow?: (input: any, ctx: any) => boolean
  readonly run?: (input: any, ctx: any) => unknown
  readonly commands?: globalThis.Record<string, RawCommandDecl | Mounted>
  readonly cli?: { readonly hidden?: boolean; readonly render?: (output: never) => string }
  readonly mcp?: {
    readonly hidden?: boolean
    readonly name?: string
    readonly annotations?: Readonly<globalThis.Record<string, unknown>>
  }
}

const normalizeCli = (cli: string | CliParameterConfig | undefined): CliParameterConfig =>
  cli === undefined ? {} : String.isString(cli) ? { usage: cli } : cli

const normalizeDescriptor = (def: ParameterDef): ParameterDescriptor =>
  String.isString(def) ? { type: def } : def

const parseBinding = (key: string, usage: string): Binding => {
  const trimmed = String.trim(usage)
  if (String.isEmpty(trimmed)) {
    return { _tag: "flag", name: `--${String.kebabCase(key)}`, aliases: [] }
  }
  if (String.startsWith("<")(trimmed) || String.startsWith("[")(trimmed)) {
    return {
      _tag: "positional",
      optional: String.startsWith("[")(trimmed),
      variadic: String.includes("...")(trimmed),
      display: trimmed
    }
  }
  const tokens = pipe(trimmed, String.split(","), Array.map(String.trim), Array.filter(String.isNonEmpty))
  const name = pipe(
    tokens,
    Array.findFirst(String.startsWith("--")),
    Option.orElse(() => Array.head(tokens)),
    Option.getOrElse(() => `--${String.kebabCase(key)}`)
  )
  const aliases = pipe(tokens, Array.filter((t) => t !== name))
  return { _tag: "flag", name, aliases }
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
const parameterIssues = (at: string, p: CompiledParameter): ReadonlyArray<DeclarationIssue> =>
  Array.flatMap(
    [
      p.binding._tag === "positional" && p.isBoolean
        ? [`a positional cannot be boolean — booleans are flag presence`]
        : [],
      p.binding._tag === "positional" && Option.isSome(p.env)
        ? [`env fallback is only meaningful on flags`]
        : []
    ],
    (problems) => Array.map(problems, (problem) => ({ at, problem }))
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
          problem: `flag ${token} is claimed by ${
            Array.join(Array.map(owners, ([, key]) => key), " and ")
          }`
        }]
        : [])
  )
  const positionals = Array.filter(parameters, (p) => p.binding._tag === "positional")
  const misplacedVariadic = pipe(
    positionals,
    Array.findFirstIndex((p) => p.binding._tag === "positional" && p.binding.variadic),
    Option.flatMap((index) =>
      index < positionals.length - 1
        ? Option.some({ at, problem: `variadic positional must be the last positional` })
        : Option.none()
    ),
    Option.match({ onNone: () => [] as ReadonlyArray<DeclarationIssue>, onSome: (issue) => [issue] })
  )
  return Array.appendAll(collisions, misplacedVariadic)
}

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
  return {
    key,
    def: descriptor.type,
    binding,
    description: Option.fromNullishOr(descriptor.description),
    source: String.isString(descriptor.suggest) ? Option.some(descriptor.suggest) : Option.none(),
    staticSuggestions: globalThis.Array.isArray(descriptor.suggest)
      ? Option.some(descriptor.suggest)
      : Option.none(),
    generator: Predicate.isFunction(descriptor.suggest)
      ? Option.some(descriptor.suggest as SuggestGenerator)
      : Option.none(),
    env: Option.fromNullishOr(cli.env),
    mcpHidden: descriptor.mcp?.hidden === true,
    required: descriptor.required === true,
    defaulted,
    defaultValue,
    isBoolean: inner.extends("boolean"),
    inner
  }
}

const isRequiredVariadic = (p: CompiledParameter): boolean =>
  p.binding._tag === "positional" && p.binding.variadic && !p.binding.optional

const isOptionalNoDefault = (p: CompiledParameter): boolean => {
  if (p.defaulted || p.isBoolean) return false
  if (p.binding._tag === "positional") {
    return p.binding.optional && !p.binding.variadic
  }
  return !p.required
}

const variadicOf = (base: AnyType, p: CompiledParameter): AnyType => {
  const array = base.array() as AnyType
  return isRequiredVariadic(p) ? (array.atLeastLength(1) as AnyType) : array
}

const isVariadic = (p: CompiledParameter): boolean => p.binding._tag === "positional" && p.binding.variadic

const isStringDef = (p: CompiledParameter): boolean => String.isString(p.def)

/** a structured (non-string-def) parameter consumes a JSON token on the
 * cli: parse the token, then pipe into the declared definition */
const jsonToken = (p: CompiledParameter): AnyType => type("string.json.parse").to(p.def as never) as AnyType

/** entry for the argv-token side: raw def strings keep ArkType-native
 * input-domain defaults; booleans default false; variadics become arrays;
 * structured defs take JSON tokens and stay optional here — requiredness
 * and defaults are enforced by the value boundary, which the cli path
 * always runs after this one */
const tokenEntry = (p: CompiledParameter): readonly [string, unknown] => {
  if (!isStringDef(p)) {
    const wrapped = jsonToken(p)
    return [`${p.key}?`, isVariadic(p) ? variadicOf(wrapped, p) : wrapped]
  }
  if (isVariadic(p)) return [p.key, variadicOf(p.inner, p)]
  if (p.isBoolean && !p.defaulted) return [p.key, [p.inner, "=", false]]
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
  if (isVariadic(p)) return [p.key, variadicOf(out, p)]
  if (p.isBoolean && !p.defaulted) return [p.key, [out, "=", false]]
  if (p.defaulted) {
    return [p.key, [out, "=", () => Option.getOrThrow(p.defaultValue)]]
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

const isMounted = (value: unknown): value is Mounted & { readonly [mounted]: CompiledCommand } =>
  Predicate.isObject(value) && Predicate.hasProperty(value, mounted)

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
  decl: RawCommandDecl
): Collected => {
  const at = Array.join(path, " ")
  const attempts = pipe(
    Record.toEntries(decl.input ?? {}),
    Array.map(([key, def]) => ({ key, result: attempt(() => compileParameter(key, def)) } as const))
  )
  const parameters = Array.flatMap(attempts, ({ result }) => result._tag === "ok" ? [result.value] : [])
  const outputAttempt = decl.output === undefined
    ? undefined
    : attempt(() => type(decl.output as never) as AnyType)
  const ownIssues = pipe(
    Array.flatMap(attempts, ({ key, result }) =>
      result._tag === "failed" ? [{ at: `${at} · ${key}`, problem: result.problem }] : []),
    Array.appendAll(Array.flatMap(parameters, (p) => parameterIssues(`${at} · ${p.key}`, p))),
    Array.appendAll(commandIssues(at, parameters)),
    Array.appendAll(
      outputAttempt?._tag === "failed" ? [{ at: `${at} · output`, problem: outputAttempt.problem }] : []
    )
  )
  // with a broken declaration the types are placeholders; program() throws
  // the aggregate before anything can invoke them
  const assembly = ownIssues.length > 0
    ? { tokenType: type({}) as AnyType, schemaType: type({}) as AnyType }
    : { tokenType: assemble(parameters, tokenEntry), schemaType: assemble(parameters, valueEntry) }
  // narrow lives on the value boundary only: the cli path runs token
  // parsing first and the value boundary second, so it still applies once
  const valueType = withNarrow(assembly.schemaType, decl.narrow)
  const childPairs = Record.map(decl.commands ?? {}, (child, childName): Collected =>
    isMounted(child)
      ? [repath(child[mounted], Array.append(path, childName)), []] as const
      : collectCommand(childName, Array.append(path, childName), child as RawCommandDecl))
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
    children: Record.map(childPairs, ([child]) => child),
    cliHidden: decl.cli?.hidden === true,
    mcpHidden: decl.mcp?.hidden === true,
    mcpName: Option.fromNullishOr(decl.mcp?.name),
    mcpAnnotations: Option.fromNullishOr(decl.mcp?.annotations),
    cliRender: Option.fromNullishOr(decl.cli?.render as ((output: unknown) => string) | undefined),
    external: Option.none()
  }
  const issues = Array.appendAll(
    ownIssues,
    pipe(Record.toEntries(childPairs), Array.flatMap(([, [, childIssues]]) => childIssues))
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

const compileExternalCommand = (
  bin: string,
  argPath: ReadonlyArray<string>,
  name: string,
  path: ReadonlyArray<string>,
  decl: ExternalCommandDecl
): CompiledCommand => {
  const { commands: _children, ...withoutChildren } = decl
  const base = compileCommand(name, path, withoutChildren)
  return {
    ...base,
    kind: "external",
    outputType: Option.some(type((decl.output ?? "string") as never) as AnyType),
    external: Option.some({ bin, argPath }),
    children: Record.map(decl.commands ?? {}, (child, childName) =>
      compileExternalCommand(
        bin,
        Array.append(argPath, childName),
        childName,
        Array.append(path, childName),
        child
      ))
  }
}

export const compileExternal = (decl: ExternalDecl): CompiledCommand => {
  const bin = decl.bin ?? decl.name
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
    children: Record.map(
      decl.commands,
      (child, childName) =>
        compileExternalCommand(bin, [childName], childName, [decl.name, childName], child)
    ),
    cliHidden: false,
    mcpHidden: false,
    mcpName: Option.none(),
    mcpAnnotations: Option.none(),
    cliRender: Option.none(),
    external: Option.some({ bin, argPath: [] })
  }
}
