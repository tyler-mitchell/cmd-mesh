import { createFile, defineFileSystemStorage, getPath } from "package-management"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  detectMcpClient,
  installMcpClient,
  mcpClientIds,
  mcpDevInvocation,
  mcpInvocation,
  uninstallMcpClient
} from "../src/install.js"

// a fixed invocation keeps these cases about the FILES; what a client
// must spawn is its own concern, covered separately below
const invocation = { command: "mytool", args: ["mcp"] } as const

// `mcp install` edits the user's own editor settings, so every case here
// asserts that what was already in the file is still there afterwards.
// A fake home keeps the globally-scoped clients off the real one.

const root = getPath({ to: `<user_tmpdir>/cmd-mesh-install-${process.pid}` })
const home = `${root}/home`
const project = `${root}/project`

const projectFs = defineFileSystemStorage({ base: project })
const homeFs = defineFileSystemStorage({ base: home })

const enteredFrom = process.cwd()
const realHome = process.env["HOME"]

const read = async (base: typeof projectFs, key: string): Promise<string> => {
  const value = await base.storage.getItem(key)
  return typeof value === "string" ? value : JSON.stringify(value)
}

beforeAll(async () => {
  // seeding a file is what brings each base directory into existence
  // a real package, so <package_folder> resolves here rather than to
  // whatever encloses the temp directory
  createFile(`${project}/package.json`, `{"name":"probe","version":"0.0.0"}\n`)
  createFile(`${home}/.codex/.keep`, "")
  process.env["HOME"] = home
  process.chdir(project)
})

afterAll(async () => {
  process.chdir(enteredFrom)
  if (realHome === undefined) delete process.env["HOME"]
  else process.env["HOME"] = realHome
  await projectFs.deleteFileSystem()
  await homeFs.deleteFileSystem()
})

describe("registering with each client", () => {
  it("writes claude's project file", async () => {
    installMcpClient("mytool", invocation, "claude")
    expect(JSON.parse(await read(projectFs, ".mcp.json"))).toEqual({
      mcpServers: { mytool: { command: "mytool", args: ["mcp"] } }
    })
  })

  it("writes cursor's project file", async () => {
    installMcpClient("mytool", invocation, "cursor")
    expect(JSON.parse(await read(projectFs, ".cursor/mcp.json"))).toEqual({
      mcpServers: { mytool: { command: "mytool", args: ["mcp"] } }
    })
  })

  it("names the transport for vscode, which asks for it", async () => {
    installMcpClient("mytool", invocation, "vscode")
    expect(JSON.parse(await read(projectFs, ".vscode/mcp.json"))).toEqual({
      servers: { mytool: { type: "stdio", command: "mytool", args: ["mcp"] } }
    })
  })

  it("writes windsurf's home file", async () => {
    const file = installMcpClient("mytool", invocation, "windsurf")
    expect(file.startsWith(home)).toBe(true)
    expect(JSON.parse(await read(homeFs, ".codeium/windsurf/mcp_config.json"))).toMatchObject({
      mcpServers: { mytool: { command: "mytool", args: ["mcp"] } }
    })
  })

  it("covers every declared client", () => {
    expect(mcpClientIds).toEqual(["claude", "cursor", "vscode", "windsurf", "codex"])
  })
})

describe("keeping what the file already holds", () => {
  it("leaves another server's json entry alone", async () => {
    createFile(`${project}/.mcp.json`, `{"mcpServers":{"other":{"command":"other-bin"}}}`)
    installMcpClient("mytool", invocation, "claude")
    expect(JSON.parse(await read(projectFs, ".mcp.json")).mcpServers).toEqual({
      other: { command: "other-bin" },
      mytool: { command: "mytool", args: ["mcp"] }
    })
  })

  it("leaves a toml file's comments and entries intact", async () => {
    createFile(
      `${home}/.codex/config.toml`,
      `# my own note\nmodel = "gpt-5"\n\n[mcp_servers."existing"]\ncommand = "existing-bin"\n`
    )
    installMcpClient("mytool", invocation, "codex")
    const after = await read(homeFs, ".codex/config.toml")
    expect(after).toContain("# my own note")
    expect(after).toContain('[mcp_servers."existing"]')
    expect(after).toContain('[mcp_servers."mytool"]')
  })

  it("does not register a toml entry twice", async () => {
    installMcpClient("mytool", invocation, "codex")
    installMcpClient("mytool", invocation, "codex")
    const after = await read(homeFs, ".codex/config.toml")
    expect(after.match(/\[mcp_servers\."mytool"\]/g)).toHaveLength(1)
  })

  // a moved project or a new interpreter leaves the stored command
  // unspawnable; re-running the install has to repair it
  it("replaces a stale toml entry rather than leaving it", async () => {
    createFile(
      `${home}/.codex/config.toml`,
      `# my own note\n\n[mcp_servers."mytool"]\ncommand = "/old/stale/node"\nargs = ["/old/bin.js", "mcp"]\n\n[mcp_servers."other"]\ncommand = "other-bin"\n`
    )
    installMcpClient("mytool", { command: "/new/node", args: ["/new/bin.js", "mcp"] }, "codex")
    const after = await read(homeFs, ".codex/config.toml")
    expect(after).toContain(`command = "/new/node"`)
    expect(after).not.toContain("/old/stale/node")
    expect(after).toContain("# my own note")
    expect(after).toContain('[mcp_servers."other"]')
    // the blank line between tables is the file's spacing, not the entry
    expect(after).toContain(`"mcp"]\n\n[mcp_servers."other"]`)
  })

  it("replaces a stale json entry too", async () => {
    createFile(`${project}/.mcp.json`, `{"mcpServers":{"mytool":{"command":"/old/stale/node"}}}`)
    installMcpClient("mytool", invocation, "claude")
    const after = JSON.parse(await read(projectFs, ".mcp.json"))
    expect(after.mcpServers.mytool).toEqual({ command: "mytool", args: ["mcp"] })
  })

  it("treats a dotted program name as one literal key in JSON and TOML", async () => {
    installMcpClient("acme.tool", invocation, "claude")
    const json = JSON.parse(await read(projectFs, ".mcp.json"))
    expect(json.mcpServers["acme.tool"]).toEqual(invocation)
    expect(json.mcpServers.acme).toBeUndefined()

    installMcpClient("acme.tool", invocation, "codex")
    expect(await read(homeFs, ".codex/config.toml")).toContain('[mcp_servers."acme.tool"]')
  })
})

// a directory of its own: the cases above leave .cursor and .vscode behind,
// and detection would rightly find them
// A host launched from its own launcher carries none of a shell's PATH,
// so a bare program name is only spawnable when it is globally
// installed. Naming it absolutely is what makes a restart work.
describe("what a client is told to spawn", () => {
  it("never leaves a bare name that a fresh host could not resolve", () => {
    const { command, args } = mcpInvocation("mytool")
    expect(command).not.toBe("mytool")
    expect(command.startsWith("/")).toBe(true)
    expect(args[args.length - 1]).toBe("mcp")
  })

  it("spawns the running script through its own interpreter when there is no installed bin", () => {
    const { command, args } = mcpInvocation("mytool")
    expect(command).toBe(process.execPath)
    // the script sits after the interpreter's own flags, before `mcp`
    expect(args[args.length - 2]).toBe(process.argv[1])
  })
})

// One declaration, each client's own spelling. A client that has no
// equivalent for a setting receives nothing for it, rather than a key
// it would silently ignore.
describe("projecting the program's server config", () => {
  const server = {
    env: { API_TOKEN: "${TOKEN}" },
    toolTimeoutMs: 30_000,
    startupTimeoutMs: 45_000,
    eager: true,
    sandbox: true
  } as const

  it("gives claude its millisecond `timeout`", async () => {
    installMcpClient("mytool", invocation, "claude", server)
    const entry = JSON.parse(await read(projectFs, ".mcp.json")).mcpServers.mytool
    expect(entry.env).toEqual({ API_TOKEN: "${TOKEN}" })
    expect(entry.timeout).toBe(30_000)
    // claude has no startup timeout, so it is not invented
    expect(entry.startup_timeout_sec).toBeUndefined()
    expect(entry.startupTimeoutMs).toBeUndefined()
  })

  it("converts to codex's seconds", async () => {
    installMcpClient("mytool", invocation, "codex", server)
    const after = await read(homeFs, ".codex/config.toml")
    // whole lines: `= 30` is a substring of `= 30000`, so a contains
    // check here passes even when the conversion is not happening
    const lines = after.split("\n")
    expect(lines).toContain("tool_timeout_sec = 30")
    expect(lines).toContain("startup_timeout_sec = 45")
    expect(lines).toContain(`env = { API_TOKEN = "\${TOKEN}" }`)
  })

  it("gives a client only what it supports", async () => {
    installMcpClient("mytool", invocation, "cursor", server)
    const entry = JSON.parse(await read(projectFs, ".cursor/mcp.json")).mcpServers.mytool
    expect(entry.env).toEqual({ API_TOKEN: "${TOKEN}" })
    expect(entry.timeout).toBeUndefined()
    // cursor has neither of these; inventing them would write keys it ignores
    expect(entry.alwaysLoad).toBeUndefined()
    expect(entry.sandboxEnabled).toBeUndefined()
  })

  it("spells eager as claude's alwaysLoad, and only for claude", async () => {
    installMcpClient("mytool", invocation, "claude", server)
    const claude = JSON.parse(await read(projectFs, ".mcp.json")).mcpServers.mytool
    expect(claude.alwaysLoad).toBe(true)
    // claude has no sandbox setting
    expect(claude.sandboxEnabled).toBeUndefined()
  })

  it("declares a prompted value beside the servers, where vscode reads it", async () => {
    installMcpClient("mytool", invocation, "vscode", {
      env: { API_KEY: "${input:api-key}" },
      prompts: [{ id: "api-key", description: "Enter your API key", secret: true }]
    })
    const file = JSON.parse(await read(projectFs, ".vscode/mcp.json"))
    // a reference without its declaration is unresolvable, so both land
    expect(file.servers.mytool.env).toEqual({ API_KEY: "${input:api-key}" })
    expect(file.inputs).toEqual([
      { id: "api-key", type: "promptString", description: "Enter your API key", password: true }
    ])
  })

  it("keeps a prompt another server already declared", async () => {
    installMcpClient("other", invocation, "vscode", {
      prompts: [{ id: "other-token", description: "Other token" }]
    })
    installMcpClient("mytool", invocation, "vscode", {
      prompts: [{ id: "api-key", description: "Enter your API key" }]
    })
    const ids = JSON.parse(await read(projectFs, ".vscode/mcp.json"))
      .inputs.map((input: { id: string }) => input.id)
    expect(ids).toContain("other-token")
    expect(ids).toContain("api-key")
  })

  it("spells sandbox as vscode's sandboxEnabled, and only for vscode", async () => {
    installMcpClient("mytool", invocation, "vscode", server)
    const code = JSON.parse(await read(projectFs, ".vscode/mcp.json")).servers.mytool
    expect(code.sandboxEnabled).toBe(true)
    // vscode has no startup-connect setting
    expect(code.alwaysLoad).toBeUndefined()
  })

  it("writes no settings at all when the program declares none", async () => {
    installMcpClient("plain", invocation, "claude")
    const entry = JSON.parse(await read(projectFs, ".mcp.json")).mcpServers.plain
    expect(Object.keys(entry).sort()).toEqual(["args", "command"])
  })
})

describe("the development wiring", () => {
  it("carries the interpreter's own flags into a source invocation", () => {
    // without the loader and conditions this process runs under, the
    // client spawns a process that cannot resolve its own imports
    const { args } = mcpInvocation("mytool")
    for (const flag of process.execArgv) expect(args).toContain(flag)
    expect(args[args.length - 1]).toBe("mcp")
  })

  it("refuses when mcp-reloader is not installed, rather than writing a config that cannot spawn", () => {
    expect(() => mcpDevInvocation({ command: "/bin/node", args: ["/p/bin.ts", "mcp"] }))
      .toThrow(/mcp-reloader is not installed/)
  })

  it("wraps the invocation under mcp-reloader, backend after `--`", () => {
    createFile(`${project}/node_modules/.bin/mcp-reloader`, "")
    const base = { command: "/bin/node", args: [`${project}/src/bin.ts`, "mcp"] } as const
    const dev = mcpDevInvocation(base)
    expect(dev.command.endsWith("mcp-reloader")).toBe(true)
    expect(dev.args[0]).toBe("--cwd")
    const separator = dev.args.indexOf("--")
    expect(separator).toBeGreaterThan(0)
    // the backend must survive verbatim: mcp-reloader spawns it directly
    expect(dev.args.slice(separator + 1)).toEqual([base.command, ...base.args])
  })

  it("derives the reloader cwd from the source entry after interpreter flags", () => {
    const base = {
      command: process.execPath,
      args: ["--import", "tsx", `${project}/src/bin.ts`, "mcp"]
    } as const
    const dev = mcpDevInvocation(base)
    expect(dev.args.slice(0, 2)).toEqual(["--cwd", project])
  })
})

// The inverse of install: a renamed or abandoned program has to be
// removable without hand-editing a file full of other people's servers.
describe("removing a program from a client", () => {
  it("takes out only the named server", async () => {
    createFile(
      `${project}/.mcp.json`,
      `{"mcpServers":{"other":{"command":"other-bin"},"mytool":{"command":"mytool"}}}`
    )
    expect(uninstallMcpClient("mytool", "claude")).toBe(true)
    const after = JSON.parse(await read(projectFs, ".mcp.json")).mcpServers
    expect(after.mytool).toBeUndefined()
    expect(after.other).toEqual({ command: "other-bin" })
  })

  it("keeps a toml file's comments and its other tables", async () => {
    const file = `${home}/.codex/config.toml`
    createFile(
      file,
      `# my own note\nmodel = "gpt-5"\n\n[mcp_servers."keepme"]\ncommand = "keep"\n\n[mcp_servers."mytool"]\ncommand = "mytool"\n`
    )
    expect(uninstallMcpClient("mytool", "codex")).toBe(true)
    const after = await read(homeFs, ".codex/config.toml")
    expect(after).toContain("# my own note")
    expect(after).toContain('[mcp_servers."keepme"]')
    expect(after).not.toContain('[mcp_servers."mytool"]')
  })

  it("reports honestly when there was nothing to remove", () => {
    createFile(`${project}/.mcp.json`, `{"mcpServers":{"other":{"command":"other-bin"}}}`)
    expect(uninstallMcpClient("absent", "claude")).toBe(false)
  })

  it("reports false rather than throwing when the file does not exist", async () => {
    // earlier cases in this suite wrote cursor's file, so clear it
    await projectFs.storage.removeItem(".cursor/mcp.json")
    expect(uninstallMcpClient("mytool", "cursor")).toBe(false)
  })
})

describe("detection", () => {
  const bare = `${root}/bare`

  beforeAll(() => {
    createFile(`${bare}/.keep`, "")
    process.chdir(bare)
  })

  afterAll(() => {
    process.chdir(project)
  })

  it("never selects a client whose config lives in the user's home", () => {
    // both global configs exist by now, so a home-reaching detection would
    // silently edit settings outside this project
    expect(detectMcpClient()._tag).toBe("None")
  })

  it("selects the project-local client that is present", () => {
    createFile(`${bare}/.mcp.json`, "{}\n")
    expect(detectMcpClient()).toMatchObject({ value: "claude" })
  })
})
