import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import {
  parseHelpCommands,
  parseHelpFlags,
  parseHelpPositionals,
  parseHelpSubcommands
} from "./help-parse.js"

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

describe("finding a group's own subcommands", () => {
  const remote = helpOf("git", ["remote", "-h"])
  const subs = parseHelpSubcommands(remote, ["git", "remote"])

  it("reads the children git documents only in its usage block", () => {
    for (const child of ["add", "rename", "remove", "prune", "set-url", "get-url"]) {
      expect(subs).toContain(child)
    }
  })

  it("finds a child that follows a flag group rather than the path", () => {
    // "or: git remote [-v | --verbose] show [-n] <name>"
    expect(subs).toContain("show")
  })

  it("does not treat the group's own usage line as a child", () => {
    // "usage: git remote [-v | --verbose]" names no child
    expect(subs).not.toContain("remote")
    expect(subs).not.toContain("v")
  })

  it("answers nothing for a command that has no children", () => {
    expect(parseHelpSubcommands(helpOf("git", ["status", "-h"]), ["git", "status"])).toEqual([])
  })
})

describe("reading a usage line's operands", () => {
  it("finds git status's variadic pathspec", () => {
    // usage: git status [<options>] [--] [<pathspec>...]
    const positionals = parseHelpPositionals(helpOf("git", ["status", "-h"]))
    expect(positionals).toEqual([{ name: "pathspec", optional: true, variadic: true }])
  })

  it("never mistakes the options placeholder for an operand", () => {
    const names = parseHelpPositionals(helpOf("git", ["log", "-h"])).map((p) => p.name)
    expect(names).not.toContain("options")
  })

  it("answers nothing when there is no usage line", () => {
    expect(parseHelpPositionals("no usage here\n  -v, --verbose  be verbose")).toEqual([])
  })
})

describe("discovering a binary's subcommands", () => {
  const topHelp = helpOf("git", ["--help"])
  const commands = parseHelpCommands(topHelp)

  it("gets the command list in its help at all", () => {
    expect(topHelp).toContain("clone")
  })

  it("finds the commands git documents, with their descriptions", () => {
    const names = commands.map((c) => c.name)
    for (const expected of ["clone", "init", "add", "commit", "status", "log", "push"]) {
      expect(names).toContain(expected)
    }
    expect(commands.find((c) => c.name === "add")?.description)
      .toBe("Add file contents to the index")
  })

  it("never returns an option as if it were a command", () => {
    expect(commands.every((c) => !c.name.startsWith("-"))).toBe(true)
  })

  it("lists each command once, though git prints some twice", () => {
    const names = commands.map((c) => c.name)
    expect(names.length).toBe(new Set(names).size)
  })
})
