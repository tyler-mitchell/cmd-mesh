import { Array, Console, Effect, ManagedRuntime, Match, Option, Record, String as StringModule, pipe } from "effect"
import { routeArgv, parseTokens } from "./argv.js"
import type { AnyType, CompiledCommand } from "./compile.js"
import { compileCommand, compileExternal } from "./compile.js"
import { bashScript, candidatesFor, generatorFor, zshScript } from "./completion.js"
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

/** static candidates plus the active parameter's generator, if any —
 * generator failures degrade to static candidates, never to an error */
const completeEffect = (
  runtime: MeshRuntime,
  compiled: CompiledCommand,
  words: ReadonlyArray<string>
): Effect.Effect<ReadonlyArray<string>, never, never> =>
  Effect.gen(function*() {
    const statics = candidatesFor(compiled, words)
    const dynamic = yield* Option.match(generatorFor(compiled, words), {
      onNone: () => Effect.succeed([] as ReadonlyArray<string>),
      onSome: (generator) =>
        Effect.tryPromise(async () => generator({ exec: makeCtx(runtime, "call").exec, words })).pipe(
          Effect.orElseSucceed(() => [] as ReadonlyArray<string>)
        )
    })
    const current = Option.getOrElse(Array.last(words), () => "")
    return pipe(
      Array.appendAll(statics, Array.filter(dynamic, StringModule.startsWith(current))),
      Array.dedupe
    )
  })

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
      Match.tag("mcp", () =>
        serveMcp(
          compiled,
          { name: compiled.name, version },
          (cmd, input, ctx) => invokeValues(cmd, input, ctx),
          (effect) => runtime.runPromise(effect),
          makeCtx(runtime, "mcp")
        )),
      Match.tag("complete", ({ words }) =>
        Effect.gen(function*() {
          const candidates = yield* completeEffect(runtime, compiled, words)
          if (candidates.length > 0) {
            yield* Console.log(Array.join(candidates, "\n"))
          }
          return 0
        })),
      Match.tag("completionScript", ({ shell }) =>
        Console.log(shell === "bash" ? bashScript(compiled.name) : zshScript(compiled.name)).pipe(
          Effect.as(0)
        )),
      Match.tag("run", ({ command, record, json }) =>
        isGroup(command)
          ? Console.log(renderHelp(command, { builtins: command === compiled })).pipe(Effect.as(0))
          : Effect.gen(function*() {
            const parsed = yield* parseTokens(command, record)
            const result = yield* invokeParsed(command, parsed, makeCtx(runtime, "cli"))
            // --json > per-command render override > default human rendering
            const text = json
              ? JSON.stringify(result, null, 2)
              : Option.match(command.cliRender, {
                onNone: () => renderResult(result),
                onSome: (render) => render(result)
              })
            yield* Console.log(text)
            return 0
          })),
      Match.exhaustive
    )
  }).pipe(
    Effect.catch((error) => Console.error(`${error}`).pipe(Effect.as(1)))
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
    runtime.runPromise(completeEffect(runtime, compiled, words))

  const helpFor = (path?: ReadonlyArray<string>): string =>
    pipe(
      path ?? [],
      Array.reduce(compiled, (cmd: CompiledCommand, word) =>
        pipe(
          Record.get(cmd.children, word),
          Option.getOrElse(() => cmd)
        )),
      (target) => renderHelp(target, { builtins: target === compiled })
    )

  return callableModule(
    (input?: unknown) => runtime.runPromise(invokeValues(compiled, input ?? {}, makeCtx(runtime, "call"))),
    {
      args: argsOf(compiled),
      ...Record.map(compiled.children, (child) => buildCommandModule(child, runtime)),
      main: (argv: ReadonlyArray<string>) => runtime.runPromise(runCli(runtime, compiled, version, argv)),
      help: helpFor,
      complete,
      spec: commandSpec(compiled),
      mcp: {
        tools: Array.map(collectTools(compiled), (t) => t.tool),
        serve: () =>
          runtime.runPromise(
            serveMcp(
              compiled,
              { name: compiled.name, version },
              (cmd, input, ctx) => invokeValues(cmd, input, ctx),
              (effect) => runtime.runPromise(effect),
              makeCtx(runtime, "mcp")
            )
          ) as Promise<void>
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
    [mounted]: compiled
  } as ExternalModule<D>
}
