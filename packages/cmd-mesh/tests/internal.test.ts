import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { parseTokens, routeArgv } from "../src/argv.js"
import { compileCommand } from "../src/compile.js"
import { Exec } from "../src/exec.js"

// effect-level tests of the interpreter internals.

const root = compileCommand("tool", ["tool"], {
  commands: {
    greet: {
      description: "greet someone",
      input: {
        who: { type: "string", cli: "<who>" },
        shout: { type: "boolean", cli: "--shout, -s" },
        times: { type: "string.integer.parse = '1'" }
      },
      run: () => "hi"
    }
  }
} as never)

describe("argv routing", () => {
  it.effect("routes and scans tokens into a record", () =>
    Effect.gen(function*() {
      const routed = yield* routeArgv(root, ["greet", "ada", "--shout", "--times", "3"])
      assert.strictEqual(routed._tag, "run")
      if (routed._tag === "run") {
        assert.deepStrictEqual(routed.record, { who: "ada", shout: true, times: "3" })
        const parsed = yield* parseTokens(routed.command, routed.record)
        assert.deepStrictEqual(parsed, { who: "ada", shout: true, times: 3 })
      }
    }))

  it.effect("supports --flag=value, negation, and --", () =>
    Effect.gen(function*() {
      const routed = yield* routeArgv(root, ["greet", "--times=2", "--no-shout", "--", "ada"])
      assert.strictEqual(routed._tag, "run")
      if (routed._tag === "run") {
        assert.deepStrictEqual(routed.record, { who: "ada", shout: false, times: "2" })
      }
    }))

  it.effect("fails typed on unknown flags", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(routeArgv(root, ["greet", "ada", "--wat"]))
      assert.strictEqual(error._tag, "UnknownFlag")
    }))

  it.effect("fails typed on unknown subcommands", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(routeArgv(root, ["nope"]))
      assert.strictEqual(error._tag, "CommandNotFound")
    }))

  it.effect("fails typed when a value-taking flag has no value", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(routeArgv(root, ["greet", "ada", "--times"]))
      assert.strictEqual(error._tag, "MissingFlagValue")
    }))

  it.effect("applies token morphs and rejects bad tokens", () =>
    Effect.gen(function*() {
      const routed = yield* routeArgv(root, ["greet", "ada", "--times", "zzz"])
      assert.strictEqual(routed._tag, "run")
      if (routed._tag === "run") {
        const error = yield* Effect.flip(parseTokens(routed.command, routed.record))
        assert.strictEqual(error._tag, "InvalidInput")
      }
    }))
})

describe("Exec service", () => {
  it.effect("collects stdout, stderr, and exit code", () =>
    Effect.gen(function*() {
      const exec = yield* Exec
      const result = yield* exec.exec("printf", ["hello"])
      assert.strictEqual(result.stdout, "hello")
      assert.strictEqual(result.exitCode, 0)
    }).pipe(Effect.provide(Exec.layer)))

  it.effect("fails typed when the binary does not exist", () =>
    Effect.gen(function*() {
      const exec = yield* Exec
      const error = yield* Effect.flip(exec.exec("definitely-not-a-binary-xyz", []))
      assert.strictEqual(error._tag, "ExecFailure")
    }).pipe(Effect.provide(Exec.layer)))
})
