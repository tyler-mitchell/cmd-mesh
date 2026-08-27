import type { distill, type } from "arktype"

// ─── declaration model ──────────────────────────────────────────────────────
// the consumer-authored data. parameters are ArkType property-position
// definitions; argv-specific config sits under `cli`, mcp-specific under
// `mcp`. see ideations/08-final.ts for the adopted contract.

export interface SuggestContext {
  exec(bin: string, args: ReadonlyArray<string>, options?: ExecOptions): Promise<ExecResult>
  readonly words: ReadonlyArray<string>
}

/** a Fig-style generator: computes suggestions on demand, with process
 * execution available */
export type SuggestGenerator = (
  ctx: SuggestContext
) => ReadonlyArray<string> | Promise<ReadonlyArray<string>>

/** how a parameter's candidate values are produced: a named source
 * ("folders", "filepaths"), a static list, or a generator. suggestions are
 * a universal property of the parameter — shell completion is their cli
 * projection, schema examples their mcp projection. */
export type SuggestSource = string | ReadonlyArray<string> | SuggestGenerator

export interface CliParameterConfig {
  /** usage notation: "<x>" required positional, "[x]" optional positional,
   * "<...xs>" variadic, "--flag, -f" flag with aliases. omitted ⇒ derived
   * --kebab-case flag. */
  readonly usage?: string
  /** environment variable fallback (argv > env > default) */
  readonly env?: string
}

export interface McpParameterConfig {
  readonly hidden?: boolean
  readonly description?: string
}

export interface ParameterDescriptor {
  /** any ArkType definition: a string ("string.integer.parse = '3000'"),
   * an object def ({ a: "string" }), a tuple expression, or a Type
   * instance. structured (non-string-def) parameters take a JSON token on
   * the cli and real values on the call/mcp surface. */
  readonly type: unknown
  readonly description?: string
  /** candidate values, universal to every surface. hoist generator
   * functions to consts with annotated parameters — inline arrows are
   * context-sensitive and collapse the command's type inference. */
  readonly suggest?: SuggestSource
  /** flags are optional unless required; positionals ignore this */
  readonly required?: boolean
  readonly cli?: string | CliParameterConfig
  readonly mcp?: McpParameterConfig
}

export type ParameterDef = string | ParameterDescriptor

export interface CliCommandConfig {
  readonly hidden?: boolean
  /** override how this command's output prints for humans; `--json` and
   * agent surfaces are unaffected */
  readonly render?: (output: never) => string
}

export interface McpCommandConfig {
  readonly hidden?: boolean
  /** overrides the derived flattened tool name */
  readonly name?: string
  /** mcp tool annotations, e.g. { readOnlyHint: true, destructiveHint: true } */
  readonly annotations?: Readonly<globalThis.Record<string, unknown>>
}

/** structural subset of ArkType's traversal context — consumers never import arktype */
export interface NarrowContext {
  mustBe(expected: string): false
  reject(spec: {
    readonly expected?: string
    readonly actual?: string
    readonly relativePath?: ReadonlyArray<PropertyKey>
    readonly problem?: string
    readonly message?: string
  }): false
}

export interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface ExecOptions {
  readonly cwd?: string
  readonly env?: Readonly<globalThis.Record<string, string>>
  /** "capture" (default) collects stdout/stderr into the result;
   * "inherit" streams the child straight to the parent terminal — the
   * result then carries empty output strings and the exit code */
  readonly stdio?: "capture" | "inherit"
  /** kill the process and fail if it runs longer than this */
  readonly timeoutMs?: number
}

export type Surface = "cli" | "mcp" | "call"

/** interpreter-owned capabilities handed to handlers. not user DI. */
export interface Ctx {
  exec(bin: string, args: ReadonlyArray<string>, options?: ExecOptions): Promise<ExecResult>
  readonly surface: Surface
}

// ─── static inference ───────────────────────────────────────────────────────
// what the compiler must produce, computed from the declaration literal.
// param def string → ArkType inference; cli usage notation → optionality
// and variadic shape.

export type DefOf<P> = P extends string ? P : P extends { readonly type: infer D } ? D : never

export type UsageOf<P> = P extends { readonly cli: infer C }
  ? C extends string ? C : C extends { readonly usage: infer U extends string } ? U : ""
  : ""

/** raw inference of a morphing def is its morph signature — distill to the
 * output side, which is what handlers and callers see */
type OutOf<P> = distill<type.infer<DefOf<P>>, "out">

type IsVariadic<P> = UsageOf<P> extends `<...${string}` | `[...${string}` ? true : false
type IsPositional<P> = UsageOf<P> extends `<${string}` | `[${string}` ? true : false
type IsOptionalPositional<P> = UsageOf<P> extends `[${string}` ? true : false
type HasDefault<P> = DefOf<P> extends `${string}=${string}` ? true : false
type IsBoolean<P> = [OutOf<P>] extends [boolean] ? true : false
type IsRequiredFlag<P> = P extends { readonly required: true } ? true : false

type ValueOf<P> = IsVariadic<P> extends true ? ReadonlyArray<OutOf<P>> : OutOf<P>

/** optional at the call boundary: defaulted, optional positional, or a
 * non-required flag (booleans default false, plain flags may be absent) */
type CallOptional<P> = HasDefault<P> extends true ? true
  : IsOptionalPositional<P> extends true ? true
  : IsPositional<P> extends true ? false
  : IsRequiredFlag<P> extends true ? false
  : true

/** still possibly absent when the handler runs: no default fills it */
type HandlerOptional<P> = HasDefault<P> extends true ? false
  : IsBoolean<P> extends true ? false
  : IsVariadic<P> extends true ? false
  : CallOptional<P>

type Show<T> = { [K in keyof T]: T[K] } & {}

export type CallInput<I> = Show<
  & { readonly [K in keyof I as CallOptional<I[K]> extends true ? never : K]: ValueOf<I[K]> }
  & { readonly [K in keyof I as CallOptional<I[K]> extends true ? K : never]?: ValueOf<I[K]> }
>

export type HandlerInput<I> = Show<
  & { readonly [K in keyof I as HandlerOptional<I[K]> extends true ? never : K]: ValueOf<I[K]> }
  & { readonly [K in keyof I as HandlerOptional<I[K]> extends true ? K : never]?: ValueOf<I[K]> }
>

type InputOf<C> = C extends { readonly input: infer I } ? I : {}

export type OutputOf<C, R> = C extends { readonly output: infer O } ? distill<type.infer<O>, "out">
  : Awaited<R>

// ─── declaration inference ──────────────────────────────────────────────────
// reverse-mapped-type pattern. TS inverts a homomorphic mapped type only
// over a naked type parameter, and context-sensitive functions contribute
// no inference candidates — so the signature splits three ways:
//   Cs  — the commands record, inferred with every literal intact through
//         the naked CommandsData template
//   Rs  — handler returns, captured through CommandsOverlay's return
//         positions (mapped over Rs itself, which IS invertible)
//   overlay — the same CommandsOverlay contextually types bare `(input,
//         ctx)` handler parameters from each command's sibling `input`
// consequence: one inline level of `commands` infers fully. deeper trees
// are mounted subprograms (`commands: { cache }`), each with its own full
// inference — mounting is the contract's nesting mechanism anyway.

export type CommandsData<M> = {
  readonly [N in keyof M]: M[N] extends Mounted ? M[N] : { readonly [K in keyof M[N]]: M[N][K] }
}

export type CommandsOverlay<M, Rs> = {
  readonly [N in keyof Rs]: {
    readonly run?: (input: HandlerInput<InputOf<M[N & keyof M]>>, ctx: Ctx) => Rs[N]
    readonly narrow?: (input: HandlerInput<InputOf<M[N & keyof M]>>, ctx: NarrowContext) => boolean
  }
}

export interface ProgramDeclOf<Name extends string, RootIn, RootOut, RootR, Cs, Rs> {
  readonly name: Name
  readonly version?: string
  readonly description?: string
  readonly input?: RootIn
  readonly output?: RootOut
  readonly narrow?: (input: HandlerInput<NoInfer<RootIn>>, ctx: NarrowContext) => boolean
  readonly run?: (input: HandlerInput<NoInfer<RootIn>>, ctx: Ctx) => RootR
  readonly commands?: CommandsData<Cs> & CommandsOverlay<NoInfer<Cs>, Rs>
  readonly cli?: CliCommandConfig
  readonly mcp?: McpCommandConfig
}

export interface ExternalCommandDecl {
  readonly description?: string
  readonly input?: globalThis.Record<string, ParameterDef>
  /** ArkType definition applied to stdout on success */
  readonly output?: unknown
  readonly commands?: globalThis.Record<string, ExternalCommandDecl>
  readonly cli?: CliCommandConfig
  readonly mcp?: McpCommandConfig
}

export interface ExternalDecl {
  readonly name: string
  readonly description?: string
  /** binary to execute; defaults to `name` */
  readonly bin?: string
  readonly commands: globalThis.Record<string, ExternalCommandDecl>
}

// ─── module surface ─────────────────────────────────────────────────────────
// what the interpreters return: callable modules with projections.

export const mounted: unique symbol = Symbol.for("cmd-mesh/mounted")

/** an already-built module, mountable inside another program's `commands` */
export interface Mounted {
  readonly [mounted]: unknown
}

export interface ArgsType<out T> {
  assert(value: unknown): T
  allows(value: unknown): boolean
  toJsonSchema(): unknown
}

/** the input argument is optional whenever every key is optional */
export type CommandFn<C, R> = {} extends CallInput<InputOf<C>>
  ? (input?: CallInput<InputOf<C>>) => Promise<OutputOf<C, R>>
  : (input: CallInput<InputOf<C>>) => Promise<OutputOf<C, R>>

export type CommandModule<C, R> =
  & CommandFn<C, R>
  & { readonly args: ArgsType<HandlerInput<InputOf<C>>> }
  & (C extends { readonly commands: infer M } ? {
      readonly [K in keyof M]: M[K] extends Mounted ? M[K] : CommandModule<M[K], unknown>
    }
    : {})

export interface McpTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
  readonly outputSchema?: unknown
  readonly annotations?: Readonly<globalThis.Record<string, unknown>>
}

export interface McpProjection {
  readonly tools: ReadonlyArray<McpTool>
  serve(): Promise<void>
}

export type ProgramModule<RootIn, RootOut, RootR, Cs, Rs> =
  & CommandFn<
    RootOut extends undefined ? { readonly input: RootIn }
      : { readonly input: RootIn; readonly output: RootOut },
    RootR
  >
  & { readonly args: ArgsType<HandlerInput<RootIn>> }
  & {
    readonly [K in keyof Cs]: Cs[K] extends Mounted ? Cs[K]
      : CommandModule<Cs[K], K extends keyof Rs ? Rs[K] : unknown>
  }
  & Mounted
  & {
    /** the cli projection. bare `main()` is a complete bin entry: it reads
     * process argv, sets the process exit code, and disposes the module.
     * `main(argv)` is the programmatic form — parses the given tokens and
     * resolves the exit code with no process mutation and no disposal. */
    main(argv?: ReadonlyArray<string>): Promise<number>
    help(path?: ReadonlyArray<string>): string
    /** async because parameter completion may run a generator */
    complete(words: ReadonlyArray<string>): Promise<ReadonlyArray<string>>
    /** the declaration as pure data, functions stripped */
    readonly spec: unknown
    readonly mcp: McpProjection
    /** release the module's runtime resources */
    dispose(): Promise<void>
  }

export type ExternalModule<D extends ExternalDecl> =
  & Mounted
  & {
    readonly [K in keyof D["commands"]]: ExternalCommandModule<D["commands"][K]>
  }
  & {
    /** release the module's runtime resources */
    dispose(): Promise<void>
  }

export type ExternalCommandModule<C extends ExternalCommandDecl> =
  & CommandFn<C, string>
  & { readonly args: ArgsType<HandlerInput<InputOf<C>>> }
  & (C extends { readonly commands: infer M extends globalThis.Record<string, ExternalCommandDecl> }
    ? { readonly [K in keyof M]: ExternalCommandModule<M[K]> }
    : {})
