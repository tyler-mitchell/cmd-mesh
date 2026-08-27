import { describe, expect, it } from "vitest"
import { external, program } from "../src/index.js"

// Lifecycle and process execution under pressure.
//
// Every module allocates an Effect runtime and every handler can spawn
// children. A long-lived process — an MCP server, a watch mode, a test
// harness importing the module — depends on those resources being
// releasable, concurrent calls being independent, and child output not
// being truncated.

const makeCounter = () =>
  program({
    name: "counter",
    version: "1.0.0",
    description: "count invocations",
    commands: {
      inc: {
        description: "return the number it was given",
        input: { by: { type: "string.integer.parse = '1'", cli: "--by" } },
        output: { value: "number" },
        run: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 1))
          return { value: input.by }
        }
      }
    }
  })

const shell = program({
  name: "shell",
  version: "1.0.0",
  description: "commands that spawn children",
  commands: {
    echo: {
      description: "echo through a child process",
      input: { text: { type: "string", cli: "<text>" } },
      run: async (_input, ctx) => {
        const result = await ctx.exec("printf", ["%s", _input.text])
        return { stdout: result.stdout, exitCode: result.exitCode }
      }
    },
    search: {
      description: "grep, whose exit code 1 means no match",
      run: async (_input, ctx) => {
        const result = await ctx.exec("grep", ["definitely-absent-pattern", "/dev/null"])
        return { exitCode: result.exitCode, stdout: result.stdout }
      }
    },
    bulk: {
      description: "produce a megabyte of child output",
      run: async (_input, ctx) => {
        const result = await ctx.exec("node", ["-e", "process.stdout.write('x'.repeat(1000000))"])
        return { length: result.stdout.length, exitCode: result.exitCode }
      }
    },
    slow: {
      description: "a child that outlives its timeout",
      run: async (_input, ctx) => {
        const started = Date.now()
        try {
          await ctx.exec("sleep", ["5"], { timeoutMs: 200 })
          return { timedOut: false, elapsed: Date.now() - started }
        } catch {
          return { timedOut: true, elapsed: Date.now() - started }
        }
      }
    },
    where: {
      description: "report a child's working directory",
      run: async (_input, ctx) => {
        const result = await ctx.exec("pwd", [], { cwd: "/tmp" })
        return { cwd: result.stdout.trim() }
      }
    }
  }
})

describe("runtime disposal", () => {
  it("releases its runtime and refuses further work", async () => {
    const counter = makeCounter()
    await expect(counter.inc({ by: 2 })).resolves.toEqual({ value: 2 })
    await counter.dispose()
    // a disposed module must fail promptly, not hang the caller
    await expect(
      Promise.race([
        counter.inc({ by: 2 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("hung after dispose")), 1000))
      ])
    ).rejects.toThrow()
  })

  it("tolerates being disposed twice", async () => {
    const counter = makeCounter()
    await counter.dispose()
    await expect(counter.dispose()).resolves.not.toThrow()
  })

  it("gives an external module a way to release its runtime", async () => {
    // external() allocates a ManagedRuntime exactly as program() does;
    // without a release hook a long-lived host leaks one per module
    const lister = external({
      name: "lister",
      bin: "echo",
      commands: { show: { description: "echo something", output: "string" } }
    })
    expect(typeof (lister as unknown as { dispose?: unknown }).dispose).toBe("function")
    await (lister as unknown as { dispose(): Promise<void> }).dispose()
  })
})

describe("concurrent invocation", () => {
  it("keeps parallel calls of one command independent", async () => {
    const counter = makeCounter()
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => counter.inc({ by: i }))
    )
    expect(results.map((r) => r.value)).toEqual(Array.from({ length: 50 }, (_, i) => i))
    await counter.dispose()
  })

  it("keeps parallel child processes independent", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => shell.echo({ text: `run-${i}` }))
    )
    expect(results.map((r: any) => r.stdout)).toEqual(
      Array.from({ length: 12 }, (_, i) => `run-${i}`)
    )
  })
})

describe("child process behavior", () => {
  it("reports a nonzero exit code instead of failing", async () => {
    // grep's 1-means-no-match is the canonical case the contract calls out
    const result = await shell.search() as { exitCode: number }
    expect(result.exitCode).toBe(1)
  })

  it("captures large child output without truncating", async () => {
    const result = await shell.bulk() as { length: number; exitCode: number }
    expect(result.exitCode).toBe(0)
    expect(result.length).toBe(1000000)
  })

  it("kills a child that exceeds its timeout", async () => {
    const result = await shell.slow() as { timedOut: boolean; elapsed: number }
    expect(result.timedOut).toBe(true)
    expect(result.elapsed).toBeLessThan(2000)
  })

  it("honors the declared working directory", async () => {
    const result = await shell.where() as { cwd: string }
    expect(result.cwd).toMatch(/tmp/)
  })

  it("surfaces a missing binary as a handler failure", async () => {
    const broken = program({
      name: "broken",
      version: "1.0.0",
      commands: {
        go: {
          description: "spawn a binary that does not exist",
          run: async (_input, ctx) => ctx.exec("definitely-not-a-binary-xyz", [])
        }
      }
    })
    await expect(broken.go()).rejects.toThrow(/definitely-not-a-binary-xyz/)
    await broken.dispose()
  })
})

describe("mounted modules", () => {
  it("carries the mount marker on a callable program module", async () => {
    // localizes the mount failure below: the marker is present, so the
    // parent's mount detection is what fails to see it — a program module
    // is a function, an external module is a plain object
    const leaf = program({
      name: "leaf",
      version: "1.0.0",
      description: "a mountable leaf",
      commands: {
        ping: { description: "ping", output: { ok: "boolean" }, run: () => ({ ok: true }) }
      }
    })
    const marker = Symbol.for("cmd-mesh/mounted")
    expect(typeof leaf).toBe("function")
    expect(marker in (leaf as unknown as object)).toBe(true)
    await leaf.dispose()
  })

  it("keeps a mounted subprogram callable through its parent", async () => {
    const cache = program({
      name: "cache",
      version: "1.0.0",
      description: "cache operations",
      commands: {
        clear: {
          description: "clear the cache",
          output: { cleared: "boolean" },
          run: () => ({ cleared: true })
        }
      }
    })
    const host = program({
      name: "host",
      version: "1.0.0",
      description: "hosts a mounted subprogram",
      commands: { cache }
    })
    await expect(host.cache.clear()).resolves.toEqual({ cleared: true })
    expect(host.mcp.tools.map((t) => t.name)).toContain("host_cache_clear")
    await host.dispose()
    await cache.dispose()
  })

  it("mounts the same subprogram under two names without crosstalk", async () => {
    const leaf = program({
      name: "leaf",
      version: "1.0.0",
      description: "a mountable leaf",
      commands: {
        ping: { description: "ping", output: { ok: "boolean" }, run: () => ({ ok: true }) }
      }
    })
    const host = program({
      name: "host",
      version: "1.0.0",
      description: "mounts one subprogram twice",
      commands: { primary: leaf, secondary: leaf }
    })
    const names = host.mcp.tools.map((t) => t.name)
    expect(names).toContain("host_primary_ping")
    expect(names).toContain("host_secondary_ping")
    await host.dispose()
    await leaf.dispose()
  })
})
