import { NodeServices } from "@effect/platform-node"
import { Array, Context, Effect, Fiber, Layer, Stream } from "effect"
import { getPath, getWorkspaceFolder } from "package-management"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ExecFailure, ExternalExit } from "./errors.js"
import type { ExecOptions, ExecResult } from "./types.js"

const pathDelimiter = globalThis.process.platform === "win32" ? ";" : ":"

const collectText = (stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<string, unknown> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.mkString
  )

export class Exec extends Context.Service<Exec, {
  exec(
    bin: string,
    args: ReadonlyArray<string>,
    options?: ExecOptions
  ): Effect.Effect<ExecResult, ExecFailure | ExternalExit>
}>()("cmd-mesh/Exec") {
  static readonly layer = Layer.effect(
    Exec,
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const exec = Effect.fn("Exec.exec")(function*(
        bin: string,
        args: ReadonlyArray<string>,
        options?: ExecOptions
      ) {
        const inherit = options?.stdio === "inherit"
        const cwdOption = options?.cwd === undefined ? {} : { cwd: options.cwd }
        const workspace = options?.preferLocal === true
          ? getWorkspaceFolder({ ...cwdOption, throwIfNotFound: false })
          : undefined
        const env = workspace === undefined
          ? options?.env
          : {
            ...(options?.env ?? {}),
            PATH: [
              getPath({ to: "<workspace_folder>/node_modules/.bin", ...cwdOption }),
              options?.env?.PATH ?? globalThis.process.env.PATH ?? ""
            ].join(pathDelimiter)
          }
        const base = Effect.gen(function*() {
          const handle = yield* spawner.spawn(
            ChildProcess.make(bin, args, {
              ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(env === undefined ? {} : { env, extendEnv: true }),
              ...(inherit ? { stdin: "inherit", stdout: "inherit", stderr: "inherit" } : {})
            })
          )
          if (inherit) {
            const exitCode = yield* handle.exitCode
            return { stdout: "", stderr: "", exitCode: exitCode as number }
          }
          const stdout = yield* Effect.forkChild(collectText(handle.stdout))
          const stderr = yield* Effect.forkChild(collectText(handle.stderr))
          const exitCode = yield* handle.exitCode
          return {
            stdout: yield* Fiber.join(stdout),
            stderr: yield* Fiber.join(stderr),
            exitCode: exitCode as number
          }
        }).pipe(
          Effect.scoped,
          Effect.mapError((cause) => new ExecFailure({ bin, args, cause }))
        )
        // interruption closes the spawn scope, which kills the process
        const result = yield* options?.timeoutMs === undefined ? base : base.pipe(
          Effect.timeout(options.timeoutMs),
          Effect.catchTag(
            "TimeoutError",
            () => new ExecFailure({ bin, args, cause: `timed out after ${options.timeoutMs}ms` })
          )
        )
        // a declared success set makes any other exit a thrown failure —
        // the same vocabulary externals use. undeclared, exit codes stay
        // data on the result.
        if (
          options?.successCodes !== undefined
          && !Array.contains(options.successCodes, result.exitCode)
        ) {
          return yield* new ExternalExit({
            bin,
            args,
            exitCode: result.exitCode,
            stderr: result.stderr
          })
        }
        return result
      })

      return Exec.of({ exec })
    })
  ).pipe(Layer.provide(NodeServices.layer))
}
