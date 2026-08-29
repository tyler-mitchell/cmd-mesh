import { parseTOML } from "confbox"
import { Array, Option } from "effect"
// package-management owns file and config concerns, and now carries
// `readFile` and a `modifyConfigFile` that covers toml — neither is in
// the released 0.1.0 yet, so this reads directly until that ships.
import { readFileSync } from "node:fs"
import { createFile, getPath, modifyJSONFile } from "package-management"

// Registering a stdio server differs between clients only in the file
// it lives in, the key it sits under, and the format — so the clients
// are a table and one interpreter writes any of them. Every client is
// a file edit that keeps what the file already holds: these are the
// user's own editor settings.

interface McpClientSpec {
  /** the config file this client reads */
  readonly file: string
  /** the path whose existence means this client is in use here */
  readonly detect: string
  readonly key: string
  readonly format: "json" | "toml"
  /** vscode alone names the transport in the entry */
  readonly typed?: boolean
  /** the config lives in the user's home, not this project. detection
   * never selects one: a project command that silently edits a global
   * config is a surprise, so these must be named outright. */
  readonly global: boolean
}

const clients = {
  claude: {
    file: "<cwd>/.mcp.json",
    detect: "<cwd>/.mcp.json",
    key: "mcpServers",
    format: "json",
    global: false
  },
  cursor: {
    file: "<cwd>/.cursor/mcp.json",
    detect: "<cwd>/.cursor",
    key: "mcpServers",
    format: "json",
    global: false
  },
  vscode: {
    file: "<cwd>/.vscode/mcp.json",
    detect: "<cwd>/.vscode",
    key: "servers",
    format: "json",
    typed: true,
    global: false
  },
  windsurf: {
    file: "<user_home>/.codeium/windsurf/mcp_config.json",
    detect: "<user_home>/.codeium/windsurf",
    key: "mcpServers",
    format: "json",
    global: true
  },
  codex: {
    file: "<user_home>/.codex/config.toml",
    detect: "<user_home>/.codex",
    key: "mcp_servers",
    format: "toml",
    global: true
  }
} as const satisfies Readonly<Record<string, McpClientSpec>>

export type McpClientId = keyof typeof clients

export const mcpClientIds = Object.keys(clients) as ReadonlyArray<McpClientId>

export const isMcpClientId = (value: string): value is McpClientId =>
  Array.contains(mcpClientIds, value as McpClientId)

const exists = (path: string): boolean =>
  getPath({ to: path, checkExistence: true }) !== undefined

/** the client whose config this working directory already carries.
 * project-local only — see `global` above */
export const detectMcpClient = (): Option.Option<McpClientId> =>
  Array.findFirst(mcpClientIds, (id) => !clients[id].global && exists(clients[id].detect))

/** a toml table is appended as text rather than re-serialized, so every
 * comment and hand-written line in the user's config survives */
const tomlEntry = (key: string, name: string, command: string): string =>
  `\n[${key}.${name}]\ncommand = "${command}"\nargs = ["mcp"]\n`

const alreadyInToml = (source: string, key: string, name: string): boolean => {
  const table = parseTOML<Record<string, unknown>>(source)[key]
  return typeof table === "object" && table !== null && name in table
}

/** register `<name> mcp` with a client, keeping the rest of its file */
export const installMcpClient = (
  name: string,
  command: string,
  client: McpClientId
): string => {
  const spec: McpClientSpec = clients[client]
  const file = getPath({ to: spec.file })
  if (spec.format === "toml") {
    const source = exists(spec.file) ? readFileSync(file, "utf-8") : ""
    if (!alreadyInToml(source, spec.key, name)) {
      createFile(file, `${source}${tomlEntry(spec.key, name, command)}`)
    }
    return file
  }
  if (!exists(spec.file)) createFile(file, "{}\n")
  const entry = spec.typed === true
    ? { type: "stdio", command, args: ["mcp"] }
    : { command, args: ["mcp"] }
  const result = modifyJSONFile(file, { [`${spec.key}.${name}`]: { value: entry } })
  if (result.error !== undefined) throw result.error
  return file
}
