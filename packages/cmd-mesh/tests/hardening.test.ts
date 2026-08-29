import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { expect, it as vit } from "vitest"
import { Effect } from "effect"
import { compileCommand } from "../src/compile.js"
import { program } from "../src/index.js"
import { InvalidDeclaration } from "../src/errors.js"
import { Exec } from "../src/exec.js"
import { renderHelp } from "../src/render.js"

// the production-hardening layer: declaration validation, exec modes, help.

describe("the errors reference", () => {
  vit("documents every diagnostic code the compiler can emit", async () => {
    const { readFile } = await import("node:fs/promises")
    const { diagnostics } = await import("../src/diagnostics.js")
    const { getPath } = await import("../src/index.js")
    const page = await readFile(getPath("<package_folder>/docs/errors.md"), "utf8")
    const codes = Object.keys(diagnostics).filter((key) => key.startsWith("CMSH"))
    expect(codes.length).toBeGreaterThan(0)
    const undocumented = codes.filter((code) => !page.includes(`## ${code}`))
    expect(undocumented).toEqual([])
  })
})

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
              toggled: ["boolean", "@", { cli: "<toggled>" }],
              fromEnv: ["string", "@", { cli: { usage: "<pos>", env: "X" } }]
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
              bad: "not.a.keyword",
              flag: ["string", "@", { cli: "--same" }],
              other: ["string", "@", { cli: "--same" }],
              toggled: ["boolean", "@", { cli: "<toggled>" }]
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

  vit("rejects a misspelled command field in a program declaration", () => {
    expect(() =>
      program({
        name: "tool",
        commands: { go: { descrption: "go", run: () => "ok" } }
      } as never)
    ).toThrow(/CMSH1013.*descrption/s)
  })

  vit("accepts a valid declaration unchanged", () => {
    expect(() =>
      compileCommand("tool", ["tool"], {
        input: { a: ["string", "@", { cli: "<a>" }] },
        run: () => "ok"
      } as never)
    ).not.toThrow()
  })
})

describe("exec options", () => {
  vit("preferLocal resolves workspace-local binaries through ctx.exec", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exec-local-"))
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }))
    await writeFile(join(dir, "pnpm-workspace.yaml"), "packages: []\n")
    const bin = join(dir, "node_modules", ".bin")
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, "probe-local"), "#!/bin/sh\necho local-hit\n", { mode: 0o755 })
    const env = { PATH: "/usr/bin:/bin" }
    const tool = program({
      name: "tool",
      commands: {
        miss: {
          output: "string",
          run: async (_input, ctx) =>
            (await ctx.exec("probe-local", [], { cwd: dir, env })).stdout
        },
        hit: {
          output: "string",
          run: async (_input, ctx) =>
            (await ctx.exec("probe-local", [], { cwd: dir, env, preferLocal: true })).stdout.trim()
        }
      }
    })
    const { getWorkspaceFolder } = await import("package-management")
    expect(getWorkspaceFolder({ cwd: dir, throwIfNotFound: false })).toBe(dir)
    await expect(tool.miss()).rejects.toThrow(/failed to execute probe-local/)
    await expect(tool.hit()).resolves.toBe("local-hit")
  })

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
          bump: ["'patch' | 'minor' | 'major'", "@", { description: "increment", cli: "<bump>" }],
          // no `?` and no default: required
          token: ["string", "@", { description: "auth", cli: "--token" }]
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
