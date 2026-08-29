import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { spawn } from "node:child_process"
import { describe, expect, it } from "vitest"
import { program } from "../src/index.js"

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

describe("the mcp server's lifecycle", () => {
  // the real regression is stdio-only, so the witness has to spawn a
  // bin: an in-memory pair closes both ends itself and would pass even
  // with the server waiting forever
  it("exits 0 when its client closes stdin", async () => {
    const bin = new URL("../examples/bin.ts", import.meta.url).pathname
    const child = spawn("node", ["--import", "tsx", bin, "mcp"], { stdio: ["pipe", "pipe", "pipe"] })
    child.stdin.end()
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve))
    expect(code).toBe(0)
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
