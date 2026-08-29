import { type } from "arktype"
import { describe, expect, it } from "vitest"
import { mesh } from "../examples/mesh.js"
import { program } from "../src/index.js"
import type { SuggestContext } from "../src/index.js"
import { compileCommand } from "../src/compile.js"
import { candidateValues, completionLines } from "../src/completion.js"
import { collectTools } from "../src/mcp.js"
import { renderResult } from "../src/render.js"
import { captureCli } from "./fixtures/capture.js"
import { app, deploy, wrap } from "./fixtures/programs.js"

// The agent- and tooling-facing projections: mcp tools and schemas,
// completion, human rendering, and per-surface hiding. An agent reads
// the schema and a shell reads the candidates — a silently degraded
// schema or a shadowed tool name is invisible until production.

interface Schema {
  readonly type?: string
  readonly properties?: Record<string, {
    readonly type?: string
    readonly default?: unknown
    readonly description?: string
    readonly enum?: ReadonlyArray<unknown>
    readonly anyOf?: ReadonlyArray<unknown>
  }>
  readonly required?: ReadonlyArray<string>
}

const toolsOf = (program: { mcp: { tools: ReadonlyArray<{ name: string }> } }) =>
  program.mcp.tools.map((t) => t.name)

type Spec = (typeof deploy)["spec"]
const collectSpecs = (spec: Spec): ReadonlyArray<Spec> => [
  spec,
  ...spec.commands.flatMap((c) => collectSpecs(c))
]

describe("mcp tool identity", () => {
  it("gives every tool a unique name", () => {
    // an MCP server routes purely by name; two tools sharing one makes the
    // second unreachable and the choice silent
    const names = toolsOf(app)
    expect(new Set(names).size).toBe(names.length)
  })

  it("honors an explicit mcp name override", () => {
    expect(toolsOf(deploy)).toContain("deploy_audit_log")
  })

  it("omits mcp-hidden commands", () => {
    expect(toolsOf(deploy)).not.toContain("deploy_internal")
  })

  it("omits non-runnable group commands", () => {
    expect(toolsOf(deploy)).not.toContain("deploy_config")
  })

  it("exposes declared annotations on the projected tool", () => {
    // annotations drive an agent's willingness to call a tool unattended
    // — the declared values must arrive verbatim, not merely a key
    const audit = deploy.mcp.tools.find((t) => t.name === "deploy_audit_log")!
    expect(audit.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
  })
})

describe("mcp input schemas", () => {
  const push = deploy.mcp.tools.find((t) => t.name === "deploy_push")!
  const schema = push.inputSchema as Schema

  it("describes every declared parameter", () => {
    const properties = Object.keys(schema.properties ?? {})
    expect(properties).toEqual(
      expect.arrayContaining(["service", "env", "message", "replicas", "force", "watch"])
    )
  })

  it("requires only what has no default", () => {
    expect(schema.required).toEqual(["service"])
  })

  it("carries declared defaults", () => {
    expect(schema.properties?.["replicas"]?.default).toBe(2)
    expect(schema.properties?.["env"]?.default).toBe("staging")
  })

  it("carries parameter descriptions", () => {
    expect(schema.properties?.["service"]?.description).toBe("service name")
    expect(schema.properties?.["replicas"]?.description).toBe("replica count")
  })

  it("projects an enum parameter as an enumeration, not a bare string", () => {
    const env = schema.properties?.["env"]
    const encoded = JSON.stringify(env)
    expect(encoded).toMatch(/staging/)
    expect(encoded).toMatch(/production/)
  })

  it("never degrades a schema to an untyped object", () => {
    // the spec knows each command's true parameter count — every
    // non-mcp-hidden parameter must appear in the tool schema, so a
    // silently swallowed projection failure cannot hide
    const specParams = new Map(
      collectSpecs(deploy.spec).map((s) => [
        s.path.join(" "),
        s.parameters.filter((p) => !p.hidden.mcp).map((p) => p.key)
      ])
    )
    for (const tool of deploy.mcp.tools) {
      const s = tool.inputSchema as Schema
      expect(s.type).toBe("object")
      const path = ["deploy", ...tool.name.split("_").slice(1)].join(" ")
      const declared = specParams.get(path)
      if (declared !== undefined && declared.length > 0) {
        expect(Object.keys(s.properties ?? {})).toEqual(expect.arrayContaining(declared))
      }
    }
  })

  it("projects a structured parameter as a nested object schema", () => {
    const snapshot = mesh.mcp.tools.find((t) => t.name === "mesh_snapshot")!
    const signKey = (snapshot.inputSchema as Schema).properties?.["signKey"]
    expect(signKey?.type).toBe("object")
  })

  it("projects a variadic positional as an array", () => {
    const exec = wrap.mcp.tools.find((t) => t.name === "wrap_exec")!
    const args = (exec.inputSchema as Schema).properties?.["args"]
    expect(JSON.stringify(args)).toMatch(/array/)
  })
})

describe("mcp output schemas", () => {
  it("keeps an object output unwrapped", () => {
    const push = deploy.mcp.tools.find((t) => t.name === "deploy_push")!
    expect((push.outputSchema as Schema).type).toBe("object")
    expect((push.outputSchema as Schema).properties).toHaveProperty("service")
  })

  it("wraps a list output under result", () => {
    const status = deploy.mcp.tools.find((t) => t.name === "deploy_status")!
    expect((status.outputSchema as Schema).properties).toHaveProperty("result")
  })

  it("keeps an object-producing morph output unwrapped and parsed", () => {
    const reader = program({
      name: "reader",
      version: "0.0.0",
      commands: {
        conf: {
          description: "parse json output",
          output: "string.json.parse",
          run: () => "{\"a\":1}"
        }
      }
    })
    expect(reader.conf()).toEqual({ a: 1 })
  })

  it("describes a MORPH output contract by its output side", () => {
    // an output contract like "string.numeric.parse" hands the caller a
    // NUMBER — the advertised outputSchema must describe that number,
    // because structuredContent must conform to outputSchema (MCP spec)
    const parser = program({
      name: "parser",
      version: "0.0.0",
      commands: {
        count: {
          description: "count",
          output: "string.numeric.parse",
          run: () => "42"
        }
      }
    })
    expect(parser.count()).toBe(42)
    const tool = parser.mcp.tools.find((t) => t.name === "parser_count")!
    const wrapped = tool.outputSchema as {
      properties?: Record<string, { type?: string }>
    }
    expect(wrapped.properties?.["result"]?.type).toBe("number")
  })
})

describe("per-parameter surface hiding (contract: 08-final grammar rules)", () => {
  const tool = program({
    name: "tool",
    version: "0.0.0",
    description: "hides one parameter per surface",
    commands: {
      push: {
        description: "push",
        input: {
          target: { type: "string", cli: "<target>" },
          token: { type: "string", description: "registry token", mcp: { hidden: true }, cli: "--token" },
          trace: { type: "boolean", description: "internal tracing", cli: { usage: "--trace", hidden: true } }
        },
        output: { target: "string", authed: "boolean", traced: "boolean" },
        run: (input) => ({
          target: input.target,
          authed: input.token !== undefined,
          traced: input.trace
        })
      }
    }
  })

  it("drops an mcp-hidden parameter from the tool schema only", () => {
    const push = tool.mcp.tools[0]!.inputSchema as {
      properties: Record<string, unknown>
      required?: ReadonlyArray<string>
    }
    expect(push.properties).not.toHaveProperty("token")
    expect(push.properties).toHaveProperty("target")
    // the cli surface is untouched: help still documents --token
    expect(tool.cli.help(["push"])).toMatch(/--token/)
  })

  it("drops a cli-hidden parameter from help and completion, not from parsing", async () => {
    expect(tool.cli.help(["push"])).not.toMatch(/--trace/)
    await expect(tool.cli.complete(["push", "x", "--"])).resolves.not.toContain("--trace")
    const { code, out } = await captureCli(() => tool.cli.run(["push", "x", "--trace", "--json"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ traced: true })
  })

  it("rejects cli-hiding a positional at declaration time", () => {
    expect(() =>
      program({
        name: "bad",
        version: "0.0.0",
        commands: {
          go: {
            description: "go",
            input: { dir: { type: "string", cli: { usage: "<dir>", hidden: true } } },
            run: (input: { dir: string }) => input.dir
          }
        }
      })
    ).toThrow(/positional cannot be cli-hidden/)
  })
})

describe("scoped arktype vocabulary as parameter types", () => {
  it("accepts a type.module member with full projection fidelity", async () => {
    const { type } = await import("arktype")
    const vocabulary = type.module({
      Environment: "'staging' | 'production'",
      Replicas: "1 <= number.integer <= 10"
    })
    const ship = program({
      name: "ship",
      version: "0.0.0",
      commands: {
        push: {
          description: "push",
          input: {
            env: { type: vocabulary.Environment, cli: "--env" },
            replicas: { type: vocabulary.Replicas, cli: "--replicas" }
          },
          output: { env: "string" },
          run: (input: { readonly env?: string }) => ({ env: input.env ?? "none" })
        }
      }
    })
    await expect(ship.cli.complete(["push", "--env", ""])).resolves.toContain("staging")
    const schema = JSON.stringify(ship.mcp.tools[0]!.inputSchema)
    expect(schema).toMatch(/staging/)
    const { code, err } = await captureCli(() => ship.cli.run(["push", "--replicas", "99"]))
    expect(code).toBe(2)
    expect(err).toMatch(/replicas/)
  })
})

describe("concurrent completion requests", () => {
  it("answers parallel completes independently", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0 ? deploy.cli.complete([""]) : deploy.cli.complete(["push", "api", "--"]))
    )
    results.forEach((candidates, i) => {
      if (i % 2 === 0) expect(candidates).toContain("push")
      else expect(candidates).toContain("--force")
    })
  })
})

describe("static suggestions beside enumerable literals", () => {
  it("offers both without duplicates", async () => {
    const picker = program({
      name: "picker",
      version: "0.0.0",
      commands: {
        use: {
          description: "use",
          input: {
            preset: { type: "'fast' | 'slow'", suggest: ["fast", "custom"], cli: "--preset" }
          },
          run: (input: { readonly preset?: string }) => input.preset ?? "none"
        }
      }
    })
    const candidates = await picker.cli.complete(["use", "--preset", ""])
    expect(candidates).toEqual(expect.arrayContaining(["fast", "slow", "custom"]))
    expect(new Set(candidates).size).toBe(candidates.length)
  })
})

describe("suggestion generators", () => {
  it("completes workspace package names through ctx.workspace", async () => {
    // the canonical monorepo completion source — no shelling to a
    // package manager and parsing its output. hoisted with an annotated
    // parameter, as the generator contract documents.
    const workspacePackages = (ctx: SuggestContext) => ctx.workspace.packageNames()
    const repo = program({
      name: "repo",
      version: "0.0.0",
      commands: {
        focus: {
          description: "focus a workspace package",
          input: {
            pkg: { type: "string", suggest: workspacePackages, cli: "<pkg>" }
          },
          run: (input: { readonly pkg: string }) => input.pkg
        }
      }
    })
    await expect(repo.cli.complete(["focus", ""])).resolves.toContain("cmd-mesh")
  })

  it("degrades to static candidates when a generator throws", async () => {
    // the README promise: completion never errors
    const risky = program({
      name: "risky",
      version: "0.0.0",
      commands: {
        checkout: {
          description: "checkout",
          input: {
            branch: {
              type: "string",
              suggest: Object.assign(
                () => {
                  throw new Error("git broke")
                },
                {}
              ) as () => ReadonlyArray<string>,
              cli: "<branch>"
            },
            fallback: { type: "string", suggest: ["main", "develop"], cli: "--from" }
          },
          run: (input: { readonly branch: string }) => input.branch
        }
      }
    })
    await expect(risky.cli.complete(["checkout", "--from", ""])).resolves.toContain("main")
    // the throwing generator's own slot resolves, empty or static — never rejects
    await expect(risky.cli.complete(["checkout", ""])).resolves.toBeDefined()
  })

  it("hands a generator canonical words when an alias routed the line", async () => {
    // generator authors match on ctx.words — the alias rewrite must be
    // visible contract, not a surprise: words arrive canonicalized
    const seen: Array<ReadonlyArray<string>> = []
    const gen = (ctx: { readonly words: ReadonlyArray<string> }) => {
      seen.push(ctx.words)
      return ["r1"]
    }
    const tool = program({
      name: "gentool",
      version: "0.0.0",
      commands: {
        workspace: {
          description: "ws ops",
          cli: { alias: "ws" },
          commands: {
            focus: {
              description: "focus",
              input: { name: { type: "string", suggest: gen, cli: "<name>" } },
              run: (input: { readonly name: string }) => input.name
            }
          }
        }
      }
    })
    await expect(tool.cli.complete(["ws", "focus", ""])).resolves.toContain("r1")
    expect(seen[0]).toEqual(["workspace", "focus", ""])
  })
})

describe("projection objects are stable against consumer mutation", () => {
  it("refuses consumer mutation of mcp.tools loudly", () => {
    // two consumers share one module for hours — one splicing the list
    // must fail loudly, never corrupt the other's view
    const tools = deploy.mcp.tools
    expect(() => {
      ;(tools as unknown as Array<unknown>).length = 0
    }).toThrow()
    expect(deploy.mcp.tools.length).toBeGreaterThan(0)
  })
})

describe("completion candidates through the public surface", () => {
  it("offers visible subcommands at the root", async () => {
    const candidates = await deploy.cli.complete([""])
    expect(candidates).toEqual(expect.arrayContaining(["push", "rollback", "config", "status"]))
  })

  it("never repeats a candidate", async () => {
    const candidates = await deploy.cli.complete([""])
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it("offers short aliases for a short prefix", async () => {
    const candidates = await deploy.cli.complete(["push", "api", "-"])
    expect(candidates).toEqual(expect.arrayContaining(["-f", "-m", "-e"]))
  })

  it("offers long flags for a long prefix", async () => {
    const candidates = await deploy.cli.complete(["push", "api", "--"])
    expect(candidates).toEqual(expect.arrayContaining(["--force", "--message", "--env"]))
  })

  it("enumerates a flag's literal values", async () => {
    const candidates = await deploy.cli.complete(["push", "api", "--env", ""])
    expect(candidates).toEqual(expect.arrayContaining(["production", "staging"]))
  })

  it("does not offer values for a boolean flag", async () => {
    const candidates = await deploy.cli.complete(["push", "api", "--force", ""])
    expect(candidates).not.toContain("true")
  })

  it("stops offering options after the end-of-options separator", async () => {
    // everything after `--` is a value, so the command's own flags are
    // no longer candidates
    const candidates = await deploy.cli.complete(["push", "api", "--", "-"])
    expect(candidates.filter((c) => c.startsWith("-"))).toEqual([])
  })
})

// ─── the compiled model directly ────────────────────────────────────────────

const root = compileCommand("tool", ["tool"], {
  commands: {
    release: {
      description: "bump",
      input: {
        bump: { type: "'patch' | 'minor' | 'major'", cli: "<bump>" },
        pkg: { type: "string = './package.json'", suggest: "filepaths", cli: "--pkg" },
        dryRun: { type: "boolean", cli: "--dry-run, -n" }
      },
      output: { from: "string", to: "string" },
      run: () => ({ from: "0.0.0", to: "0.0.1" })
    },
    list: {
      description: "list things",
      output: [{ name: "string" }, "[]"],
      run: () => [{ name: "a" }]
    },
    secret: {
      description: "cli hidden",
      cli: { hidden: true },
      run: () => "s"
    }
  }
} as never)

const candidatesFor = (words: ReadonlyArray<string>): ReadonlyArray<string> =>
  candidateValues(completionLines(root, words, []))

describe("completion candidates from the compiled model", () => {
  it("lists visible subcommands at the root", () => {
    expect(candidatesFor([""])).toEqual(["release", "list"])
  })

  it("completes enum positionals from the ArkType union", () => {
    expect(candidatesFor(["release", ""])).toContain("major")
    expect(candidatesFor(["release", "m"])).toEqual(["major", "minor"])
    expect(candidatesFor(["release", "pa"])).toEqual(["patch"])
  })

  it("offers long flags and short aliases by prefix shape", () => {
    const long = candidatesFor(["release", "--"])
    expect(long).toContain("--pkg")
    expect(long).toContain("--dry-run")
    expect(candidatesFor(["release", "-"])).toContain("-n")
  })

  it("resolves a named filesystem source for flag values", () => {
    const candidates = candidatesFor(["release", "--pkg", ""])
    expect(candidates).toContain("package.json")
    expect(candidates).toContain("src/")
  })

  it("descends into the current word's directory for file sources", () => {
    // `--pkg src/com<TAB>` must list inside src/, prefixed so the shell
    // filter matches
    const candidates = candidatesFor(["release", "--pkg", "src/com"])
    expect(candidates).toContain("src/compile.ts")
  })

  it("stops offering a consumed positional", () => {
    expect(candidatesFor(["release", "patch", ""])).not.toContain("major")
  })
})

describe("arktype meta descriptions", () => {
  // a described Type IS the documentation — no separate description field
  // needed. authored meta reaches help and the mcp schema; arktype's
  // auto-descriptions ("a string") never do.
  const meta = program({
    name: "meta",
    version: "0.0.0",
    commands: {
      serve: {
        description: "serve",
        input: {
          port: { type: type("string.integer.parse").describe("a port to listen on"), cli: "--port" },
          host: {
            type: type("string").describe("falls behind the descriptor"),
            description: "the descriptor wins",
            cli: "--host"
          },
          plain: { type: "string", cli: "--plain" }
        },
        output: { "port?": "number" },
        run: (input: { port?: number }) => (input.port === undefined ? {} : { port: input.port })
      }
    }
  })

  it("surfaces authored meta in help", () => {
    const help = meta.cli.help(["serve"])
    expect(help).toMatch(/a port to listen on/)
  })

  it("prefers an explicit descriptor description", () => {
    const help = meta.cli.help(["serve"])
    expect(help).toMatch(/the descriptor wins/)
    expect(help).not.toMatch(/falls behind/)
  })

  it("never leaks arktype's auto-description", () => {
    expect(meta.cli.help(["serve"])).not.toMatch(/a string/)
  })

  it("carries authored meta into the mcp input schema", () => {
    const tool = meta.mcp.tools.find((t) => t.name === "meta_serve")!
    expect(JSON.stringify(tool.inputSchema)).toMatch(/a port to listen on/)
  })
})

describe("mcp tools from the compiled model", () => {
  const tools = collectTools(root)
  const byName = new Map(tools.map((t) => [t.tool.name, t]))

  it("wraps non-object output schemas under result", () => {
    const list = byName.get("tool_list")!
    expect(list.wrapOutput).toBe(true)
    expect((list.tool.outputSchema as { properties: object }).properties).toHaveProperty("result")
  })

  it("keeps object output schemas unwrapped", () => {
    const release = byName.get("tool_release")!
    expect(release.wrapOutput).toBe(false)
    expect((release.tool.outputSchema as { required: ReadonlyArray<string> }).required)
      .toEqual(["from", "to"])
  })
})

describe("cli rendering", () => {
  it("renders arrays of flat records as aligned rows", () => {
    const rendered = renderResult([
      { file: "a.ts", line: 1, text: "one" },
      { file: "longer/path.ts", line: 22, text: "two" }
    ])
    expect(rendered).toBe("a.ts            1   one\nlonger/path.ts  22  two")
  })

  it("keeps strings raw and formats objects readably", () => {
    expect(renderResult("plain")).toBe("plain")
    // Formatter.format owns the shape; the contract is readable + safe
    expect(renderResult({ a: 1 })).toMatch(/a.*1/)
    const cyclic: Record<string, unknown> = {}
    cyclic["self"] = cyclic
    expect(() => renderResult(cyclic)).not.toThrow()
  })
})
