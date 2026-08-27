import { type } from "arktype"
import { Array, Effect, Option, Predicate, String } from "effect"
import type { AnyType, CompiledCommand, CompiledParameter } from "./compile.js"
import { ExternalExit, HandlerFailure, InvalidInput, InvalidOutput, NoRunnableCommand } from "./errors.js"
import { Exec } from "./exec.js"
import type { Ctx } from "./types.js"

export type InvokeError = InvalidInput | InvalidOutput | HandlerFailure | NoRunnableCommand | ExternalExit

/** direct ArkType invocation lifted into the error channel */
export const parseWith = (
  t: AnyType,
  value: unknown,
  toError: (summary: string) => InvalidInput | InvalidOutput
): Effect.Effect<any, InvalidInput | InvalidOutput> =>
  Effect.suspend(() => {
    const result = t(value)
    return result instanceof type.errors
      ? Effect.fail(toError(result.summary))
      : Effect.succeed(result)
  })

const flagToken = (p: CompiledParameter): string =>
  p.binding._tag === "flag" ? p.binding.name : ""

const tokenOf = (value: unknown): string => Predicate.isObject(value) ? JSON.stringify(value) : `${value}`

/** value-taking flags reconstruct before the subcommand path — the position
 * binaries reserve for their global options (`git -C <dir> status`);
 * booleans and positionals follow the subcommand in declaration order */
const preSubcommandTokens = (
  parameters: ReadonlyArray<CompiledParameter>,
  parsed: Readonly<globalThis.Record<string, unknown>>
): ReadonlyArray<string> =>
  Array.flatMap(parameters, (p) => {
    const value = parsed[p.key]
    if (value === undefined || p.binding._tag !== "flag" || p.isBoolean) return []
    return [flagToken(p), tokenOf(value)]
  })

/** after the subcommand: boolean flags first (`git rev-parse --verify HEAD`
 * rejects the reverse), then positionals, declaration order within each.
 * a positional value that looks like a flag is argv injection into the
 * binary — fence positionals behind the end-of-options separator then */
const postSubcommandTokens = (
  parameters: ReadonlyArray<CompiledParameter>,
  parsed: Readonly<globalThis.Record<string, unknown>>
): ReadonlyArray<string> => {
  const positionals = Array.flatMap(parameters, (p) => {
    const value = parsed[p.key]
    if (value === undefined || p.binding._tag !== "positional") return []
    return p.binding.variadic
      ? Array.map(value as ReadonlyArray<unknown>, tokenOf)
      : [tokenOf(value)]
  })
  const fence = Array.some(positionals, String.startsWith("-")) ? ["--"] : []
  return Array.appendAll(
    Array.flatMap(parameters, (p) =>
      p.binding._tag === "flag" && p.isBoolean && parsed[p.key] === true ? [flagToken(p)] : []),
    Array.appendAll(fence, positionals)
  )
}

const runExternal = Effect.fn("cmd-mesh/runExternal")(function*(
  cmd: CompiledCommand,
  parsed: Readonly<globalThis.Record<string, unknown>>
) {
  const external = Option.getOrThrow(cmd.external)
  const exec = yield* Exec
  const args = Array.appendAll(
    preSubcommandTokens(cmd.parameters, parsed),
    Array.appendAll(external.argPath, postSubcommandTokens(cmd.parameters, parsed))
  )
  const result = yield* exec.exec(external.bin, args).pipe(
    Effect.mapError((cause) => new HandlerFailure({ path: cmd.path, cause }))
  )
  if (result.exitCode !== 0) {
    return yield* new ExternalExit({
      bin: external.bin,
      args,
      exitCode: result.exitCode,
      stderr: result.stderr
    })
  }
  return yield* Option.match(cmd.outputType, {
    onNone: () => Effect.succeed<unknown>(result.stdout),
    onSome: (out) =>
      parseWith(out, result.stdout, (summary) => new InvalidOutput({ path: cmd.path, summary }))
  })
})

const runHandler = Effect.fn("cmd-mesh/runHandler")(function*(
  cmd: CompiledCommand,
  parsed: Readonly<globalThis.Record<string, unknown>>,
  ctx: Ctx
) {
  const run = yield* Option.match(cmd.run, {
    onNone: () => Effect.fail(new NoRunnableCommand({ path: cmd.path })),
    onSome: Effect.succeed
  })
  const result = yield* Effect.tryPromise({
    try: async () => run(parsed, ctx),
    catch: (cause) => new HandlerFailure({ path: cmd.path, cause })
  })
  return yield* Option.match(cmd.outputType, {
    onNone: () => Effect.succeed<unknown>(result),
    onSome: (out) =>
      parseWith(out, result, (summary) => new InvalidOutput({ path: cmd.path, summary }))
  })
})

/** run an already-parsed input record through the command */
export const invokeParsed = (
  cmd: CompiledCommand,
  parsed: Readonly<globalThis.Record<string, unknown>>,
  ctx: Ctx
): Effect.Effect<unknown, InvokeError, Exec> =>
  cmd.kind === "external" && Option.isSome(cmd.external)
    ? runExternal(cmd, parsed)
    : runHandler(cmd, parsed, ctx)

/** the value-boundary path: direct calls and mcp tool calls */
export const invokeValues = (
  cmd: CompiledCommand,
  input: unknown,
  ctx: Ctx
): Effect.Effect<unknown, InvokeError, Exec> =>
  parseWith(
    cmd.valueType,
    input ?? {},
    (summary) => new InvalidInput({ path: cmd.path, summary })
  ).pipe(
    Effect.flatMap((parsed) => invokeParsed(cmd, parsed as globalThis.Record<string, unknown>, ctx))
  )
