import type { distill, type } from "arktype"
import type { project, workspace } from "package-management"

// ─── declaration model ──────────────────────────────────────────────────────
// the consumer-authored data. parameters are ArkType property-position
// definitions; argv-specific config sits under `cli`, mcp-specific under
// `mcp`. see ideations/08-final.ts for the adopted contract.

export interface SuggestContext {
  exec(bin: string, args: ReadonlyArray<string>, options?: ExecOptions): Promise<ExecResult>
  readonly words: ReadonlyArray<string>
  /** repository resolution — package-management's `project(...)` verbatim:
   * `ctx.project("<package_folder>")` answers manifest, dependency, and
   * package-manager questions for the invocation's repository */
  readonly project: typeof project
  /** workspace enumeration — `ctx.workspace.packageNames()` is the
   * canonical monorepo completion source */
  readonly workspace: typeof workspace
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
   * "<...xs>" required variadic, "[...xs]" optional variadic,
   * "--flag, -f" flag with aliases. omitted ⇒ derived --kebab-case flag. */
  readonly usage?: string
  /** environment variable fallback (argv > env > default) */
  readonly env?: string
  /** drop this flag from help and completion; it still parses.
   * positionals cannot be cli-hidden — that would corrupt argv order. */
  readonly hidden?: boolean
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
  /** drop this parameter from the mcp tool schema; it still validates
   * if supplied (secrets and internals stay unadvertised to agents) */
  readonly mcp?: { readonly hidden?: boolean }
}

export type ParameterDef = string | ParameterDescriptor

export interface CliCommandConfig<Out = never> {
  readonly hidden?: boolean
  /** alternative subcommand names (`install` reachable as `i`); shown in
   * help, a sibling's real name always wins over an alias */
  readonly alias?: string | ReadonlyArray<string>
  /** for a command group: the child that runs when no subcommand is
   * named (`vite` ⇒ `vite dev`); remaining argv belongs to that child.
   * mutually exclusive with an own `run` */
  readonly default?: string
  /** override how this command's output prints for humans; `--json` and
   * agent surfaces are unaffected */
  readonly render?: (output: Out) => string
  /** full invocation lines rendered as an Examples section in help */
  readonly examples?: ReadonlyArray<string>
}

/** safety classification for a command, devframe's taxonomy: drives
 * MCP hint annotations (read → readOnlyHint, action → readOnlyHint
 * false, destructive → destructiveHint) and marks what automated
 * verification may invoke */
export type CommandSafety = "read" | "action" | "destructive"

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
  /** exit codes that count as success — any other exit throws
   * `ExternalExit`, the same vocabulary external commands use. omitted,
   * exit codes stay data on the result (branch on `result.exitCode`) */
  readonly successCodes?: ReadonlyArray<number>
  /** prepend the enclosing workspace's `node_modules/.bin` (resolved
   * upward from cwd, git root as the fallback) to PATH so
   * workspace-local binaries resolve regardless of how the process was
   * started (execa's preferLocal, tinyexec's default); a no-op outside
   * any repository */
  readonly preferLocal?: boolean
}

export type Surface = "cli" | "mcp" | "call"

/** a program-level resource: acquired before a handler runs, released
 * in reverse acquisition order after it settles — success or failure.
 * an acquire failure fails the invocation before the handler; a
 * release rejection surfaces as a defect. */
export interface ResourceSpec<T> {
  readonly acquire: () => T | Promise<T>
  readonly release: (resource: Awaited<T>) => void | Promise<void>
}

export type AcquiredResources<R> = {
  readonly [K in keyof R]: R[K] extends ResourceSpec<infer T> ? Awaited<T> : never
}

export interface WithResources<R> {
  readonly resources: AcquiredResources<R>
}

/** interpreter-owned capabilities handed to handlers. not user DI.
 * `project` and `workspace` are package-management's own consumer
 * surfaces, exposed whole — mediated here so handlers stay mockable
 * (hand a fake ctx) and auditable per invocation. */
export interface Ctx {
  exec(bin: string, args: ReadonlyArray<string>, options?: ExecOptions): Promise<ExecResult>
  readonly surface: Surface
  readonly project: typeof project
  readonly workspace: typeof workspace
  /** the program's acquired resources for this invocation; empty when
   * the declaration has none */
  readonly resources: Readonly<globalThis.Record<string, unknown>>
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

/** any notation carrying `...`: variadic positionals (`<...xs>`,
 * `[...xs]`) and repeatable flags (`--tag <tags...>`) */
type IsVariadic<P> = UsageOf<P> extends `${string}...${string}` ? true : false
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

/** program-level options (root input) join every command's handler and
 * call surface — the same model as an external's binary-global options */
export type CommandsOverlay<M, Rs, RIn = {}, Rsrc = {}> = {
  readonly [N in keyof Rs]: {
    readonly run?: (input: HandlerInput<RIn & InputOf<M[N & keyof M]>>, ctx: Ctx & WithResources<Rsrc>) => Rs[N]
    readonly narrow?: (input: HandlerInput<RIn & InputOf<M[N & keyof M]>>, ctx: NarrowContext) => boolean
    // typed from the declared output contract only — referencing Rs here
    // would make the reverse mapped type uninvertible and collapse
    // handler inference. a contract-less command renders `unknown`.
    readonly cli?: CliCommandConfig<OutputOf<M[N & keyof M], unknown>>
  }
}

export interface ProgramDeclOf<Name extends string, RootIn, RootOut, RootR, Cs, Rs, Rsrc = {}> {
  readonly name: Name
  readonly version?: string
  readonly description?: string
  /** program-level resources, acquired per invocation around every
   * handler of this program's own commands */
  readonly resources?: Rsrc
  readonly input?: RootIn
  readonly output?: RootOut
  readonly narrow?: (input: HandlerInput<NoInfer<RootIn>>, ctx: NarrowContext) => boolean
  readonly run?: (input: HandlerInput<NoInfer<RootIn>>, ctx: Ctx & WithResources<NoInfer<Rsrc>>) => RootR
  readonly commands?: CommandsData<Cs> & CommandsOverlay<NoInfer<Cs>, Rs, NoInfer<RootIn>, NoInfer<Rsrc>>
  // render typed from the declared root output, like command-level
  // render (contract-less roots render `unknown`)
  readonly cli?: CliCommandConfig<
    RootOut extends undefined ? unknown : OutputOf<{ readonly output: NoInfer<RootOut> }, unknown>
  >
  readonly mcp?: McpCommandConfig
}

export interface ExternalCommandDecl {
  readonly description?: string
  readonly input?: globalThis.Record<string, ParameterDef>
  /** ArkType definition applied to stdout on success */
  readonly output?: unknown
  /** exit codes that count as success (default [0]) — `git grep`'s
   * 1-means-no-match declares [0, 1]; anything else stays a failure */
  readonly successCodes?: ReadonlyArray<number>
  readonly safety?: CommandSafety
  readonly commands?: globalThis.Record<string, ExternalCommandDecl>
  readonly cli?: CliCommandConfig
  readonly mcp?: McpCommandConfig
}

export interface ExternalDecl {
  readonly name: string
  readonly description?: string
  /** binary to execute; defaults to `name` */
  readonly bin?: string
  /** the binary's GLOBAL options (git's `-C`, `--no-pager`): emitted
   * before the subcommand path and available on every command's call
   * surface. command-level input emits after the subcommand. */
  readonly input?: globalThis.Record<string, ParameterDef>
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

/** the typed functions ARE the program — they keep the handler's own
 * synchrony. a sync handler yields a sync function; only a handler that
 * returns a promise (async work, ctx.exec, externals) yields one. input
 * validation is eager and synchronous for every function (assert
 * semantics: invalid input throws, even from an async-typed function);
 * handler and output failures follow the handler's synchrony. */
type CommandResult<C, R> = [R] extends [Promise<unknown>] ? Promise<OutputOf<C, R>> : OutputOf<C, R>

/** the input argument is optional whenever every key is optional.
 * RIn: program-level options joining this command's call surface. */
export type CommandFn<C, R, RIn = {}> = {} extends CallInput<RIn & InputOf<C>>
  ? (input?: CallInput<RIn & InputOf<C>>) => CommandResult<C, R>
  : (input: CallInput<RIn & InputOf<C>>) => CommandResult<C, R>

export type CommandModule<C, R, RIn = {}> =
  & CommandFn<C, R, RIn>
  & { readonly args: ArgsType<HandlerInput<RIn & InputOf<C>>> }
  & (C extends { readonly commands: infer M } ? {
      readonly [K in keyof M]: M[K] extends Mounted ? M[K] : CommandModule<M[K], unknown, RIn>
    }
    : {})

/** one parameter in the machine-readable program spec */
export interface ParameterSpec {
  readonly key: string
  readonly kind: "flag" | "positional"
  /** cli grammar display: "--env, -e" or "<service>" */
  readonly usage: string
  readonly description?: string
  readonly required: boolean
  readonly variadic: boolean
  readonly boolean: boolean
  /** present only when defaulted; already evaluated through its morph
   * into the value domain */
  readonly defaultValue?: unknown
  readonly env?: string
  /** declared static candidate values — a prompt UI's choices */
  readonly suggestions?: ReadonlyArray<string>
  /** named filesystem source ("folders", "filepaths") */
  readonly suggestionSource?: string
  /** a Fig-style generator exists — dynamic, not serializable */
  readonly dynamicSuggestions?: boolean
  readonly hidden: { readonly cli: boolean; readonly mcp: boolean }
}

/** the compiled model as one JSON-serializable descriptor tree — the
 * machine-readable projection for doc generators, prompt UIs, and
 * install handshakes. `JSON.stringify(program.spec)` is a complete
 * self-description of the program. */
export interface CommandSpec {
  readonly path: ReadonlyArray<string>
  /** program version — present on the root node only; the install
   * handshake verifies identity with it */
  readonly version?: string
  readonly description: string
  readonly aliases: ReadonlyArray<string>
  readonly hidden: { readonly cli: boolean; readonly mcp: boolean }
  readonly examples: ReadonlyArray<string>
  /** the child (canonical name) that runs when this group is invoked
   * bare — user-facing behavior a reference must document */
  readonly defaultCommand?: string
  readonly runnable: boolean
  readonly external: boolean
  /** safety classification — automated verification may invoke only
   * `read` commands; drives MCP hint annotations */
  readonly safety?: CommandSafety
  /** external commands: exit codes that count as success — doc gen
   * explains a `git grep`-style exit 1 with this */
  readonly successCodes?: ReadonlyArray<number>
  /** documented JSON Schema of the input record */
  readonly inputSchema: unknown
  /** JSON Schema of the declared output contract, when representable */
  readonly outputSchema?: unknown
  readonly parameters: ReadonlyArray<ParameterSpec>
  readonly commands: ReadonlyArray<CommandSpec>
}

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

/** the cli projection: parse, route, run, render, resolve exit code.
 * bare `run()` is a complete cli-only bin entry — it reads process argv
 * and sets the process exit code; `run(argv)` is the programmatic form
 * with no process mutation. help and shell completion are cli machinery
 * and live here; the mcp server is a separate projection
 * (`module.mcp.serve()`), never dispatched through argv. */
export interface CliProjection {
  run(argv?: ReadonlyArray<string>): Promise<number>
  help(path?: ReadonlyArray<string>): string
  /** async because parameter completion may run a generator */
  complete(words: ReadonlyArray<string>): Promise<ReadonlyArray<string>>
  /** guided invocation: select a command, answer one typed prompt per
   * parameter (validated by the same token morphs the parser runs),
   * preview the equivalent command line, and dispatch it through the
   * ordinary cli path. `path` pre-selects a starting command. needs a
   * terminal — exits 1 without one, 130 when the user cancels. */
  interactive(path?: ReadonlyArray<string>): Promise<number>
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
      : CommandModule<Cs[K], K extends keyof Rs ? Rs[K] : unknown, RootIn>
  }
  & Mounted
  & {
    /** the composed bin: `main()` is a complete entry point — argv token
     * `mcp` at the head serves the mcp projection (that promise resolves
     * only when the server ends), anything else runs the cli projection,
     * and bare `main()` reads process argv and sets the process exit
     * code. a program whose own vocabulary needs the word `mcp` — or a
     * programmatic caller that must never serve — uses `cli.run()`. */
    main(argv?: ReadonlyArray<string>): Promise<number>
    readonly cli: CliProjection
    readonly mcp: McpProjection
    /** the machine-readable self-description (JSON-serializable) */
    readonly spec: CommandSpec
  }

/** per-invocation execution context for a wrapped binary — the
 * `fetch(url, init)` shape; never part of the declared input schema */
export type ExternalCallOptions = Pick<ExecOptions, "cwd" | "env" | "timeoutMs">

type ExternalIn<D> = D extends { readonly input: infer I } ? I : {}

/** an external always crosses a process boundary — inherently async.
 * global (root-level) parameters join every command's call surface. */
export type ExternalCommandFn<C, RIn> = {} extends CallInput<RIn & InputOf<C>>
  ? (input?: CallInput<RIn & InputOf<C>>, options?: ExternalCallOptions) => Promise<OutputOf<C, Promise<string>>>
  : (input: CallInput<RIn & InputOf<C>>, options?: ExternalCallOptions) => Promise<OutputOf<C, Promise<string>>>

export type ExternalModule<D extends ExternalDecl> =
  & Mounted
  & {
    readonly [K in keyof D["commands"]]: ExternalCommandModule<D["commands"][K], ExternalIn<D>>
  }

export type ExternalCommandModule<C extends ExternalCommandDecl, RIn = {}> =
  & ExternalCommandFn<C, RIn>
  & { readonly args: ArgsType<HandlerInput<RIn & InputOf<C>>> }
  & (C extends { readonly commands: infer M extends globalThis.Record<string, ExternalCommandDecl> }
    ? { readonly [K in keyof M]: ExternalCommandModule<M[K], RIn> }
    : {})
