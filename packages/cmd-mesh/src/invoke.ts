import { type } from "arktype"
import { Array, Effect, Option, Predicate, Record, String } from "effect"
import type { AnyType, CompiledCommand, CompiledParameter } from "./compile.js"
import { ExternalExit, HandlerFailure, InvalidInput, InvalidOutput, NoRunnableCommand } from "./errors.js"
import { Exec } from "./exec.js"
import type { Ctx, ExternalCallOptions, ResourceSpec } from "./types.js"

export type InvokeError = InvalidInput | InvalidOutput | HandlerFailure | NoRunnableCommand | ExternalExit

/** acquire the program's resources, hand them to the invocation, and
 * release in reverse order after it settles — the handler's failure
 * included. an acquire failure fails the invocation before the handler;
 * a release rejection is a defect. */
export const withResources = <A, E, R>(
  path: ReadonlyArray<string>,
  specs: Readonly<globalThis.Record<string, ResourceSpec<unknown>>>,
  use: (resources: Readonly<globalThis.Record<string, unknown>>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | HandlerFailure, R> =>
  Record.isEmptyRecord(specs as globalThis.Record<string, ResourceSpec<unknown>>)
    ? use({})
    : Effect.scoped(
      Effect.forEach(Record.toEntries(specs), ([key, spec]) =>
        Effect.acquireRelease(
          Effect.tryPromise({
            try: async () => spec.acquire(),
            catch: (cause) => new HandlerFailure({ path, cause })
          }),
          (value) => Effect.promise(async () => { await spec.release(value) })
        ).pipe(Effect.map((value) => [key, value] as const))).pipe(
          Effect.flatMap((entries) => use(Record.fromEntries(entries)))
        )
    )

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

/** one parameter's argv tokens: a set boolean is its bare flag, a valued
 * flag is flag + token, a repeatable flag repeats per value — the only
 * repetition convention binaries actually speak */
const flagTokens = (
  p: CompiledParameter,
  value: unknown
): ReadonlyArray<string> => {
  if (p.isBoolean) return value === true ? [flagToken(p)] : []
  if (p.binding._tag === "flag" && p.binding.variadic) {
    return Array.flatMap(value as ReadonlyArray<unknown>, (v) => [flagToken(p), tokenOf(v)])
  }
  return [flagToken(p), tokenOf(value)]
}

/** placement follows declaration level: global (root-declared) options
 * precede the subcommand path — the position binaries reserve for them
 * (`git -C <dir> log`) — and the command's own flags then positionals
 * follow it (`git log -n 2 <path>`). a positional value that looks like
 * a flag is argv injection into the binary; fence positionals behind the
 * end-of-options separator then. */
const externalArgs = (
  argPath: ReadonlyArray<string>,
  parameters: ReadonlyArray<CompiledParameter>,
  parsed: Readonly<globalThis.Record<string, unknown>>
): ReadonlyArray<string> => {
  const set = Array.filter(parameters, (p) => parsed[p.key] !== undefined)
  const globals = Array.flatMap(set, (p) =>
    p.global && p.binding._tag === "flag" ? flagTokens(p, parsed[p.key]) : [])
  const ownFlags = Array.flatMap(set, (p) =>
    !p.global && p.binding._tag === "flag" ? flagTokens(p, parsed[p.key]) : [])
  const positionals = Array.flatMap(set, (p) => {
    if (p.binding._tag !== "positional") return []
    const value = parsed[p.key]
    return p.binding.variadic
      ? Array.map(value as ReadonlyArray<unknown>, tokenOf)
      : [tokenOf(value)]
  })
  const fence = Array.some(positionals, String.startsWith("-")) ? ["--"] : []
  return Array.flatten([globals, argPath, ownFlags, fence, positionals])
}

const runExternal = Effect.fn("cmd-mesh/runExternal")(function*(
  cmd: CompiledCommand,
  parsed: Readonly<globalThis.Record<string, unknown>>,
  options?: ExternalCallOptions
) {
  const external = Option.getOrThrow(cmd.external)
  const exec = yield* Exec
  const args = externalArgs(external.argPath, cmd.parameters, parsed)
  const result = yield* exec.exec(external.bin, args, options).pipe(
    Effect.mapError((cause) => new HandlerFailure({ path: cmd.path, cause }))
  )
  if (!Array.contains(external.successCodes, result.exitCode)) {
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
  // the handler's own synchrony is the contract: a sync handler keeps the
  // whole invocation sync, so only a returned promise crosses into async
  const raw = yield* Effect.try({
    try: () => run(parsed, ctx),
    catch: (cause) => new HandlerFailure({ path: cmd.path, cause })
  })
  const result = Predicate.isPromise(raw)
    ? yield* Effect.tryPromise({
      try: async () => raw,
      catch: (cause) => new HandlerFailure({ path: cmd.path, cause })
    })
    : raw
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
  ctx: Ctx,
  options?: ExternalCallOptions
): Effect.Effect<unknown, InvokeError, Exec> =>
  cmd.kind === "external" && Option.isSome(cmd.external)
    ? runExternal(cmd, parsed, options)
    : runHandler(cmd, parsed, ctx)

/** the value-boundary path: direct calls and mcp tool calls */
export const invokeValues = (
  cmd: CompiledCommand,
  input: unknown,
  ctx: Ctx,
  options?: ExternalCallOptions
): Effect.Effect<unknown, InvokeError, Exec> =>
  parseWith(
    cmd.valueType,
    input ?? {},
    (summary) => new InvalidInput({ path: cmd.path, summary })
  ).pipe(
    Effect.flatMap((parsed) =>
      invokeParsed(cmd, parsed as globalThis.Record<string, unknown>, ctx, options)
    )
  )
