import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { getPath } from "package-management"
import { describe, expect, it } from "vitest"
import { program } from "../src/index.js"
import { captureCli } from "./fixtures/capture.js"

// A host starts an mcp server as a child process and closes its stdin
// to stop it. `serve()` must RESOLVE there: a server that waited
// forever left main() unsettled, and node exits 13 on an unsettled
// top-level await — which every supervisor reads as a crash.

const tool = program({
  name: "tool",
  version: "1.0.0",
  commands: {
    greet: {
      description: "greet someone",
      safety: "read",
      input: { name: ["string", "@", { cli: "<name>" }] },
      output: { text: "string" },
      run: (input) => ({ text: `hello ${input.name}` })
    }
  }
})

describe("advertising the mcp surface", () => {
  it("names mcp in the composed bin's help", async () => {
    const { out } = await captureCli(() => tool.main(["--help"]))
    expect(out).toMatch(/^ {2}mcp {25}serve this program to agents over stdio$/m)
    expect(out).toMatch(/^ {2}mcp install {17}register this program with an editor$/m)
  })

  it("stays silent about mcp in a cli-only bin's help", async () => {
    // `cli.run()` serves no agents, so naming mcp there would be a lie
    const { out } = await captureCli(() => tool.cli.run(["--help"]))
    expect(out).toContain("complete <shell>")
    expect(out).not.toMatch(/\bmcp\b/)
  })
})

describe("the mcp server's lifecycle", () => {
  // the real regression is stdio-only, so the witness has to spawn a
  // bin: an in-memory pair closes both ends itself and would pass even
  // with the server waiting forever
  it("exits 0 when its client closes stdin", async () => {
    const bin = getPath({ to: "<package_folder>/examples/bin.ts" })
    // the program's own process affordance, which reports the exit code
    // rather than throwing on it
    const runner = program({
      name: "runner",
      commands: {
        boot: {
          description: "start the bin with no input at all",
          // stdin: "ignore" IS the client going away — the server sees
          // end-of-input immediately
          run: (_input, ctx) =>
            ctx.exec("node", ["--import", "tsx", bin, "mcp"], {
              stdin: "ignore",
              timeoutMs: 25_000
            })
        }
      }
    })
    const result = await runner.boot()
    expect(result.exitCode).toBe(0)
  }, 30_000)

  it("serves its tools over a real client before closing", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await tool.mcp.server().connect(serverTransport)
    const client = new Client({ name: "probe", version: "0.0.0" })
    await client.connect(clientTransport)

    const listed = await client.listTools()
    expect(listed.tools.map((t) => t.name)).toEqual(["tool_greet", "tool_spec"])

    const called = await client.callTool({ name: "tool_greet", arguments: { name: "world" } })
    expect(called.structuredContent).toEqual({ text: "hello world" })
    await client.close()
  })
})
