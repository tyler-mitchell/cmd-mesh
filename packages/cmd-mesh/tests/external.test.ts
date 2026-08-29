import { describe, expect, it } from "vitest"
import { external, program } from "../src/index.js"
import { ExternalExit, InvalidDeclaration } from "../src/errors.js"
import { captureCli } from "./fixtures/capture.js"

// Wrapped binaries.
//
// `external()` reconstructs argv from parsed values and hands it to a real
// process. What matters is that reconstruction: token order, boolean
// presence, global options, exit codes, and whether a broken declaration
// reports everything wrong with it at once.

describe("argv reconstruction", () => {
  const git = external({
    name: "git",
    description: "the git binary",
    commands: {
      status: {
        description: "working tree status",
        input: {
          short: { type: "boolean", cli: "--short, -s" },
          branch: { type: "boolean", cli: "--branch, -b" }
        },
        output: "string"
      },
      revParse: {
        description: "resolve a revision",
        input: {
          rev: { type: "string", cli: "<rev>" },
          verify: { type: "boolean", cli: "--verify" }
        },
        output: "string"
      },
      "rev-parse": {
        description: "resolve a revision, spelled as the binary spells it",
        input: {
          verify: { type: "boolean", cli: "--verify" },
          rev: { type: "string", cli: "<rev>" }
        },
        output: "string"
      }
    }
  })

  it("runs the binary and applies the stdout contract", async () => {
    await expect(git.status({ short: true })).resolves.toBeTypeOf("string")
  })

  it("repeats a repeatable flag per value — the convention binaries speak", async () => {
    const probe = external({
      name: "probe",
      bin: "echo",
      commands: {
        mark: {
          description: "echo argv",
          input: {
            tag: { type: "string", cli: "--tag <tags...>" },
            item: { type: "string", cli: "<item>" }
          },
          output: "string"
        }
      }
    })
    await expect(probe.mark({ item: "x", tag: ["a", "b"] }))
      .resolves.toBe("mark --tag a --tag b x\n")
  })

  it("forwards variadic positional values in order", async () => {
    const probe = external({
      name: "probe2",
      bin: "echo",
      commands: {
        say: {
          description: "echo argv",
          input: { words: { type: "string", cli: "<...words>" } },
          output: "string"
        }
      }
    })
    await expect(probe.say({ words: ["one", "two", "three"] }))
      .resolves.toBe("say one two three\n")
  })

  it("emits exactly the argv the values imply — false booleans vanish", async () => {
    // echo prints its argv back: the reconstruction is observed
    // directly, not inferred from two outputs differing
    const probe = external({
      name: "probe",
      bin: "echo",
      commands: {
        run: {
          description: "echo argv",
          input: {
            branch: { type: "boolean", cli: "--branch" },
            short: { type: "boolean", cli: "--short" }
          },
          output: "string"
        }
      }
    })
    await expect(probe.run({ short: true, branch: false })).resolves.toBe("run --short\n")
    await expect(probe.run({ short: true, branch: true })).resolves.toBe("run --branch --short\n")
  })

  it("maps a camelCase command key to the binary's hyphenated subcommand", async () => {
    // `revParse` is the only spelling that stays dot-callable in JS; it has
    // to reach the binary as `rev-parse`, the way derived flags kebab-case
    await expect(git.revParse({ rev: "HEAD", verify: true })).resolves.toMatch(/^[0-9a-f]{40}/)
  })

  it("places flags where the binary expects them relative to positionals", async () => {
    // `git rev-parse --verify HEAD` is the documented order
    await expect(git["rev-parse"]({ rev: "HEAD", verify: true })).resolves.toMatch(/^[0-9a-f]{40}/)
  })

  it("reports a nonzero exit with the binary's own diagnostics", async () => {
    await expect(git["rev-parse"]({ rev: "definitely-not-a-ref", verify: true }))
      .rejects.toThrow(/exited with/)
  })
})

describe("mounted modules through the parent cli", () => {
  const echo = external({
    name: "echo",
    description: "print arguments",
    bin: "echo",
    commands: {
      say: {
        description: "print a word",
        input: {
          word: {
            type: "string",
            suggest: ["hello", "world"],
            cli: "<word>"
          }
        },
        output: "string"
      }
    }
  })

  const host = program({
    name: "host",
    version: "0.0.0",
    description: "mounts a program and an external",
    commands: {
      inner: program({
        name: "inner",
        version: "0.0.0",
        commands: {
          ping: { description: "ping", output: { pong: "boolean" }, run: () => ({ pong: true }) }
        }
      }),
      echo
    }
  })

  it("routes argv into a mounted program's command", async () => {
    const { code, out } = await captureCli(() => host.cli.run(["inner", "ping", "--json"]))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ pong: true })
  })

  it("routes argv into a mounted external and runs the binary", async () => {
    // the external's own subcommand path (`say`) reaches the binary,
    // the mesh mount token (`echo`) does not
    const { code, out } = await captureCli(() => host.cli.run(["echo", "say", "hi"]))
    expect(code).toBe(0)
    expect(out).toBe("say hi\n")
  })

  it("completes a mounted external's parameter suggestions", async () => {
    await expect(host.cli.complete(["echo", "say", ""])).resolves.toContain("hello")
  })

  it("shows mounted commands in the parent's help", () => {
    expect(host.cli.help()).toMatch(/inner/)
    expect(host.cli.help()).toMatch(/echo/)
  })

  it("keeps a declared success exit a success through the parent cli", async () => {
    const searcher = external({
      name: "searcher",
      bin: "git",
      commands: {
        grep: {
          description: "search",
          successCodes: [0, 1],
          input: { pattern: { type: "string", cli: "<pattern>" } },
          output: "string"
        }
      }
    })
    const mounted = program({ name: "host2", version: "0.0.0", commands: { searcher } })
    const absent = ["zz-never", "matches-zz", "31415"].join("-")
    const { code } = await captureCli(() => mounted.cli.run(["searcher", "grep", absent]))
    expect(code).toBe(0)
  })

  it("reports an output-contract violation naming the command, not raw arktype", async () => {
    const counter = external({
      name: "counter",
      bin: "echo",
      commands: {
        count: {
          description: "count",
          input: { word: { type: "string", cli: "<word>" } },
          output: "string.numeric.parse"
        }
      }
    })
    // echo prints "count not-a-number" — the stdout contract must reject
    // it through the exported error with a readable message
    await expect(counter.count({ word: "not-a-number" })).rejects.toThrow(/output contract violated/)
  })

  it("reconstructs a two-level subcommand tree in order", async () => {
    // the `docker compose up` shape: nested externals kebab their whole
    // argPath and keep flags after the deepest word
    const compose = external({
      name: "compose",
      bin: "echo",
      commands: {
        stack: {
          description: "stack ops",
          commands: {
            up: {
              description: "bring up",
              input: { detach: { type: "boolean", cli: "--detach, -d" } },
              output: "string"
            }
          }
        }
      }
    })
    await expect(compose.stack.up({ detach: true })).resolves.toBe("stack up --detach\n")
  })

  it("rejects a command redefining a binary-global key at declaration time", () => {
    // `-C` meaning two things in one invocation is undiagnosable at a
    // distance — silent own-wins would ship the wrong argv
    expect(() =>
      external({
        name: "clash",
        input: { dir: { type: "string", cli: "-C" } },
        commands: {
          run: {
            description: "run",
            input: { dir: { type: "string", cli: "-C" } },
            output: "string"
          }
        }
      })
    ).toThrow(/dir/)
  })

  it("projects an external's annotations and examples", () => {
    const backup = external({
      name: "backup",
      bin: "echo",
      commands: {
        wipe: {
          description: "destructive wipe",
          cli: { examples: ["backup wipe --confirm"] },
          mcp: { annotations: { destructiveHint: true } },
          input: { confirm: { type: "boolean", cli: "--confirm" } },
          output: "string"
        }
      }
    })
    const mounted = program({ name: "host3", version: "0.0.0", commands: { backup } })
    const tool = mounted.mcp.tools.find((t) => t.name === "host3_backup_wipe")!
    expect(tool.annotations).toEqual({ destructiveHint: true })
    expect(mounted.cli.help(["backup", "wipe"])).toMatch(/backup wipe --confirm/)
  })
})

describe("global versus command options (level = placement)", () => {
  // the binary's own documentation model: root input declares global
  // options (emitted before the subcommand), command input declares the
  // command's own options (emitted after it)
  const git = external({
    name: "git",
    input: {
      repo: { type: "string", description: "run as if started in this directory", cli: "-C" }
    },
    commands: {
      status: {
        description: "working tree status",
        input: { short: { type: "boolean", cli: "--short" } },
        output: "string"
      },
      log: {
        description: "commit log",
        input: { count: { type: "string.integer.parse = '2'", cli: "-n" } },
        output: "string"
      }
    }
  })

  it("emits a root-level option before the subcommand", async () => {
    // `git -C <dir> status --short` — pointing -C at a non-repository
    // must fail, proving the option actually reached the binary
    await expect(git.status({ repo: process.cwd(), short: true })).resolves.toBeTypeOf("string")
    await expect(git.status({ repo: "/", short: true })).rejects.toThrow(/exited with/)
  })

  it("emits a command-level value option after the subcommand", async () => {
    // `git log -n 2` — a command-scoped value option must never migrate
    // in front of `log` (finding 49): misplaced, git errors outright.
    // a shallow CI clone may hold fewer than 2 commits, so the pin is
    // the -n ceiling, not an exact count
    const log = await git.log({})
    const commits = log.split("\n").filter((line) => line.startsWith("commit ")).length
    expect(commits).toBeGreaterThanOrEqual(1)
    expect(commits).toBeLessThanOrEqual(2)
  })

  it("combines both levels in one invocation", async () => {
    const log = await git.log({ repo: process.cwd(), count: 1 })
    expect(log.split("\n").filter((line) => line.startsWith("commit ")).length).toBe(1)
  })
})

describe("per-invocation execution options", () => {
  it("runs the binary in a caller-chosen working directory", async () => {
    const git = external({
      name: "git",
      commands: {
        "rev-parse": {
          description: "resolve",
          input: { toplevel: { type: "boolean", cli: "--show-toplevel" } },
          output: "string"
        }
      }
    })
    // a cwd outside any repository must fail, proving the option
    // actually reached the spawn; omitting it keeps working here
    await expect(git["rev-parse"]({ toplevel: true })).resolves.toBeTypeOf("string")
    await expect(git["rev-parse"]({ toplevel: true }, { cwd: "/" })).rejects.toThrow(/exited with/)
  })
})

describe("expected exit codes", () => {
  const git = external({
    name: "git",
    commands: {
      grep: {
        description: "search tracked files",
        successCodes: [0, 1],
        input: {
          pattern: { type: "string", cli: "<pattern>" },
          path: { type: "string", cli: "[path]" }
        },
        output: "string"
      }
    }
  })

  it("treats a declared success code as data, not failure", async () => {
    // `git grep` exits 1 on no match — the canonical case; with
    // successCodes it resolves to the (empty) stdout contract. the
    // pattern is assembled so this file itself can never match it.
    const absent = ["zz-never", "present-zz", "9847"].join("-")
    await expect(git.grep({ pattern: absent })).resolves.toBe("")
  })

  it("still fails on codes outside the declared set", async () => {
    // a nonexistent pathspec makes git grep exit 128, outside [0, 1]
    // The class is the contract: callers catch ExternalExit by type.
    const failure = await git.grep({ pattern: "x", path: "definitely/not/here-xyz" })
      .then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(ExternalExit)
    expect(`${failure}`).toMatch(/exited with/)
  })
})

describe("external declaration validation", () => {
  it("reports every problem across the whole declaration at once", () => {
    try {
      external({
        name: "tool",
        commands: {
          first: { input: { bad: { type: "not.a.keyword" } } },
          second: {
            input: {
              a: { type: "string", cli: "--same" },
              b: { type: "string", cli: "--same" }
            }
          }
        }
      })
      expect.unreachable("expected an InvalidDeclaration")
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidDeclaration)
      const message = (error as InvalidDeclaration).message
      expect(message).toMatch(/not\.a\.keyword/)
      expect(message).toMatch(/--same is claimed by a and b/)
    }
  })

  // This error was in repo-ops. It stopped the completion for git add.
  it("rejects a misspelled parameter field the compiler cannot see", () => {
    expect(() =>
      external({
        name: "tool",
        commands: {
          add: { input: { paths: { type: "string", cli: { usage: "<...paths>", complete: "filepaths" } } } }
        }
      })
    ).toThrow(/CMSH1013.*cli\.complete/s)
  })

  // TypeScript rejects this field. A JavaScript caller has no check.
  it("rejects a misspelled mcp field instead of exposing the command", () => {
    expect(() =>
      external({
        name: "tool",
        commands: { secret: { description: "internal", mcp: { hiden: true } } }
      } as never)
    ).toThrow(/CMSH1013.*mcp\.hiden/s)
  })

  it("rejects a misspelled command field", () => {
    expect(() =>
      external({ name: "tool", commands: { go: { description: "go", saftey: "read" } } })
    ).toThrow(/CMSH1013.*saftey/s)
  })

  it("takes a bare type string as a whole parameter and derives its flag", async () => {
    const probe = external({
      name: "probe-bare",
      bin: "echo",
      commands: {
        mark: { input: { short: "boolean", tag: "string" }, output: "string" }
      }
    })
    await expect(probe.mark({ short: true, tag: "x" })).resolves.toBe("mark --short --tag x\n")
  })

  it("names the exit code without a dangling colon when stderr was streamed", async () => {
    const { ExternalExit } = await import("../src/errors.js")
    const streamed = new ExternalExit({ bin: "pnpm", args: [], exitCode: 1, stderr: "" })
    expect(streamed.message).toBe("pnpm exited with 1")
    const captured = new ExternalExit({ bin: "git", args: [], exitCode: 128, stderr: "fatal: bad\n" })
    expect(captured.message).toBe("git exited with 128: fatal: bad")
  })

  it("rejects a suggestion source that lists nothing", () => {
    expect(() =>
      external({
        name: "tool",
        commands: { add: { input: { paths: { type: "string", suggest: "flepaths", cli: "<paths>" } } } }
      })
    ).toThrow(/CMSH1014.*flepaths/s)
  })

  it("anchors every issue at its own errors reference section", () => {
    expect(() =>
      external({
        name: "tool",
        commands: { add: { input: { paths: { type: "string", suggest: "flepaths", cli: "<paths>" } } } }
      })
    ).toThrow(/docs\/errors\.md#cmsh1014/)
  })

  it("rejects a misspelled descriptor field", () => {
    expect(() =>
      external({
        name: "tool",
        commands: { go: { input: { where: { type: "string", sugest: "folders", cli: "<where>" } } } }
      })
    ).toThrow(/CMSH1013.*sugest/s)
  })
})

describe("externals mounted in a program", () => {
  const git = external({
    name: "git",
    commands: {
      status: {
        description: "working tree status",
        input: { short: { type: "boolean", cli: "--short, -s" } },
        output: "string"
      }
    }
  })

  const repo = program({
    name: "repo",
    version: "1.0.0",
    description: "repository tools",
    commands: { git }
  })

  it("stays callable through the parent module", async () => {
    await expect(repo.git.status({ short: true })).resolves.toBeTypeOf("string")
  })

  it("routes through the parent cli", async () => {
    const { code } = await captureCli(() => repo.main(["git", "status", "--short"]))
    expect(code).toBe(0)
  })

  it("contributes its commands to the parent's mcp tools", () => {
    expect(repo.mcp.tools.map((t) => t.name)).toContain("repo_git_status")
  })

  it("keeps the external mount root out of the tool list", () => {
    expect(repo.mcp.tools.map((t) => t.name)).not.toContain("repo_git")
  })
})
