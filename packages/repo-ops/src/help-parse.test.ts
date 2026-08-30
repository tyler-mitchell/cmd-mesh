import { describe, expect, it } from "vitest"
import { declareExternal, declareFlag, flagKey, parseHelpFlags } from "./help-parse.js"

// Verbatim from the binaries themselves, not hand-written to suit the
// parser: `git status -h` and `pnpm add --help` on this machine.

const gitStatus = `usage: git status [<options>] [--] [<pathspec>...]

    -v, --[no-]verbose    be verbose
    -s, --[no-]short      show status concisely
    -b, --[no-]branch     show branch information
    --[no-]porcelain[=<version>]
                          machine-readable output
    -z, --[no-]null       terminate entries with NUL
    -u, --[no-]untracked-files[=<mode>]
                          show untracked files, optional modes: all, normal, no. (Default: all)
`

const pnpmAdd = `Options:
      --[no-]color                    Controls colors in the output. By default,
                                      output is always colored when it goes
                                      directly to a terminal
  -e, --[no-]save-exact               Install exact version
      --[no-]save-workspace-protocol  Save packages from the workspace with a
                                      "workspace:" protocol. True by default
`

describe("reading a binary's own help", () => {
  const flags = parseHelpFlags(gitStatus)

  it("finds every option line and nothing else", () => {
    // the usage line and the blank lines are not options
    expect(flags.map((f) => f.long)).toEqual([
      "verbose",
      "short",
      "branch",
      "porcelain",
      "null",
      "untracked-files"
    ])
  })

  it("keeps the short spelling with its long one", () => {
    expect(flags.find((f) => f.long === "verbose")).toMatchObject({
      short: "v",
      negatable: true,
      description: "be verbose"
    })
  })

  it("reads a flag that has no short spelling", () => {
    expect(flags.find((f) => f.long === "porcelain")?.short).toBeUndefined()
  })

  it("recognises an optional value and its placeholder", () => {
    expect(flags.find((f) => f.long === "porcelain")).toMatchObject({
      value: "version",
      optionalValue: true
    })
  })

  it("takes a description from the line below when it does not fit", () => {
    expect(flags.find((f) => f.long === "porcelain")?.description)
      .toBe("machine-readable output")
  })

  it("rejoins a word the help broke across lines", () => {
    // pnpm wraps a path as `command-` / `mesh`; joining with a space
    // put `command- mesh` into the drafted description
    const split = `    --dir <dir>    Change to directory (default: /a/command-\n                   mesh/apps/x)\n`
    expect(parseHelpFlags(split)[0]?.description).toContain("command-mesh")
  })

  it("still separates parts that wrap between words", () => {
    const between = `    --x <v>    first part\n               second part\n`
    expect(parseHelpFlags(between)[0]?.description).toBe("first part second part")
  })

  it("joins a description that wraps over several lines", () => {
    const wrapped = parseHelpFlags(pnpmAdd).find((f) => f.long === "color")
    expect(wrapped?.description).toBe(
      "Controls colors in the output. By default, output is always colored when it goes directly to a terminal"
    )
  })

  it("reads the same shape from a different binary", () => {
    expect(parseHelpFlags(pnpmAdd).map((f) => f.long)).toEqual([
      "color",
      "save-exact",
      "save-workspace-protocol"
    ])
  })
})

describe("emitting a nested group", () => {
  const source = declareExternal("git", [{
    name: "remote",
    description: "manage remotes",
    flags: [],
    commands: [{
      name: "get-url",
      description: "git remote get-url",
      flags: [],
      positionals: [{ name: "name", optional: false, variadic: false }]
    }]
  }])

  it("nests the child under its parent's commands", () => {
    expect(source).toContain(`"remote": {`)
    expect(source).toContain(`commands: {`)
    expect(source).toContain(`"get-url": {`)
  })

  it("gives the leaf an output but not the group that only routes", () => {
    // a parent that just dispatches has no stdout contract of its own
    const parent = source.slice(source.indexOf(`"remote"`), source.indexOf(`commands: {`))
    expect(parent).not.toContain(`output:`)
    expect(source.slice(source.indexOf(`"get-url"`))).toContain(`output: "string"`)
  })

  it("keeps the child's operand", () => {
    expect(source).toContain(`"name?"`)
  })
})

describe("emitting declaration source", () => {
  it("names the key the way a declaration would", () => {
    expect(flagKey("untracked-files")).toBe("untrackedFiles")
    expect(flagKey("save-workspace-protocol")).toBe("saveWorkspaceProtocol")
  })

  it("declares a boolean flag with a default, so it is not required", () => {
    const verbose = parseHelpFlags(gitStatus).find((f) => f.long === "verbose")!
    expect(declareFlag(verbose)).toBe(
      `  "verbose": ["boolean", "@", { description: "be verbose", cli: "--verbose, -v", default: false }]`
    )
  })

  // The first real run of the generator emitted `porcelain` as required,
  // so calling any drafted command failed with InvalidInput. Help text
  // never says a flag is mandatory, so no drafted flag may be required.
  // pnpm documents --filter once per selector form, and wraps some
  // examples so a line ends mid-word. Neither is a second flag, and
  // emitting both produced a file TypeScript refused: "an object
  // literal cannot have multiple properties with the same name".
  it("drafts a repeated flag once", () => {
    const repeated = `    --filter <sel>    select packages\n    --filter !x       exclude x\n`
    expect(parseHelpFlags(repeated).map((f) => f.long)).toEqual(["filter"])
  })

  it("ignores a wrapped line that ends mid-word", () => {
    const wrapped = `    --changed-files-ignore-\n    pattern="**/*.md" build\n`
    expect(parseHelpFlags(wrapped)).toEqual([])
  })

  it("never drafts a flag the caller would be forced to pass", () => {
    const required = parseHelpFlags(gitStatus)
      .map(declareFlag)
      .filter((source) => !source.includes("?") && !source.includes("default"))
    expect(required).toEqual([])
  })

  it("declares a valued flag as a string, with no invented default", () => {
    const porcelain = parseHelpFlags(gitStatus).find((f) => f.long === "porcelain")!
    const source = declareFlag(porcelain)
    expect(source).toContain(`["string", "@"`)
    expect(source).not.toContain("default")
  })
})
