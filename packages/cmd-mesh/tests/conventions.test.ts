// Conventions other ecosystems already litigated.
//
// These cases are borrowed from citty's test suite (unjs/citty test/args,
// test/parser, test/main) — each one encodes a real-world expectation its
// users filed issues over. Two are cases citty itself cannot pass (#237
// short-alias `=`, marked it.fails upstream) — a mesh parser must.

import { describe, expect, it } from "vitest"
import { program } from "../src/index.js"
import { captureCli, captureJson } from "./fixtures/capture.js"
import { bake, deploy } from "./fixtures/programs.js"

// a server-style root: declared flags AND subcommands, the shape citty's
// "sub command with parent args" suite exercises
const serve = program({
  name: "serve",
  version: "1.0.0",
  description: "a dev server with root flags and subcommands",
  input: {
    port: [["string.integer.parse", "@", { cli: "--port, -p" }], "=", "3000"],
    watch: [["boolean", "@", { cli: "--watch" }], "=", false]
  },
  commands: {
    start: {
      description: "start the server",
      output: { started: "boolean" },
      run: () => ({ started: true })
    },
    stop: {
      description: "stop the server",
      output: { stopped: "boolean" },
      run: () => ({ stopped: true })
    }
  }
})

// a program that claims tokens the interpreter also wants
const claimant = program({
  name: "claimant",
  version: "9.9.9",
  description: "declares --version and -h for itself",
  commands: {
    info: {
      description: "report host info",
      input: {
        host: [["string", "@", { cli: "--host, -h" }], "=", "localhost"],
        version: [["boolean", "@", { cli: "--version" }], "=", false]
      },
      output: { host: "string", version: "boolean" },
      run: (input) => ({ host: input.host, version: input.version })
    }
  }
})

describe("flag value syntax (citty args/parser)", () => {
  it("accepts --flag=value for string flags", async () => {
    const result = await captureJson(() =>
      deploy.cli.run(["push", "api", "--json", "--message=hotfix", "--env=production"])
    )
    expect(result).toMatchObject({ service: "api", message: "hotfix", env: "production" })
  })

  it("accepts -a=value on a short alias — citty #237, marked it.fails upstream", async () => {
    const result = await captureJson(() => deploy.cli.run(["push", "api", "--json", "-m=hotfix"]))
    expect(result).toMatchObject({ service: "api", message: "hotfix" })
  })

  it("consumes a hyphen-leading token as a flag value — citty #171", async () => {
    const result = await captureJson(() =>
      deploy.cli.run(["push", "api", "--json", "--message", "-not-a-flag"])
    )
    expect(result).toMatchObject({ service: "api", message: "-not-a-flag" })
  })

  it("consumes a multi-token hyphenated string as one flag value — citty #171", async () => {
    const result = await captureJson(() =>
      deploy.cli.run(["push", "api", "--json", "--message", "-a 192.168.1.1 -b -c"])
    )
    expect(result).toMatchObject({ message: "-a 192.168.1.1 -b -c" })
  })
})

describe("boolean negation against defaults (citty parser)", () => {
  it("negates a default-true boolean with --no-", async () => {
    const opinionated = program({
      name: "opinionated",
      version: "0.0.1",
      description: "a default-true boolean",
      commands: {
        build: {
          description: "build with cache on by default",
          input: { cache: [["boolean", "@", { cli: "--cache" }], "=", true] },
          output: { cache: "boolean" },
          run: (input: { readonly cache: boolean }) => ({ cache: input.cache })
        }
      }
    })
    const on = await captureJson(() => opinionated.cli.run(["build", "--json"]))
    const off = await captureJson(() => opinionated.cli.run(["build", "--json", "--no-cache"]))
    expect(on).toMatchObject({ cache: true })
    expect(off).toMatchObject({ cache: false })
  })

  it("lets an explicit --flag=false beat a default of true", async () => {
    const opinionated = program({
      name: "opinionated2",
      version: "0.0.1",
      description: "explicit false over default true",
      commands: {
        build: {
          description: "build",
          input: { install: [["boolean", "@", { cli: "--install" }], "=", true] },
          output: { install: "boolean" },
          run: (input: { readonly install: boolean }) => ({ install: input.install })
        }
      }
    })
    const result = await captureJson(() => opinionated.cli.run(["build", "--json", "--install=false"]))
    expect(result).toMatchObject({ install: false })
  })
})

describe("parent flags before the subcommand (citty resolveSubCommand)", () => {
  it("routes past a declared value flag: --port 4000 start", async () => {
    const { code } = await captureCli(() => serve.cli.run(["--port", "4000", "start"]))
    expect(code).toBe(0)
  })

  it("routes past a declared value flag in = form: --port=4000 start", async () => {
    const { code } = await captureCli(() => serve.cli.run(["--port=4000", "start"]))
    expect(code).toBe(0)
  })

  it("routes past a declared short alias: -p 4000 stop", async () => {
    const result = await captureJson(() => serve.cli.run(["-p", "4000", "--json", "stop"]))
    expect(result).toMatchObject({ stopped: true })
  })

  it("a declared boolean does not swallow the subcommand name: --watch start", async () => {
    const result = await captureJson(() => serve.cli.run(["--watch", "--json", "start"]))
    expect(result).toMatchObject({ started: true })
  })

  it("still rejects an unknown flag before the subcommand", async () => {
    const { code, err } = await captureCli(() => serve.cli.run(["--bogus", "start"]))
    expect(code).toBe(2)
    expect(err).toMatch(/--bogus/)
  })

  it("carries a root narrow with its options into children", async () => {
    // an invariant over program-level values holds wherever they are
    // supplied — the merge model must not leak around it
    const traced = program({
      name: "traced",
      version: "0.0.0",
      description: "root invariant over program-level options",
      input: {
        trace: [["boolean", "@", { cli: "--trace" }], "=", false],
        "traceFile?": ["string", "@", { cli: "--trace-file" }]
      },
      narrow: (input, ctx) =>
        input.traceFile === undefined || input.trace ? true : ctx.mustBe("used with --trace"),
      commands: {
        build: {
          description: "build",
          output: { traced: "boolean" },
          // documented inference bound: a root narrow beside bare child
          // handlers trips TS2589 — annotate the handler input (README)
          run: (input: { readonly trace: boolean }) => ({ traced: input.trace })
        }
      }
    })
    const { code, err } = await captureCli(() => traced.cli.run(["build", "--trace-file", "out.log"]))
    expect(code).toBe(2)
    expect(err).toMatch(/--trace/)
    const paired = await captureJson(() =>
      traced.cli.run(["build", "--trace", "--trace-file", "out.log", "--json"])
    )
    expect(paired).toEqual({ traced: true })
  })

  it("fills a root option from its env variable when a child is invoked", async () => {
    const enved = program({
      name: "enved",
      version: "0.0.0",
      input: {
        region: [["string", "@", { cli: { usage: "--region", env: "ENVED_REGION" } }], "=", "us-east"]
      },
      commands: {
        deploy: {
          description: "deploy",
          output: { region: "string" },
          run: (input: { readonly region: string }) => ({ region: input.region })
        }
      }
    })
    process.env["ENVED_REGION"] = "eu-west"
    try {
      const result = await captureJson(() => enved.cli.run(["deploy", "--json"]))
      expect(result).toEqual({ region: "eu-west" })
    } finally {
      delete process.env["ENVED_REGION"]
    }
  })

  it("lets a declared --json flag beat the reserved meaning", async () => {
    // same rule as -h/--version: the program's vocabulary wins
    const jsonful = program({
      name: "jsonful",
      version: "0.0.0",
      commands: {
        emit: {
          description: "emit",
          input: { json: ["boolean", "@", { cli: "--json", default: false }] },
          output: { asJson: "boolean" },
          run: (input) => ({ asJson: input.json })
        }
      }
    })
    const { code, out } = await captureCli(() => jsonful.cli.run(["emit", "--json"]))
    expect(code).toBe(0)
    // the flag reached the handler; reserved json rendering did not fire
    expect(out).toMatch(/asJson/)
    expect(out).toMatch(/true/)
  })

  it("delivers a root flag's value to the routed child's handler", async () => {
    // citty's actual model: parent args MERGE into the subcommand. a
    // value the cli accepted must reach a handler — accepted-and-
    // discarded is silent data loss.
    const audited = program({
      name: "audited",
      version: "0.0.0",
      description: "root flags reach children",
      input: {
        registry: ["string", "@", { cli: "--registry", default: "https://npm.dev" }]
      },
      commands: {
        add: {
          description: "add",
          input: { pkg: ["string", "@", { cli: "<pkg>" }] },
          output: { pkg: "string", registry: "string" },
          run: (input) => ({ pkg: input.pkg, registry: input.registry })
        }
      }
    })
    const result = await captureJson(() =>
      audited.cli.run(["--registry", "https://corp.internal", "add", "x", "--json"])
    )
    expect(result).toEqual({ pkg: "x", registry: "https://corp.internal" })
    // the typed surface agrees
    expect(audited.add({ pkg: "y" })).toEqual({ pkg: "y", registry: "https://npm.dev" })
  })
})

describe("builtin token conflicts (citty main)", () => {
  it("hands -h to a command that declares it as an alias", async () => {
    const result = await captureJson(() => claimant.cli.run(["info", "--json", "-h", "example.com"]))
    expect(result).toMatchObject({ host: "example.com" })
  })

  it("keeps --help working when -h is claimed", async () => {
    const { code, out } = await captureCli(() => claimant.cli.run(["info", "--help"]))
    expect(code).toBe(0)
    expect(out).toMatch(/Usage:/)
  })

  it("hands --version to a command that declares it as its own flag", async () => {
    const result = await captureJson(() => claimant.cli.run(["info", "--json", "--version"]))
    expect(result).toMatchObject({ version: true })
  })

  it("prints the program version for bare --version", async () => {
    const { code, out } = await captureCli(() => claimant.cli.run(["--version"]))
    expect(code).toBe(0)
    expect(out).toBe("9.9.9")
  })
})

describe("empty and near-empty argv (citty main)", () => {
  it("renders help for a bare group invocation", async () => {
    const { code, out } = await captureCli(() => bake.cli.run([]))
    expect(code).toBe(0)
    expect(out).toMatch(/Usage:/)
  })
})

describe("subcommand aliases (citty main)", () => {
  const pm = program({
    name: "pm",
    version: "1.0.0",
    description: "a package-manager-shaped cli",
    commands: {
      install: {
        description: "install packages",
        cli: { alias: ["i", "add"] },
        output: { via: "string" },
        run: () => ({ via: "install" })
      },
      workspace: {
        description: "workspace operations",
        cli: { alias: "ws" },
        commands: {
          list: {
            description: "list workspaces",
            cli: { alias: "ls" },
            output: { via: "string" },
            run: () => ({ via: "workspace list" })
          }
        }
      }
    }
  })

  it("resolves a single alias", async () => {
    const result = await captureJson(() => pm.cli.run(["i", "--json"]))
    expect(result).toMatchObject({ via: "install" })
  })

  it("resolves any alias from a list", async () => {
    const result = await captureJson(() => pm.cli.run(["add", "--json"]))
    expect(result).toMatchObject({ via: "install" })
  })

  it("resolves nested aliases level by level", async () => {
    const result = await captureJson(() => pm.cli.run(["ws", "ls", "--json"]))
    expect(result).toMatchObject({ via: "workspace list" })
  })

  it("shows aliases beside the real name in help", () => {
    expect(pm.cli.help()).toMatch(/install, i, add/)
    expect(pm.cli.help()).toMatch(/workspace, ws/)
  })

  it("resolves aliases in a help path the way the parser does", () => {
    // `pm ws ls` runs, so `pm.cli.help(["ws"])` must be workspace help,
    // not "unknown command"
    expect(pm.cli.help(["ws"])).toMatch(/list workspaces/)
    expect(pm.cli.help(["ws", "ls"])).toMatch(/list workspaces/)
    expect(pm.cli.help(["ws"])).not.toMatch(/unknown command/)
  })

  it("completes through an alias the way the parser routes it", async () => {
    // the parser accepts `pm ws l<TAB>` — completion must agree
    await expect(pm.cli.complete(["workspace", ""])).resolves.toContain("list")
    await expect(pm.cli.complete(["ws", ""])).resolves.toContain("list")
  })

  it("rejects an alias colliding with a sibling's real name at declaration time", () => {
    expect(() =>
      program({
        name: "clash",
        version: "0.0.0",
        commands: {
          install: { description: "a", cli: { alias: "i" }, run: (): string => "a" },
          i: { description: "b", run: (): string => "b" }
        }
      })
    ).toThrow(/subcommand name i is claimed by install and i/)
  })
})

describe("root run beside subcommands", () => {
  // the shape `docker` or `deno` ships: the bare name does real work,
  // named children do more
  const fmt = program({
    name: "fmt",
    version: "1.0.0",
    description: "format, with a check mode as a child",
    input: {
      write: ["boolean", "@", { cli: "--write", default: false }]
    },
    output: { via: "string", write: "boolean" },
    run: (input) => ({ via: "root", write: input.write }),
    commands: {
      check: {
        description: "check only",
        output: { via: "string" },
        run: () => ({ via: "check" })
      }
    }
  })

  it("runs the root handler on a bare invocation", async () => {
    const result = await captureJson(() => fmt.cli.run(["--json"]))
    expect(result).toEqual({ via: "root", write: false })
  })

  it("binds root flags on the bare invocation", async () => {
    const result = await captureJson(() => fmt.cli.run(["--write", "--json"]))
    expect(result).toEqual({ via: "root", write: true })
  })

  it("still routes a named child", async () => {
    const result = await captureJson(() => fmt.cli.run(["check", "--json"]))
    expect(result).toEqual({ via: "check" })
  })

  it("keeps --help describing both the root and its children", async () => {
    const { code, out } = await captureCli(() => fmt.cli.run(["--help"]))
    expect(code).toBe(0)
    expect(out).toMatch(/--write/)
    expect(out).toMatch(/check/)
  })
})

describe("default subcommand (citty main)", () => {
  const dev = program({
    name: "devkit",
    version: "1.0.0",
    description: "a vite-shaped cli",
    cli: { default: "dev" },
    commands: {
      dev: {
        description: "start dev mode",
        input: { watch: ["boolean", "@", { cli: "--watch", default: false }] },
        output: { via: "string", watch: "boolean" },
        run: (input) => ({ via: "dev", watch: input.watch })
      },
      build: {
        description: "build once",
        output: { via: "string" },
        run: () => ({ via: "build" })
      }
    }
  })

  it("runs the default child on a bare invocation", async () => {
    const result = await captureJson(() => dev.cli.run(["--json"]))
    expect(result).toMatchObject({ via: "dev" })
  })

  it("still runs an explicitly named child", async () => {
    const result = await captureJson(() => dev.cli.run(["build", "--json"]))
    expect(result).toMatchObject({ via: "build" })
  })

  it("hands remaining flags to the default child", async () => {
    const result = await captureJson(() => dev.cli.run(["--watch", "--json"]))
    expect(result).toMatchObject({ via: "dev", watch: true })
  })

  it("completes the default child's flags at the group level", async () => {
    // completion must agree with the parser: `devkit --watch` runs, so
    // `devkit --w<TAB>` must offer --watch
    await expect(dev.cli.complete(["--w"])).resolves.toContain("--watch")
  })

  it("keeps --help aimed at the group itself", async () => {
    const { code, out } = await captureCli(() => dev.cli.run(["--help"]))
    expect(code).toBe(0)
    expect(out).toMatch(/Commands:/)
    expect(out).toMatch(/build/)
  })

  it("rejects a default beside an own run at declaration time", () => {
    expect(() =>
      program({
        name: "both",
        version: "0.0.0",
        cli: { default: "dev" },
        run: () => "root",
        commands: { dev: { description: "d", run: () => "dev" } }
      })
    ).toThrow(/cannot declare both run and cli.default/)
  })

  it("accepts a default named by its alias — one resolver everywhere", async () => {
    // a consumer writes `default: "ls"` as naturally as `pm ls` — the
    // resolver that routes it must also validate it
    const aliased = program({
      name: "aliased",
      version: "0.0.0",
      cli: { default: "ls" },
      commands: {
        list: {
          description: "list",
          cli: { alias: "ls" },
          output: { via: "string" },
          run: () => ({ via: "list" })
        }
      }
    })
    const result = await captureJson(() => aliased.cli.run(["--json"]))
    expect(result).toEqual({ via: "list" })
  })

  it("rejects a default naming a missing child at declaration time", () => {
    expect(() =>
      program({
        name: "missing",
        version: "0.0.0",
        cli: { default: "nope" },
        commands: { dev: { description: "d", run: () => "dev" } }
      })
    ).toThrow(/cli.default names a missing subcommand: nope/)
  })
})
