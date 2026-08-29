import { describe, expect, it } from "vitest"
import { external, program } from "../src/index.js"
import type { CommandSpec } from "../src/index.js"
import { mesh } from "../examples/mesh.js"
import { deploy } from "./fixtures/programs.js"

// program.spec, proven by USE. the surface exists for three consumers —
// doc generators, agent tool inventories, and the install handshake —
// so each test IS one of those consumers, built the way an agent would
// build it. if spec cannot power these, it is not real.

/** consumer 1: a cli reference generator — what an agent hand-rolls by
 * parsing help text when no spec exists */
const cliReference = (spec: CommandSpec): string => {
  const parameterLine = (p: CommandSpec["parameters"][number]): string =>
    [
      `- \`${p.usage}\``,
      p.description === undefined ? "" : ` — ${p.description}`,
      p.defaultValue === undefined ? "" : ` (default: ${JSON.stringify(p.defaultValue)})`,
      p.env === undefined ? "" : ` [env: ${p.env}]`,
      p.required && p.kind === "flag" ? " (required)" : ""
    ].join("")
  const own = spec.runnable && !spec.hidden.cli
    ? [
      `### ${spec.path.join(" ")}`,
      spec.description,
      ...spec.examples.map((example) => `> ${example}`),
      ...spec.parameters.filter((p) => !p.hidden.cli).map(parameterLine)
    ]
    : []
  return [own.join("\n"), ...spec.commands.map(cliReference)]
    .filter((block) => block !== "")
    .join("\n\n")
}

/** consumer 2: an agent-facing tool inventory — what MCP docs list */
const agentTools = (spec: CommandSpec): ReadonlyArray<string> =>
  [
    ...(spec.runnable && !spec.hidden.mcp ? [spec.path.join(" ")] : []),
    ...spec.commands.flatMap(agentTools)
  ]

describe("spec powers a cli reference generator", () => {
  const docs = cliReference(deploy.spec)

  it("documents every runnable command at its full path", () => {
    expect(docs).toContain("### deploy push")
    expect(docs).toContain("### deploy rollback")
    expect(docs).toContain("### deploy config show")
    // groups without handlers are structure, not entries
    expect(docs).not.toContain("### deploy config\n")
  })

  it("renders the parameter grammar a user actually types", () => {
    expect(docs).toContain("- `<service>` — service name")
    expect(docs).toContain('- `--env, -e` — target environment (default: "staging") [env: DEPLOY_ENV]')
    expect(docs).toContain("- `--yes` — confirm destructive rollback (required)")
  })
})

describe("spec powers an agent tool inventory", () => {
  it("lists runnable commands minus mcp-hidden ones", () => {
    const tools = agentTools(deploy.spec)
    expect(tools).toContain("deploy audit")
    expect(tools).toContain("deploy config show")
    expect(tools).not.toContain("deploy internal")
    expect(tools).not.toContain("deploy config")
  })
})

describe("spec answers the prompt-UI consumer", () => {
  const prompted = program({
    name: "prompted",
    version: "0.0.0",
    commands: {
      pick: {
        description: "pick",
        input: {
          fruit: ["string", "@", { suggest: ["apple", "pear"], cli: "<fruit>" }],
          "dir?": ["string", "@", { suggest: "folders", cli: "--dir" }]
        },
        output: { ok: "boolean" },
        run: () => ({ ok: true })
      }
    }
  })

  it("exposes static suggestions and named sources per parameter", () => {
    const pick = prompted.spec.commands[0]!
    expect(pick.parameters.find((p) => p.key === "fruit")!.suggestions).toEqual(["apple", "pear"])
    expect(pick.parameters.find((p) => p.key === "dir")!.suggestionSource).toBe("folders")
  })
})

describe("spec answers the doc-gen consumer on exit semantics", () => {
  it("carries an external's successCodes", () => {
    const searcher = external({
      name: "searcher2",
      commands: {
        grep: {
          description: "search",
          successCodes: [0, 1],
          input: { pattern: ["string", "@", { cli: "<pattern>" }] },
          output: "string"
        }
      }
    })
    const host = program({ name: "host4", version: "0.0.0", commands: { searcher } })
    const grep = host.spec.commands
      .find((c) => c.path.at(-1) === "searcher")!
      .commands.find((c) => c.path.at(-1) === "grep")!
    expect(grep.successCodes).toEqual([0, 1])
  })
})

describe("spec is stable against consumer mutation", () => {
  it("refuses consumer mutation loudly, at every depth", () => {
    const own = program({
      name: "stable",
      version: "1.0.0",
      commands: {
        go: { description: "go", output: { ok: "boolean" }, run: () => ({ ok: true }) }
      }
    })
    const view = own.spec as unknown as {
      commands: Array<{ description: string }>
      description: string
    }
    expect(() => {
      view.commands.length = 0
    }).toThrow()
    expect(() => {
      view.description = "corrupted"
    }).toThrow()
    expect(() => {
      view.commands[0]!.description = "corrupted"
    }).toThrow()
    expect(own.spec.commands.length).toBe(1)
  })
})

describe("spec keeps its JSON promise for every default", () => {
  it("serializes a Date-producing default as its wire form", () => {
    // `JSON.stringify(program.spec)` is the contract — a morphed default
    // (Date) must already be wire-safe inside the spec, not a live object
    const dated = program({
      name: "dated",
      version: "0.0.0",
      commands: {
        since: {
          description: "since",
          input: {
            from: ["string.date.iso.parse", "@", { cli: "--from", default: "2024-01-05T00:00:00.000Z" }]
          },
          output: { ok: "boolean" },
          run: () => ({ ok: true })
        }
      }
    })
    const wire = JSON.parse(JSON.stringify(dated.spec)) as CommandSpec
    expect(wire).toEqual(dated.spec)
    const from = wire.commands[0]!.parameters.find((p) => p.key === "from")!
    expect(from.defaultValue).toBe("2024-01-05T00:00:00.000Z")
  })
})

describe("spec powers the install handshake", () => {
  // the setup harness reads the spec over a pipe: everything must
  // survive JSON with no live objects attached
  const wire = JSON.parse(JSON.stringify(mesh.spec)) as CommandSpec

  it("carries the program's identity — the handshake needs the version", () => {
    // the install handshake verifies "which tool, which version" before
    // wiring hosts; a self-description without a version cannot
    expect(wire.path).toEqual(["mesh"])
    expect((wire as { readonly version?: string }).version).toBe("0.1.0")
  })

  it("names a group's default command — doc gen must document it", () => {
    // `pkgctl` running `install` bare is user-facing behavior; a
    // reference generated from spec has to say so
    const grouped = program({
      name: "grouped",
      version: "0.0.0",
      cli: { default: "dev" },
      commands: {
        dev: { description: "dev", output: { ok: "boolean" }, run: () => ({ ok: true }) }
      }
    })
    expect((grouped.spec as { readonly defaultCommand?: string }).defaultCommand).toBe("dev")
  })

  it("survives the wire and still answers the harness's questions", () => {
    expect(wire).toEqual(mesh.spec)
    const docs = cliReference(wire)
    expect(docs).toContain("### mesh snapshot")
    // a mounted external's commands are part of the self-description
    expect(docs).toContain("### mesh git status")
    const status = wire.commands
      .find((c) => c.path.at(-1) === "git")!
      .commands.find((c) => c.path.at(-1) === "status")!
    expect(status.external).toBe(true)
    expect(status.runnable).toBe(true)
  })
})
