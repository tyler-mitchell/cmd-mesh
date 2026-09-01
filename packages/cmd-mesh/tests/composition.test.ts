import { afterEach, describe, expect, it } from "vitest"
import { external, program } from "../src/index.js"
import { captureCli, captureJson } from "./fixtures/capture.js"

// Advanced composition — the features a real package-manager-shaped
// tool ships ALL AT ONCE. Each suite before this one proves a feature
// alone; this one proves they hold composed, driven through every
// projection the way a shipped tool is.

const registry = external({
  name: "registry",
  bin: "echo",
  commands: {
    publish: {
      description: "publish through the registry binary",
      input: { tag: [["string", "@", { cli: "--tag" }], "=", "latest"] },
      output: "string"
    }
  }
})

const pkgctl = program({
  name: "pkgctl",
  version: "3.0.0",
  description: "a package manager shaped tool",
  cli: { default: "install" },
  commands: {
    install: {
      description: "install packages",
      cli: { alias: ["i", "add"], examples: ["pkgctl add left-pad --filter workspace-a"] },
      input: {
        pkgs: [["string[]", "@", { cli: "[...pkgs]" }], "=", () => []],
        filter: [["string[]", "@", { cli: "--filter <filters...>, -F" }], "=", () => []],
        registry: [
          ["string", "@", { cli: { usage: "--registry", env: "PKGCTL_REGISTRY" } }],
          "=",
          "https://registry.npmjs.org"
        ]
      },
      output: { pkgs: "string[]", filters: "string[]", registry: "string" },
      run: (input) => ({
        pkgs: [...input.pkgs],
        filters: [...input.filter],
        registry: input.registry
      })
    },
    outdated: {
      description: "report outdated packages, exit 1 when any exist",
      run: () => {
        throw Object.assign(new Error("2 packages outdated"), { exitCode: 1 })
      }
    },
    workspace: {
      description: "workspace operations",
      cli: { alias: "ws", default: "list" },
      commands: {
        list: {
          description: "list workspaces",
          output: { names: "string[]" },
          run: () => ({ names: ["a", "b"] })
        },
        focus: {
          description: "focus one workspace",
          input: { name: ["'a' | 'b'", "@", { cli: "<name>" }] },
          output: { focused: "string" },
          run: (input: { readonly name: string }) => ({ focused: input.name })
        }
      }
    },
    registry
  }
})

afterEach(() => {
  delete process.env["PKGCTL_REGISTRY"]
})

describe("everything at once through the cli", () => {
  it("runs the default child on a bare invocation with its defaults", async () => {
    const result = await captureJson(() => pkgctl.cli.run(["--json"]))
    expect(result).toEqual({ pkgs: [], filters: [], registry: "https://registry.npmjs.org" })
  })

  it("combines alias, variadic positionals, repeatable flags, and env", async () => {
    process.env["PKGCTL_REGISTRY"] = "https://corp.internal"
    const result = await captureJson(() =>
      pkgctl.cli.run(["add", "left-pad", "is-odd", "--json", "-F", "a", "--filter", "b"])
    )
    expect(result).toEqual({
      pkgs: ["left-pad", "is-odd"],
      filters: ["a", "b"],
      registry: "https://corp.internal"
    })
  })

  it("chains an alias into a group's default child", async () => {
    // `pkgctl ws` ≡ `pkgctl workspace list` — two features composed
    const result = await captureJson(() => pkgctl.cli.run(["ws", "--json"]))
    expect(result).toEqual({ names: ["a", "b"] })
  })

  it("routes alias → named child with an enum positional", async () => {
    const result = await captureJson(() => pkgctl.cli.run(["ws", "focus", "b", "--json"]))
    expect(result).toEqual({ focused: "b" })
  })

  it("carries a report exit code beside all of it", async () => {
    const { code, err } = await captureCli(() => pkgctl.cli.run(["outdated"]))
    expect(code).toBe(1)
    expect(err).toBe("2 packages outdated")
  })

  it("drives a mounted external with a defaulted flag", async () => {
    const { code, out } = await captureCli(() => pkgctl.cli.run(["registry", "publish"]))
    expect(code).toBe(0)
    expect(out).toBe("publish --tag latest\n")
  })
})

describe("nested default children", () => {
  it("chains group defaults level by level like vite-style tools", async () => {
    // `tool` → default group `serve` → its default `dev`: one bare
    // invocation, two default hops
    const tool = program({
      name: "chained",
      version: "0.0.0",
      cli: { default: "serve" },
      commands: {
        serve: {
          description: "serve group",
          cli: { default: "dev" },
          commands: {
            dev: {
              description: "dev",
              input: { watch: [["boolean", "@", { cli: "--watch" }], "=", false] },
              output: { via: "string", watch: "boolean" },
              run: (input: { readonly watch: boolean }) => ({ via: "dev", watch: input.watch })
            }
          }
        }
      }
    })
    const bare = await captureJson(() => tool.cli.run(["--json"]))
    expect(bare).toEqual({ via: "dev", watch: false })
    const flagged = await captureJson(() => tool.cli.run(["--watch", "--json"]))
    expect(flagged).toEqual({ via: "dev", watch: true })
  })
})

describe("repository questions through ctx", () => {
  it("answers manifest and dependency questions without a spawn", async () => {
    const doctor = program({
      name: "doctor",
      version: "0.0.0",
      commands: {
        deps: {
          description: "report a dependency's presence",
          input: { name: ["string", "@", { cli: "<name>" }] },
          output: { name: "string", declared: "boolean", pkg: "string" },
          run: (input: { readonly name: string }, ctx) => {
            const self = ctx.project("<package_folder>")
            return {
              name: input.name,
              declared: self.isDependencyInPackageJson(input.name),
              pkg: self.packageName ?? ""
            }
          }
        }
      }
    })
    expect(await doctor.deps({ name: "arktype" }))
      .toEqual({ name: "arktype", declared: true, pkg: "cmd-mesh" })
    expect(await doctor.deps({ name: "definitely-not-a-dep-xyz" }))
      .toMatchObject({ declared: false })
  })
})

describe("the same composition on the other surfaces", () => {
  it("keeps the typed surface consistent with the cli", () => {
    expect(pkgctl.install({ pkgs: ["x"], filter: ["a"] })).toEqual({
      pkgs: ["x"],
      filters: ["a"],
      registry: "https://registry.npmjs.org"
    })
    expect(pkgctl.workspace.list()).toEqual({ names: ["a", "b"] })
  })

  it("completes through the alias chain and enumerates the enum", async () => {
    await expect(pkgctl.cli.complete(["ws", ""])).resolves.toContain("focus")
    await expect(pkgctl.cli.complete(["ws", "focus", ""])).resolves.toContain("b")
    await expect(pkgctl.cli.complete(["add", "--f"])).resolves.toContain("--filter")
  })

  it("renders help through the alias with examples and the default marker", () => {
    expect(pkgctl.cli.help(["i"])).toMatch(/pkgctl add left-pad --filter workspace-a/)
    expect(pkgctl.cli.help(["ws"])).toMatch(/list workspaces/)
  })

  it("projects only runnable non-hidden commands as mcp tools", () => {
    const names = pkgctl.mcp.tools.map((t) => t.name)
    expect(names).toContain("pkgctl_install")
    expect(names).toContain("pkgctl_workspace_list")
    expect(names).toContain("pkgctl_registry_publish")
    expect(names).not.toContain("pkgctl_workspace")
  })

  it("describes the whole composition in one spec", () => {
    const install = pkgctl.spec.commands.find((c) => c.path.at(-1) === "install")!
    expect(install.aliases).toEqual(["i", "add"])
    const filter = install.parameters.find((p) => p.key === "filter")!
    expect(filter.variadic).toBe(true)
    expect(filter.usage).toBe("--filter, -F")
    const publish = pkgctl.spec.commands
      .find((c) => c.path.at(-1) === "registry")!
      .commands.find((c) => c.path.at(-1) === "publish")!
    expect(publish.external).toBe(true)
    expect(publish.parameters.find((p) => p.key === "tag")!.defaultValue).toBe("latest")
  })
})
