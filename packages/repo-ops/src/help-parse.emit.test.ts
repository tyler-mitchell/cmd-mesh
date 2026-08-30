import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { declareExternal, parseHelpFlags } from "./help-parse.js"

// A generator is only useful if what it emits is REAL cmd-mesh source.
// So this writes the draft to disk, typechecks it with the project's own
// compiler, imports it, and runs a command against the actual binary.

const helpOf = (args: ReadonlyArray<string>): string => {
  try {
    return execFileSync("git", [...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string }
    return `${output.stdout ?? ""}${output.stderr ?? ""}`
  }
}

// inside the package: a draft anywhere else cannot resolve `cmd-mesh`,
// which is exactly what a consumer would hit too
const packageRoot = new URL("..", import.meta.url).pathname
const scratch = join(packageRoot, ".generated")
mkdirSync(scratch, { recursive: true })

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const draft = declareExternal("git", [
  {
    name: "status",
    description: "working tree status",
    flags: parseHelpFlags(helpOf(["status", "-h"])).filter((f) =>
      f.long === "short" || f.long === "branch"
    )
  }
])

describe("the emitted declaration", () => {
  it("is source a person can read, and says what it does not know", () => {
    expect(draft).toContain(`import { external } from "cmd-mesh"`)
    expect(draft).toContain(`export const git = external({`)
    // safety cannot be read from help text, so it is marked, not guessed:
    // the only mention is the TODO, never an actual declared value
    expect(draft).toContain(`TODO set safety`)
    // a curator must know the draft can be partial: `git log -h` omits
    // --oneline and --max-count, though both work
    expect(draft).toContain(`not always its whole surface`)
    expect(draft.split("\n").filter((l) => /^\s*safety:/.test(l))).toEqual([])
  })

  it("carries the flags it read from the binary", () => {
    expect(draft).toContain(`"short"`)
    expect(draft).toContain(`"--short, -s"`)
    expect(draft).toContain(`"branch"`)
  })

  // MEASURED: this proves the emitted source compiles and is structurally
  // a valid declaration. It does NOT prove the ArkType keywords are real —
  // `external`'s `input` is typed `object`, unlike `program`'s, so a bogus
  // keyword passes here and is caught by the run test below instead.
  it("typechecks as real cmd-mesh source", () => {
    const file = join(scratch, "generated.ts")
    writeFileSync(file, draft)
    // the project's own compiler, against the real cmd-mesh types
    // the package's OWN tsconfig, not hand-rolled flags: bare flags drop
    // its lib and types settings and every dependency then fails to
    // compile, which says nothing about the emitted source
    writeFileSync(
      join(scratch, "tsconfig.json"),
      JSON.stringify({ extends: "../tsconfig.json", include: ["generated.ts"] })
    )
    const compile = (): string => {
      try {
        return execFileSync(
          join(packageRoot, "node_modules/.bin/tsc"),
          ["--noEmit", "--project", scratch],
          { encoding: "utf-8", cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] }
        )
      } catch (error) {
        // tsc reports on stdout, which execFileSync hides inside the error
        const output = error as { stdout?: string; stderr?: string }
        return `${output.stdout ?? ""}${output.stderr ?? ""}`
      }
    }
    expect(compile().trim()).toBe("")
  }, 60_000)

  it("produces a declaration that actually runs the binary", async () => {
    const file = join(scratch, "runnable.ts")
    writeFileSync(file, draft)
    const module = await import(file) as {
      git: { status: (input?: Record<string, unknown>) => Promise<string> }
    }
    const output = await module.git.status({ short: true })
    // run inside this repository, so the output is a real status
    expect(typeof output).toBe("string")
  }, 60_000)
})
