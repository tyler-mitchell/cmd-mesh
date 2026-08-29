import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { parseHelpFlags } from "./help-parse.js"

// The fixtures in help-parse.test.ts were transcribed BY the same
// understanding that wrote the parser, so they can agree with a bug.
// This drives the real binary instead and measures coverage against
// what the binary actually printed.

const helpOf = (bin: string, args: ReadonlyArray<string>): string => {
  try {
    return execFileSync(bin, [...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (error) {
    // git status -h exits non-zero while still printing its help
    const output = error as { stdout?: string; stderr?: string }
    return `${output.stdout ?? ""}${output.stderr ?? ""}`
  }
}

/** lines that LOOK like options to a reader, independent of the parser */
const optionLines = (help: string): ReadonlyArray<string> =>
  help.split("\n").filter((line) => /^\s{2,}(-[A-Za-z0-9],\s+)?--\S/.test(line))

describe("against the binary actually installed", () => {
  const help = helpOf("git", ["status", "-h"])

  it("gets help text at all", () => {
    expect(help).toContain("--")
  })

  it("reads every line that looks like an option", () => {
    const seen = new Set(parseHelpFlags(help).map((f) => f.long))
    const missed = optionLines(help).filter((line) => {
      const name = /--(?:\[no-\])?([\w-]+)/.exec(line)?.[1]
      return name !== undefined && !seen.has(name)
    })
    // a miss here is the parser failing on real output, which the
    // transcribed fixtures cannot show
    expect(missed).toEqual([])
  })

  it("finds the flags repo-ops already declares by hand for git status", () => {
    const longs = parseHelpFlags(help).map((f) => f.long)
    expect(longs).toContain("short")
    expect(longs).toContain("branch")
  })

  it("never invents an empty flag name", () => {
    expect(parseHelpFlags(help).every((f) => f.long.length > 0)).toBe(true)
  })
})
