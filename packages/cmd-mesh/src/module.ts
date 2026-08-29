import {
  Array,
  Cause,
  Console,
  Effect,
  Exit,
  Fiber,
  ManagedRuntime,
  Match,
  Option,
  Record,
  String as StringModule,
  pipe
} from "effect"
import { childFor, routeArgv, parseTokens } from "./argv.js"
import { InvalidInput } from "./errors.js"
import type { AnyType, CompiledCommand } from "./compile.js"
import { compileCommand, compileExternal } from "./compile.js"
import {
  candidateValues,
  canonicalWords,
  completionLines,
  completionScript,
  generatorFor
} from "./completion.js"
import { Exec } from "./exec.js"
import { promptArgv } from "./interactive.js"
import { invokeParsed, invokeValues, withResources } from "./invoke.js"
import { buildMcpServer, collectTools, inputSchema, serveMcp } from "./mcp.js"
import { Predicate } from "effect"
import { renderHelp, renderResult, usageLine } from "./render.js"
import { project, workspace } from "package-management"
import { deepFrozen, specOf } from "./spec.js"
import type {
  Ctx,
  ExternalCallOptions,
  ExternalDecl,
  ExternalModule,
  ProgramDeclOf,
  ProgramModule,
  ResourceSpec,
  Surface
} from "./types.js"
import { mounted } from "./types.js"

type MeshRuntime = ManagedRuntime.ManagedRuntime<Exec, never>

type Resources = Readonly<globalThis.Record<string, ResourceSpec<unknown>>>

// the one sanctioned Object.assign seam in this package: a module IS a
// function carrying its subtree, and Effect has no callable-with-properties
// constructor. everything else uses Effect data modules.
const callableModule = (
  fn: (input?: never) => unknown,
  props: globalThis.Record<string | symbol, unknown>
): any => Object.assign(fn, props)

const makeCtx = (
  runtime: MeshRuntime,
  surface: Surface,
  resources: Readonly<globalThis.Record<string, unknown>> = {}
): Ctx => ({
  surface,
  exec: (bin, args, options) => runtime.runPromise(Exec.use((s) => s.exec(bin, args, options))),
  // the library functions themselves — nothing constructed until called
  project,
  workspace,
  resources
})

/** run an invocation preserving the handler's synchrony: a fiber that
 * completed in the same tick unwraps to a plain value (or throw), one
 * still running hands back its promise — the value never runs twice */
const runAuto = (runtime: MeshRuntime, effect: Effect.Effect<unknown, unknown, Exec>): unknown => {
  const fiber = runtime.runFork(effect)
  const exit = fiber.pollUnsafe()
  if (exit === undefined) return runtime.runPromise(Fiber.join(fiber))
  if (Exit.isSuccess(exit)) return exit.value
  throw Cause.squash(exit.cause)
}

/** run an effect as a promise that an AbortSignal can cancel: abort
 * interrupts the fiber, and interruption closes its scope — which kills
 * any child process the invocation spawned. the seam between the sdk's
 * cancellation model and Effect's. */
export const runAbortable = <A>(
  runtime: MeshRuntime,
  effect: Effect.Effect<A, unknown, Exec>,
  signal?: AbortSignal
): Promise<A> => {
  if (signal === undefined) return runtime.runPromise(effect)
  const fiber = runtime.runFork(effect)
  const abort = () => fiber.interruptUnsafe()
  signal.addEventListener("abort", abort, { once: true })
  return runtime.runPromise(Fiber.join(fiber)).finally(() => {
    signal.removeEventListener("abort", abort)
  })
}

/** the basename the process was invoked as, when one exists */
const invokedBinName = (): string | undefined =>
  pipe(
    Option.fromNullishOr(globalThis.process.argv[1]),
    Option.flatMap((entry) => Array.last(StringModule.split(/[\\/]/)(entry))),
    Option.filter(StringModule.isNonEmpty),
    Option.getOrUndefined
  )

/** a bin entry owns the process exit code; the programmatic forms don't */
const asBin = (run: Promise<number>): Promise<number> =>
  run.then((code) => {
    globalThis.process.exitCode = code
    return code
  })

const argsOf = (cmd: CompiledCommand) => ({
  // one error vocabulary on every surface: assert throws the exported
  // InvalidInput, never ArkType's own TraversalError
  assert: (value: unknown) =>
    Effect.runSync(
      Effect.try({
        try: () => (cmd.valueType as AnyType).assert(value),
        catch: (cause) =>
          new InvalidInput({
            path: cmd.path,
            summary: Predicate.hasProperty(cause, "message") ? `${cause.message}` : `${cause}`
          })
      })
    ),
  allows: (value: unknown) => (cmd.valueType as AnyType).allows(value),
  toJsonSchema: () => inputSchema(cmd)
})

const buildCommandModule = (
  cmd: CompiledCommand,
  runtime: MeshRuntime,
  specs: Resources = {}
): any =>
  callableModule(
    // the second argument is external-only execution context (cwd, env,
    // timeout); program commands ignore it by construction
    (input?: unknown, options?: ExternalCallOptions) =>
      runAuto(
        runtime,
        withResources(cmd.path, specs, (resources) =>
          invokeValues(cmd, input ?? {}, makeCtx(runtime, "call", resources), options))
      ),
    {
      args: argsOf(cmd),
      ...Record.map(cmd.children, (child) => buildCommandModule(child, runtime, specs))
    }
  )

const isGroup = (cmd: CompiledCommand): boolean =>
  Option.isNone(cmd.run) && Option.isNone(cmd.external) && !Record.isEmptyRecord(cmd.children)

/** the tab protocol lines for a word list. an async generator on the
 * active parameter resolves first — tab handlers are synchronous — and
 * generator failures degrade to static candidates, never to an error */
const completeEffect = (
  runtime: MeshRuntime,
  compiled: CompiledCommand,
  rawWords: ReadonlyArray<string>
): Effect.Effect<ReadonlyArray<string>, never, never> =>
  Effect.gen(function*() {
    // generators receive the canonical word list — alias tokens
    // rewritten to real names, the vocabulary their authors match on
    const words = canonicalWords(compiled, rawWords)
    const dynamic = yield* Option.match(generatorFor(compiled, words), {
      onNone: () => Effect.succeed([] as ReadonlyArray<string>),
      onSome: (generator) =>
        Effect.tryPromise(async () =>
          generator({ exec: makeCtx(runtime, "call").exec, words, project, workspace })
        ).pipe(
          Effect.orElseSucceed(() => [] as ReadonlyArray<string>)
        )
    })
    return completionLines(compiled, words, dynamic)
  })

const serveEffect = (
  runtime: MeshRuntime,
  compiled: CompiledCommand,
  version: string,
  specs: Resources
): Effect.Effect<never, Error> =>
  serveMcp(
    compiled,
    { name: compiled.name, version },
    (cmd, input, ctx) =>
      withResources(cmd.path, specs, (resources) => invokeValues(cmd, input, { ...ctx, resources })),
    (effect, signal) => runAbortable(runtime, effect, signal),
    makeCtx(runtime, "mcp"),
    deepFrozen(specOf(compiled, version))
  )

const runCli = (
  runtime: MeshRuntime,
  compiled: CompiledCommand,
  version: string,
  specs: Resources,
  argv: ReadonlyArray<string>,
  binName?: string
): Effect.Effect<number, never, Exec> =>
  Effect.gen(function*() {
    const routed = yield* routeArgv(compiled, argv)
    return yield* Match.value(routed).pipe(
      Match.tag("help", ({ command }) =>
        Console.log(renderHelp(command, { builtins: command === compiled })).pipe(Effect.as(0))),
      Match.tag("version", () => Console.log(version).pipe(Effect.as(0))),
      Match.tag("complete", ({ words }) =>
        Effect.gen(function*() {
          const lines = yield* completeEffect(runtime, compiled, words)
          if (lines.length > 0) {
            yield* Console.log(Array.join(lines, "\n"))
          }
          return 0
        })),
      // tab prints the script itself; an unsupported shell throws and
      // resolves through the error path as exit 1. the script targets
      // the bin name the process was invoked as, since an installed bin
      // may alias the program's declared name.
      Match.tag("completionScript", ({ shell }) =>
        Effect.try({
          try: () => completionScript(compiled, shell, binName),
          catch: () => new Error(`unsupported shell: ${shell} (zsh, bash, fish, powershell)`)
        }).pipe(Effect.as(0))),
      Match.tag("run", ({ command, record, json }) =>
        isGroup(command)
          ? Console.log(renderHelp(command, { builtins: command === compiled })).pipe(Effect.as(0))
          : Effect.gen(function*() {
            const parsed = yield* parseTokens(command, record)
            const result = yield* withResources(command.path, specs, (resources) =>
              invokeParsed(command, parsed, makeCtx(runtime, "cli", resources)))
            // --json > per-command render override > default human rendering
            const text = json
              ? JSON.stringify(result, null, 2) ?? ""
              : Option.match(command.cliRender, {
                onNone: () => renderResult(result),
                onSome: (render) => `${render(result)}`
              })
            if (StringModule.isNonEmpty(text)) {
              yield* Console.log(text)
            }
            return 0
          })),
      Match.exhaustive
    )
  }).pipe(
    // humans get each error's curated message, never the internal tag;
    // usage errors exit 2 (the getopt convention) and teach the fix with
    // the routed command's usage line; runtime failures exit 1 bare
    Effect.catch((error) => {
      const code = usageCode(error)
      const text = code === 2
        ? `${errorText(error)}${usageHint(compiled, error)}`
        : errorText(error)
      return Console.error(text).pipe(Effect.as(code))
    }),
    // a throwing render hook lands here as a defect; the cli contract is
    // an exit code, never a rejected promise
    Effect.catchDefect((defect: unknown) => Console.error(`${defect}`).pipe(Effect.as(1)))
  )

const USAGE_TAGS = [
  "CommandNotFound",
  "UnknownFlag",
  "MissingFlagValue",
  "UnexpectedArgument",
  "InvalidInput"
] as const

/** every usage error carries the routed command path — resolve it back
 * to the compiled node (unknown words stay at the deepest match) */
const usageHint = (root: CompiledCommand, error: unknown): string => {
  if (!Predicate.hasProperty(error, "path") || !globalThis.Array.isArray(error.path)) return ""
  const cmd = pipe(
    Array.drop(error.path as ReadonlyArray<string>, 1),
    Array.reduce(root, (at, word) => Option.getOrElse(Record.get(at.children, word), () => at))
  )
  return `\n\nUsage: ${usageLine(cmd)}\nTry "${Array.join(cmd.path, " ")} --help" for details.`
}

/** a handler may throw an error carrying a numeric `exitCode` — the
 * diff/grep convention where a nonzero exit is a report, not a failure.
 * that code owns the cli exit and the message prints bare. */
const carriedExit = (error: unknown): Option.Option<{ code: number; message: string }> =>
  Predicate.hasProperty(error, "_tag") && error._tag === "HandlerFailure"
    && Predicate.hasProperty(error, "cause")
    && Predicate.hasProperty(error.cause, "exitCode")
    && Predicate.isNumber(error.cause.exitCode)
    ? Option.some({
      code: error.cause.exitCode,
      message: Predicate.hasProperty(error.cause, "message") ? `${error.cause.message}` : `${error.cause}`
    })
    : Option.none()

const usageCode = (error: unknown): number =>
  Option.match(carriedExit(error), {
    onSome: ({ code }) => code,
    onNone: () =>
      Predicate.hasProperty(error, "_tag") && Array.contains(USAGE_TAGS, error._tag as string)
        ? 2
        : 1
  })

const errorText = (error: unknown): string =>
  Option.match(carriedExit(error), {
    onSome: ({ message }) => message,
    onNone: () =>
      Predicate.hasProperty(error, "message") && StringModule.isString(error.message)
        ? error.message
        : `${error}`
  })

/** interpret a program declaration into its callable module */
export const program = <
  const Name extends string,
  const RootIn extends object = {},
  const RootOut = undefined,
  RootR = void,
  const Cs = {},
  Rs = {},
  const Rsrc extends Readonly<globalThis.Record<string, ResourceSpec<any>>> = {},
  // the result is deferred through a type parameter, as ArkType's own
  // `type` does: computing it in the return position instantiates eagerly
  r = ProgramModule<RootIn, RootOut, RootR, Cs, Rs>
>(
  def: ProgramDeclOf<Name, RootIn, RootOut, RootR, Cs, Rs, Rsrc>
): r extends infer _ ? _ : never => {
  const compiled = compileCommand(def.name, [def.name], def as never)
  const specs: Resources = def.resources ?? {}
  const runtime: MeshRuntime = ManagedRuntime.make(Exec.layer)
  // the layer is sync; building it eagerly keeps the first typed call as
  // synchronous as every later one
  runtime.runSyncExit(Effect.void)
  const version = (def as { readonly version?: string }).version ?? "0.0.0"

  const complete = (words: ReadonlyArray<string>): Promise<ReadonlyArray<string>> =>
    runtime.runPromise(completeEffect(runtime, compiled, words).pipe(Effect.map(candidateValues)))

  const helpFor = (path?: ReadonlyArray<string>): string =>
    pipe(
      path ?? [],
      Array.reduce(
        { cmd: compiled, missing: Option.none<string>() },
        (state, word) =>
          Option.isSome(state.missing) ? state : pipe(
            // alias-aware, like the parser: help(["ws"]) is workspace help
            childFor(state.cmd, word),
            Option.match({
              onNone: () => ({ ...state, missing: Option.some(word) }),
              onSome: (child) => ({ cmd: child, missing: Option.none<string>() })
            })
          )
      ),
      ({ cmd, missing }) =>
        Option.match(missing, {
          onNone: () => renderHelp(cmd, { builtins: cmd === compiled }),
          onSome: (word) =>
            `unknown command: ${word}\n\n${renderHelp(cmd, { builtins: cmd === compiled })}`
        })
    )

  return callableModule(
    (input?: unknown) =>
      runAuto(
        runtime,
        withResources(compiled.path, specs, (resources) =>
          invokeValues(compiled, input ?? {}, makeCtx(runtime, "call", resources)))
      ),
    {
      args: argsOf(compiled),
      ...Record.map(compiled.children, (child) => buildCommandModule(child, runtime, specs)),
      // main() is the composed bin: the head token `mcp` serves the mcp
      // projection, everything else is the cli projection. the projections
      // themselves stay separate — this is the one named composition point,
      // and like every bin path it resolves an exit code, never rejects.
      main: (argv?: ReadonlyArray<string>) => {
        const tokens = argv ?? Array.drop(globalThis.process.argv, 2)
        // `mcp` alone serves; `mcp <anything>` is a typo'd host config —
        // serving forever on it would hide the mistake
        const run = Array.head(tokens).pipe(Option.contains("mcp"))
          ? tokens.length > 1
            ? runtime.runPromise(
              Console.error(
                `mcp takes no further arguments (got: ${Array.join(Array.drop(tokens, 1), " ")})`
              ).pipe(Effect.as(2))
            )
            : runtime.runPromise(
              serveEffect(runtime, compiled, version, specs).pipe(
                Effect.as(0),
                Effect.catch((error) => Console.error(`${error}`).pipe(Effect.as(1)))
              )
            )
          : runtime.runPromise(
            runCli(runtime, compiled, version, specs, tokens, argv === undefined ? invokedBinName() : undefined)
          )
        return argv === undefined ? asBin(run) : run
      },
      // the cli projection: run is the verb (bare run() is a complete
      // cli-only bin — process argv and exit code; run(argv) the pure
      // programmatic form), help and completion are its machinery
      cli: {
        run: (argv?: ReadonlyArray<string>) => {
          const run = runtime.runPromise(
            runCli(
              runtime,
              compiled,
              version,
              specs,
              argv ?? Array.drop(globalThis.process.argv, 2),
              argv === undefined ? invokedBinName() : undefined
            )
          )
          return argv === undefined ? asBin(run) : run
        },
        help: helpFor,
        complete,
        // guided invocation assembles argv; runCli stays the one owner
        // of parsing, dispatch, rendering, and exit codes
        interactive: (path?: ReadonlyArray<string>) =>
          globalThis.process.stdin.isTTY !== true
            ? runtime.runPromise(
              Console.error(
                "interactive mode needs a terminal — pass arguments instead"
              ).pipe(Effect.as(1))
            )
            : runtime.runPromise(
              promptArgv(
                compiled,
                (words) => ({ exec: makeCtx(runtime, "cli").exec, words, project, workspace }),
                path ?? []
              ).pipe(
                Effect.flatMap((argv) => runCli(runtime, compiled, version, specs, argv)),
                Effect.catchTag("PromptCancelled", () => Effect.succeed(130))
              )
            )
      },
      mcp: {
        tools: deepFrozen(Array.map(collectTools(compiled), (t) => t.tool)),
        serve: () => runtime.runPromise(Effect.asVoid(serveEffect(runtime, compiled, version, specs))),
        server: () =>
          buildMcpServer(
            compiled,
            { name: compiled.name, version },
            (cmd, input, ctx) =>
              withResources(cmd.path, specs, (resources) => invokeValues(cmd, input, { ...ctx, resources })),
            (effect, signal) => runAbortable(runtime, effect, signal),
            makeCtx(runtime, "mcp"),
            deepFrozen(specOf(compiled, version))
          )
      },
      spec: deepFrozen(specOf(compiled, version)),
      [mounted]: compiled
    }
  )
}

/** interpret an external-binary declaration into its callable module */
export const external = <const D extends ExternalDecl, r = ExternalModule<D>>(
  def: D
): r extends infer _ ? _ : never => {
  const compiled = compileExternal(def)
  const runtime: MeshRuntime = ManagedRuntime.make(Exec.layer)
  return {
    ...Record.map(compiled.children, (child) => buildCommandModule(child, runtime)),
    [mounted]: compiled
  } as never
}
