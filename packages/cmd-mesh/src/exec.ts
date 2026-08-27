import { NodeServices } from "@effect/platform-node"
import { Context, Effect, Fiber, Layer, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ExecFailure } from "./errors.js"
import type { ExecOptions, ExecResult } from "./types.js"

const collectText = (stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<string, unknown> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.mkString
  )

export class Exec extends Context.Service<Exec, {
  exec(bin: string, args: ReadonlyArray<string>, options?: ExecOptions): Effect.Effect<ExecResult, ExecFailure>
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
        const base = Effect.gen(function*() {
          const handle = yield* spawner.spawn(
            ChildProcess.make(bin, args, {
              ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(options?.env === undefined ? {} : { env: options.env, extendEnv: true }),
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
        return yield* options?.timeoutMs === undefined ? base : base.pipe(
          Effect.timeout(options.timeoutMs),
          Effect.catchTag(
            "TimeoutError",
            () => new ExecFailure({ bin, args, cause: `timed out after ${options.timeoutMs}ms` })
          )
        )
      })

      return Exec.of({ exec })
    })
  ).pipe(Layer.provide(NodeServices.layer))
}
