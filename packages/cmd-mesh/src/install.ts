import { Array, Option, Predicate } from "effect"
import type { McpServerConfig } from "./types.js"
import { createFile, getPath, modifyJSONFile, readFile } from "package-management"

// Registering a stdio server differs between clients only in the file
// it lives in, the key it sits under, and the format — so the clients
// are a table and one interpreter writes any of them. Every client is
// a file edit that keeps what the file already holds: these are the
// user's own editor settings.

/** where a project-scoped client's config belongs. A client opens the
 * repository, not the directory a command happened to run in, so a
 * monorepo package must still write to the root. */
const projectRoot = (): string => {
  try {
    return getPath({ to: "<workspace_folder>" })
  } catch {
    return getPath({ to: "<cwd>" })
  }
}

/** each client's own spelling of the shared server settings. A client
 * that has no equivalent for one receives nothing for it, rather than a
 * key it would ignore. */
const clientSettings = {
  claude: (s: McpServerConfig) => ({
    ...(s.env === undefined ? {} : { env: s.env }),
    ...(s.toolTimeoutMs === undefined ? {} : { timeout: s.toolTimeoutMs }),
    ...(s.eager === undefined ? {} : { alwaysLoad: s.eager })
  }),
  cursor: (s: McpServerConfig) => (s.env === undefined ? {} : { env: s.env }),
  vscode: (s: McpServerConfig) => ({
    ...(s.env === undefined ? {} : { env: s.env }),
    ...(s.sandbox === undefined ? {} : { sandboxEnabled: s.sandbox })
  }),
  windsurf: (s: McpServerConfig) => (s.env === undefined ? {} : { env: s.env }),
  // codex counts in seconds, so the declaration's milliseconds convert
  codex: (s: McpServerConfig) => ({
    ...(s.env === undefined ? {} : { env: s.env }),
    ...(s.toolTimeoutMs === undefined
      ? {}
      : { tool_timeout_sec: Math.ceil(s.toolTimeoutMs / 1000) }),
    ...(s.startupTimeoutMs === undefined
      ? {}
      : { startup_timeout_sec: Math.ceil(s.startupTimeoutMs / 1000) })
  })
} as const satisfies Readonly<Record<string, (s: McpServerConfig) => object>>

interface McpClientSpec {
  /** the config file this client reads, under its scope's root */
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
    file: "/.mcp.json",
    detect: "/.mcp.json",
    key: "mcpServers",
    format: "json",
    global: false
  },
  cursor: {
    file: "/.cursor/mcp.json",
    detect: "/.cursor",
    key: "mcpServers",
    format: "json",
    global: false
  },
  vscode: {
    file: "/.vscode/mcp.json",
    detect: "/.vscode",
    key: "servers",
    format: "json",
    typed: true,
    global: false
  },
  windsurf: {
    file: "~/.codeium/windsurf/mcp_config.json",
    detect: "~/.codeium/windsurf",
    key: "mcpServers",
    format: "json",
    global: true
  },
  codex: {
    file: "~/.codex/config.toml",
    detect: "~/.codex",
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

/** a client's path under the root its scope names */
const pathOf = (spec: McpClientSpec, path: string): string =>
  `${spec.global ? getPath({ to: "<user_home>" }) : projectRoot()}${
    path.startsWith("~") ? path.slice(1) : path
  }`

/** what a client must actually spawn. A host started from its own
 * launcher inherits no shell PATH additions, so a workspace-local bin
 * is named by its absolute path; anything else keeps the bare name,
 * which is what a globally installed program wants. */
const binIn = (alias: "<package_folder>/node_modules/.bin" | "<workspace_folder>/node_modules/.bin", name: string): Option.Option<string> => {
  try {
    const path = `${getPath({ to: alias })}/${name}`
    return exists(path) ? Option.some(path) : Option.none()
  } catch {
    // the alias names a location this project does not have
    return Option.none()
  }
}

/** what a client must actually spawn. A host launched from its own
 * launcher inherits none of a shell's PATH, so a bare name only works
 * for a globally installed program — every other case is named
 * absolutely. An installed dependency has a `.bin` entry; a program
 * still being developed has only the script now running, which is
 * spawned through the same interpreter that is running it. */
export interface McpInvocation {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

/** the same invocation under `mcp-reloader`, which supervises it and
 * adds a `reload` tool: after editing, one call re-spawns the server
 * with the connection intact instead of restarting the host. No build
 * command is passed — a bin run from source needs no build step, which
 * is also what makes edits to every package upstream land at once. */
export const mcpDevInvocation = (base: McpInvocation): McpInvocation => {
  const reloader = Option.orElse(
    binIn("<package_folder>/node_modules/.bin", "mcp-reloader"),
    () => binIn("<workspace_folder>/node_modules/.bin", "mcp-reloader")
  )
  if (Option.isNone(reloader)) {
    throw new Error("mcp-reloader is not installed — add it, then run this again")
  }
  // the backend runs from ITS OWN package, not from wherever install was
  // invoked — a loader like tsx resolves relative to that package
  const entry = base.args.length > 1 ? base.args[0]! : base.command
  return {
    command: reloader.value,
    args: [
      "--cwd",
      getPath({ to: "<package_folder>", cwd: entry.slice(0, entry.lastIndexOf("/")) }),
      "--",
      base.command,
      ...base.args
    ]
  }
}

export const mcpInvocation = (
  name: string
): { readonly command: string; readonly args: ReadonlyArray<string> } => {
  const installed = Option.orElse(
    binIn("<package_folder>/node_modules/.bin", name),
    () => binIn("<workspace_folder>/node_modules/.bin", name)
  )
  if (Option.isSome(installed)) return { command: installed.value, args: ["mcp"] }
  const script = globalThis.process.argv[1]
  // the interpreter's own flags travel with it: a source entry needs the
  // loader and conditions it is running under, or the client spawns a
  // process that cannot resolve its own imports
  return script === undefined
    ? { command: name, args: ["mcp"] }
    : {
      command: globalThis.process.execPath,
      args: [...globalThis.process.execArgv, script, "mcp"]
    }
}

/** the client whose config this working directory already carries.
 * project-local only — see `global` above */
export const detectMcpClient = (): Option.Option<McpClientId> =>
  Array.findFirst(
    mcpClientIds,
    (id) => !clients[id].global && exists(pathOf(clients[id], clients[id].detect))
  )

/** a toml table is appended as text rather than re-serialized, so every
 * comment and hand-written line in the user's config survives */
const tomlTable = (
  key: string,
  name: string,
  invocation: { readonly command: string; readonly args: ReadonlyArray<string> },
  settings: Readonly<globalThis.Record<string, unknown>> = {}
): ReadonlyArray<string> => [
  `[${key}.${name}]`,
  `command = ${JSON.stringify(invocation.command)}`,
  `args = ${JSON.stringify(invocation.args)}`,
  // an inline table keeps the whole entry to one replaceable block
  ...Object.entries(settings).map(([k, v]) =>
    `${k} = ${
      Predicate.isObject(v)
        ? `{ ${Object.entries(v).map(([ek, ev]) => `${ek} = ${JSON.stringify(ev)}`).join(", ")} }`
        : JSON.stringify(v)
    }`
  )
]

/** Written line-wise so every other line of the file survives: a toml
 * config is hand-kept and full of comments. Replacing an existing table
 * rather than skipping it is the point — a moved project or a new
 * interpreter leaves the old command unspawnable, and re-running the
 * install has to repair that instead of quietly doing nothing. */
const withTomlTable = (source: string, table: ReadonlyArray<string>): string => {
  const lines = source === "" ? [] : source.split("\n")
  const start = lines.findIndex((line) => line.trim() === table[0])
  if (start === -1) {
    const spacer = lines.length === 0 || lines[lines.length - 1] === "" ? [] : [""]
    return [...lines, ...spacer, ...table, ""].join("\n")
  }
  const following = lines.slice(start + 1).findIndex((line) => line.trimStart().startsWith("["))
  const boundary = following === -1 ? lines.length : start + 1 + following
  // the blank lines that separated this table from the next are the
  // file's spacing, not part of the table being replaced
  const spacing = Array.takeWhile(
    Array.reverse(lines.slice(start + 1, boundary)),
    (line) => line.trim() === ""
  ).length
  return [...lines.slice(0, start), ...table, ...lines.slice(boundary - spacing)].join("\n")
}

/** drop one table from a toml file, keeping every other line. The
 * inverse of `withTomlTable`, and line-wise for the same reason: the
 * file is hand-kept and full of comments that are not ours to lose. */
const withoutTomlTable = (source: string, header: string): string => {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => line.trim() === header)
  if (start === -1) return source
  const following = lines.slice(start + 1).findIndex((line) => line.trimStart().startsWith("["))
  const boundary = following === -1 ? lines.length : start + 1 + following
  // take the blank lines that followed it too, or removing entries
  // slowly fills the file with gaps
  const spacing = Array.takeWhile(
    Array.reverse(lines.slice(start, boundary)),
    (line) => line.trim() === ""
  ).length
  return [...lines.slice(0, start), ...lines.slice(boundary - spacing)].join("\n")
}

/** remove `<name>` from a client's config, leaving every other server,
 * every prompted value, and every comment where they were. Answers
 * whether an entry was actually there. */
export const uninstallMcpClient = (name: string, client: McpClientId): boolean => {
  const spec: McpClientSpec = clients[client]
  const file = pathOf(spec, spec.file)
  if (!exists(file)) return false
  if (spec.format === "toml") {
    const source = readFile(file)
    const without = withoutTomlTable(source, `[${spec.key}.${name}]`)
    if (without === source) return false
    createFile(file, without)
    return true
  }
  const current = modifyJSONFile(file, {}, { autoCommit: false })
  const servers = (current.data?.json.data as
    { readonly [k: string]: Readonly<globalThis.Record<string, unknown>> | undefined })?.[spec.key]
  if (servers === undefined || !(name in servers)) return false
  const result = modifyJSONFile(file, { [`${spec.key}.${name}`]: { value: undefined } })
  if (result.error !== undefined) throw result.error
  return true
}

/** register `<name> mcp` with a client, keeping the rest of its file */
export const installMcpClient = (
  name: string,
  invocation: { readonly command: string; readonly args: ReadonlyArray<string> },
  client: McpClientId,
  server?: McpServerConfig
): string => {
  const spec: McpClientSpec = clients[client]
  const file = pathOf(spec, spec.file)
  const settings = server === undefined ? {} : clientSettings[client](server)
  if (spec.format === "toml") {
    const source = exists(file) ? readFile(file) : ""
    createFile(file, withTomlTable(source, tomlTable(spec.key, name, invocation, settings)))
    return file
  }
  if (!exists(file)) createFile(file, "{}\n")
  const entry = spec.typed === true
    ? { type: "stdio", ...invocation, ...settings }
    : { ...invocation, ...settings }
  const result = modifyJSONFile(file, { [`${spec.key}.${name}`]: { value: entry } })
  if (result.error !== undefined) throw result.error
  // vscode's prompts are a TOP-LEVEL array beside the servers, not a
  // field of one, so they are written as a second edit — merged by id,
  // because the file may already prompt for another server's values
  if (client === "vscode" && server?.prompts !== undefined) {
    const current = (result.data?.data as { readonly inputs?: ReadonlyArray<{ id: string }> })
      ?.inputs ?? []
    const declared = server.prompts.map((prompt) => ({
      id: prompt.id,
      type: "promptString",
      description: prompt.description,
      ...(prompt.secret === undefined ? {} : { password: prompt.secret })
    }))
    const ids = new Set(declared.map((prompt) => prompt.id))
    const merged = [...Array.filter(current, (prompt) => !ids.has(prompt.id)), ...declared]
    const withPrompts = modifyJSONFile(file, { inputs: { value: merged } })
    if (withPrompts.error !== undefined) throw withPrompts.error
  }
  return file
}
