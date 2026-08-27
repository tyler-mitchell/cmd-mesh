import { Array, Console, Effect, ManagedRuntime, Match, Option, Record, String as StringModule, pipe } from "effect"
import { routeArgv, parseTokens } from "./argv.js"
import type { AnyType, CompiledCommand } from "./compile.js"
import { compileCommand, compileExternal } from "./compile.js"
import { candidateValues, completionLines, completionScript, generatorFor } from "./completion.js"
import { Exec } from "./exec.js"
import { invokeParsed, invokeValues } from "./invoke.js"
import { collectTools, jsonSchemaOf, serveMcp } from "./mcp.js"
import { renderHelp, renderResult } from "./render.js"
import { commandSpec } from "./spec.js"
import type {
  Ctx,
  ExternalDecl,
  ExternalModule,
  ParameterDef,
  ProgramDeclOf,
  ProgramModule,
  Surface
} from "./types.js"
import { mounted } from "./types.js"

type MeshRuntime = ManagedRuntime.ManagedRuntime<Exec, never>

// the one sanctioned Object.assign seam in this package: a module IS a
// function carrying its subtree, and Effect has no callable-with-properties
// constructor. everything else uses Effect data modules.
const callableModule = (
  fn: (input?: unknown) => Promise<unknown>,
  props: globalThis.Record<string | symbol, unknown>
): any => Object.assign(fn, props)

const makeCtx = (runtime: MeshRuntime, surface: Surface): Ctx => ({
  surface,
  exec: (bin, args, options) => runtime.runPromise(Exec.use((s) => s.exec(bin, args, options)))
})

const argsOf = (cmd: CompiledCommand) => ({
  assert: (value: unknown) => (cmd.valueType as AnyType).assert(value),
  allows: (value: unknown) => (cmd.valueType as AnyType).allows(value),
  toJsonSchema: () => jsonSchemaOf(cmd.schemaType)
})

const buildCommandModule = (cmd: CompiledCommand, runtime: MeshRuntime): any =>
  callableModule(
    (input?: unknown) => runtime.runPromise(invokeValues(cmd, input ?? {}, makeCtx(runtime, "call"))),
    {
      args: argsOf(cmd),
      ...Record.map(cmd.children, (child) => buildCommandModule(child, runtime))
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
  words: ReadonlyArray<string>
): Effect.Effect<ReadonlyArray<string>, never, never> =>
  Effect.gen(function*() {
    const dynamic = yield* Option.match(generatorFor(compiled, words), {
      onNone: () => Effect.succeed([] as ReadonlyArray<string>),
      onSome: (generator) =>
        Effect.tryPromise(async () => generator({ exec: makeCtx(runtime, "call").exec, words })).pipe(
          Effect.orElseSucceed(() => [] as ReadonlyArray<string>)
        )
    })
    return completionLines(compiled, words, dynamic)
  })

const serveEffect = (
  runtime: MeshRuntime,
  compiled: CompiledCommand,
  version: string
): Effect.Effect<never, Error> =>
  serveMcp(
    compiled,
    { name: compiled.name, version },
    (cmd, input, ctx) => invokeValues(cmd, input, ctx),
    (effect) => runtime.runPromise(effect),
    makeCtx(runtime, "mcp")
  )

const runCli = (
  runtime: MeshRuntime,
  compiled: CompiledCommand,
  version: string,
  argv: ReadonlyArray<string>
): Effect.Effect<number, never, Exec> =>
  Effect.gen(function*() {
    const routed = yield* routeArgv(compiled, argv)
    return yield* Match.value(routed).pipe(
      Match.tag("help", ({ command }) =>
        Console.log(renderHelp(command, { builtins: command === compiled })).pipe(Effect.as(0))),
      Match.tag("version", () => Console.log(version).pipe(Effect.as(0))),
      Match.tag("mcp", () => serveEffect(runtime, compiled, version)),
      Match.tag("complete", ({ words }) =>
        Effect.gen(function*() {
          const lines = yield* completeEffect(runtime, compiled, words)
          if (lines.length > 0) {
            yield* Console.log(Array.join(lines, "\n"))
          }
          return 0
        })),
      // tab prints the script itself; an unsupported shell throws and
      // resolves through the error path as exit 1
      Match.tag("completionScript", ({ shell }) =>
        Effect.try({
          try: () => completionScript(compiled, shell),
          catch: () => new Error(`unsupported shell: ${shell} (zsh, bash, fish, powershell)`)
        }).pipe(Effect.as(0))),
      Match.tag("run", ({ command, record, json }) =>
        isGroup(command)
          ? Console.log(renderHelp(command, { builtins: command === compiled })).pipe(Effect.as(0))
          : Effect.gen(function*() {
            const parsed = yield* parseTokens(command, record)
            const result = yield* invokeParsed(command, parsed, makeCtx(runtime, "cli"))
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
    Effect.catch((error) => Console.error(`${error}`).pipe(Effect.as(1))),
    // a throwing render hook or narrow lands here as a defect; the cli
    // contract is an exit code, never a rejected promise
    Effect.catchDefect((defect: unknown) => Console.error(`${defect}`).pipe(Effect.as(1)))
  )

/** interpret a program declaration into its callable module */
export const program = <
  const Name extends string,
  const RootIn extends globalThis.Record<string, ParameterDef> = {},
  const RootOut = undefined,
  RootR = void,
  const Cs = {},
  Rs = {}
>(
  def: ProgramDeclOf<Name, RootIn, RootOut, RootR, Cs, Rs>
): ProgramModule<RootIn, RootOut, RootR, Cs, Rs> => {
  const compiled = compileCommand(def.name, [def.name], def as never)
  const runtime: MeshRuntime = ManagedRuntime.make(Exec.layer)
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
            Record.get(state.cmd.children, word),
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
    (input?: unknown) => runtime.runPromise(invokeValues(compiled, input ?? {}, makeCtx(runtime, "call"))),
    {
      args: argsOf(compiled),
      ...Record.map(compiled.children, (child) => buildCommandModule(child, runtime)),
      // bare main() is the whole bin: process argv, exit code, disposal.
      // explicit argv is the programmatic form — pure in, code out.
      main: (argv?: ReadonlyArray<string>) =>
        argv === undefined
          ? runtime.runPromise(
            runCli(runtime, compiled, version, Array.drop(globalThis.process.argv, 2)).pipe(
              Effect.tap((code) => Effect.sync(() => {
                globalThis.process.exitCode = code
              }))
            )
          ).then(async (code) => {
            await runtime.dispose()
            return code
          })
          : runtime.runPromise(runCli(runtime, compiled, version, argv)),
      help: helpFor,
      complete,
      spec: commandSpec(compiled),
      mcp: {
        tools: Array.map(collectTools(compiled), (t) => t.tool),
        serve: () => runtime.runPromise(serveEffect(runtime, compiled, version)) as Promise<void>
      },
      dispose: () => runtime.dispose(),
      [mounted]: compiled
    }
  )
}

/** interpret an external-binary declaration into its callable module */
export const external = <const D extends ExternalDecl>(def: D): ExternalModule<D> => {
  const compiled = compileExternal(def)
  const runtime: MeshRuntime = ManagedRuntime.make(Exec.layer)
  return {
    ...Record.map(compiled.children, (child) => buildCommandModule(child, runtime)),
    dispose: () => runtime.dispose(),
    [mounted]: compiled
  } as ExternalModule<D>
}
