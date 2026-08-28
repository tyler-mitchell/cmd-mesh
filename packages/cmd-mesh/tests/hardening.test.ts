import { assert, describe, it } from "@effect/vitest"
import { expect, it as vit } from "vitest"
import { Effect } from "effect"
import { compileCommand } from "../src/compile.js"
import { InvalidDeclaration } from "../src/errors.js"
import { Exec } from "../src/exec.js"
import { renderHelp } from "../src/render.js"

// the production-hardening layer: declaration validation, exec modes, help.

describe("declaration validation", () => {
  vit("aggregates every problem with command/parameter paths", () => {
    expect(() =>
      compileCommand("tool", ["tool"], {
        commands: {
          broken: {
            input: {
              bad: { type: "not.a.keyword" },
              flag: { type: "string", cli: "--same" },
              other: { type: "string", cli: "--same" },
              rest: { type: "string", cli: "<...rest>" },
              after: { type: "string", cli: "<after>" },
              toggled: { type: "boolean", cli: "<toggled>" },
              fromEnv: { type: "string", cli: { usage: "<pos>", env: "X" } }
            },
            run: () => "x"
          }
        }
      } as never)
    ).toThrow(InvalidDeclaration)

    try {
      compileCommand("tool", ["tool"], {
        commands: {
          broken: {
            input: {
              bad: { type: "not.a.keyword" },
              flag: { type: "string", cli: "--same" },
              other: { type: "string", cli: "--same" },
              toggled: { type: "boolean", cli: "<toggled>" }
            }
          }
        }
      } as never)
      expect.unreachable()
    } catch (error) {
      const declaration = error as InvalidDeclaration
      expect(declaration.issues.length).toBeGreaterThanOrEqual(3)
      expect(declaration.message).toMatch(/tool broken · bad/)
      expect(declaration.message).toMatch(/--same is claimed by flag and other/)
      expect(declaration.message).toMatch(/positional cannot be boolean/)
    }
  })

  vit("accepts a valid declaration unchanged", () => {
    expect(() =>
      compileCommand("tool", ["tool"], {
        input: { a: { type: "string", cli: "<a>" } },
        run: () => "ok"
      } as never)
    ).not.toThrow()
  })
})

describe("exec options", () => {
  it.live("times out and kills the process", () =>
    Effect.gen(function*() {
      const exec = yield* Exec
      const error = yield* Effect.flip(exec.exec("sleep", ["5"], { timeoutMs: 150 }))
      assert.strictEqual(error._tag, "ExecFailure")
      assert.match(error.message, /timed out after 150ms/)
    }).pipe(Effect.provide(Exec.layer)))

  it.effect("inherit mode reports the exit code without capturing", () =>
    Effect.gen(function*() {
      const exec = yield* Exec
      const result = yield* exec.exec("sh", ["-c", "exit 3"], { stdio: "inherit" })
      assert.strictEqual(result.exitCode, 3)
      assert.strictEqual(result.stdout, "")
    }).pipe(Effect.provide(Exec.layer)))
})

describe("help rendering", () => {
  const root = compileCommand("tool", ["tool"], {
    commands: {
      release: {
        description: "bump",
        input: {
          bump: { type: "'patch' | 'minor' | 'major'", description: "increment", cli: "<bump>" },
          token: { type: "string", description: "auth", required: true, cli: "--token" }
        },
        run: () => "x"
      }
    }
  } as never)

  vit("shows arguments with possible values and required flags", () => {
    const help = renderHelp(root.children["release"]!)
    expect(help).toMatch(/Arguments:/)
    expect(help).toMatch(/<bump>\s+increment \[possible values: major, minor, patch\]/)
    expect(help).toMatch(/--token <token>\s+auth \(required\)/)
  })

  vit("lists the built-in completion row only at the root", () => {
    expect(renderHelp(root, { builtins: true })).toMatch(/complete <shell>\s+print a zsh/)
    expect(renderHelp(root.children["release"]!)).not.toMatch(/Built-in/)
  })
})
