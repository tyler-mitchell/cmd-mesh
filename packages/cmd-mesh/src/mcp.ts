import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js"
import { Array, Effect, Option, Predicate, Record, pipe } from "effect"
import type { AnyType, CompiledCommand } from "./compile.js"
import type { CommandSpec, Ctx, McpTool } from "./types.js"

// the mcp projection: the same compiled model as typed tools. input schemas
// come from the value-boundary type (agents speak canonical JSON), via
// ArkType's own JSON Schema projection.

export const jsonSchemaOf = (t: AnyType): unknown =>
  Effect.runSync(
    Effect.try(() => t.toJsonSchema()).pipe(
      Effect.orElseSucceed(() => ({ type: "object" }))
    )
  )

const toolName = (cmd: CompiledCommand): string =>
  Option.getOrElse(cmd.mcpName, () => Array.join(cmd.path, "_"))

/** parameter descriptions and suggestion examples live in the
 * descriptor, not the ArkType def — fold them into a projected schema.
 * every schema surface shares this; it is not mcp-specific. */
// ArkType emits every metadata key into JSON Schema, so this package's
// own surface bindings would reach agents as schema fields.
const surfaceKeys = ["cli", "suggest", "env", "hidden"]

const documentSchema = (schema: unknown, cmd: CompiledCommand): unknown => {
  if (!Predicate.isObject(schema) || !Predicate.hasProperty(schema, "properties")) return schema
  const properties = (schema as { readonly properties: globalThis.Record<string, unknown> }).properties
  if (!Predicate.isObject(properties)) return schema
  const documented = Record.map(properties, (prop, key) =>
    pipe(
      Array.findFirst(cmd.parameters, (p) => p.key === key),
      Option.match({
        onNone: () => prop,
        onSome: (p) =>
          Predicate.isObject(prop)
            ? {
              ...Record.filter(
                prop as globalThis.Record<string, unknown>,
                (_, k) => !Array.contains(surfaceKeys, k)
              ),
              ...Option.match(p.description, {
                onNone: () => ({}),
                onSome: (description) =>
                  Predicate.hasProperty(prop, "description") ? {} : { description }
              }),
              // static suggestions are universal: agents see them as examples
              ...Option.match(p.staticSuggestions, {
                onNone: () => ({}),
                onSome: (examples) => Predicate.hasProperty(prop, "examples") ? {} : { examples }
              }),
              // the input-side projection carries no default — the value
              // lives on the optional prop node, which .in drops
              ...Option.match(p.defaultValue, {
                onNone: () => ({}),
                onSome: (value) => Predicate.hasProperty(prop, "default") ? {} : { default: value }
              })
            }
            : prop
      })
    ))
  return { ...schema, properties: documented }
}

/** the full documented input schema — the `args` surface's projection */
// the schema describes what a caller may SEND, so it projects the input
// side. a morph has no JSON Schema representation; its input domain does.
export const inputSchema = (cmd: CompiledCommand): unknown =>
  documentSchema(jsonSchemaOf((cmd.schemaType as { readonly in: unknown }).in), cmd)

/** the mcp projection additionally drops mcp-hidden parameters from the
 * advertised schema and its required list */
const withParameterDocs = (schema: unknown, cmd: CompiledCommand): unknown => {
  const documented = documentSchema(schema, cmd)
  if (!Predicate.isObject(documented) || !Predicate.hasProperty(documented, "properties")) {
    return documented
  }
  const properties = (documented as { readonly properties: globalThis.Record<string, unknown> })
    .properties
  const hidden = (key: string): boolean =>
    Array.some(cmd.parameters, (p) => p.key === key && p.mcpHidden)
  const required = Predicate.hasProperty(documented, "required")
      && globalThis.Array.isArray((documented as { readonly required: unknown }).required)
    ? {
      required: Array.filter(
        (documented as { readonly required: ReadonlyArray<string> }).required,
        (key) => !hidden(key)
      )
    }
    : {}
  return {
    ...documented,
    properties: Record.filter(properties, (_, key) => !hidden(key)),
    ...required
  }
}

/** mcp output schemas must describe an object (structuredContent is an
 * object) — non-object outputs are wrapped under a `result` key.
 * structuredContent carries the MORPHED value, so the schema projects
 * the output side; a morph's own toJsonSchema throws (and the swallow
 * would advertise a number as an object, skipping the wrap). */
const structuredSchema = (out: AnyType): { readonly schema: unknown; readonly wrapped: boolean } => {
  const schema = jsonSchemaOf(out.out) as { readonly type?: unknown }
  return schema.type === "object"
    ? { schema, wrapped: false }
    : { schema: { type: "object", properties: { result: schema }, required: ["result"] }, wrapped: true }
}

/** examples reach agents twice: appended to the description (the text
 * every client renders) and as the input schema's JSON-Schema
 * `examples` annotation (canonical argument objects) */
const describedWithExamples = (cmd: CompiledCommand): string =>
  cmd.mcpExamples.length === 0
    ? cmd.description
    : Array.join(
      [
        cmd.description,
        "",
        "Examples:",
        ...Array.map(cmd.mcpExamples, (example) =>
          example.description === undefined
            ? `- ${JSON.stringify(example.args)}`
            : `- ${JSON.stringify(example.args)} — ${example.description}`)
      ],
      "\n"
    )

const withSchemaExamples = (schema: unknown, cmd: CompiledCommand): unknown =>
  cmd.mcpExamples.length === 0 || !Predicate.isObject(schema)
    ? schema
    : { ...schema, examples: Array.map(cmd.mcpExamples, (example) => example.args) }

const runnable = (cmd: CompiledCommand): boolean => Option.isSome(cmd.run) || Option.isSome(cmd.external)

/** an external mount root ("run the bare binary") is argv-useful but is
 * not itself a tool */
const isExternalGroupRoot = (cmd: CompiledCommand): boolean =>
  Option.match(cmd.external, {
    onNone: () => false,
    onSome: (external) => external.argPath.length === 0 && !Record.isEmptyRecord(cmd.children)
  })

interface NamedTool {
  readonly command: CompiledCommand
  readonly tool: McpTool
  /** structuredContent must nest non-object outputs under `result` */
  readonly wrapOutput: boolean
}

/** flatten the visible, runnable commands of a tree into named tools */
export const collectTools = (root: CompiledCommand): ReadonlyArray<NamedTool> => {
  if (root.mcpHidden) return []
  const output = Option.map(root.outputType, structuredSchema)
  const own: ReadonlyArray<NamedTool> = runnable(root) && !isExternalGroupRoot(root)
    ? [{
      command: root,
      wrapOutput: Option.match(output, { onNone: () => true, onSome: (o) => o.wrapped }),
      tool: {
        name: toolName(root),
        description: describedWithExamples(root),
        inputSchema: withSchemaExamples(
          withParameterDocs(jsonSchemaOf((root.schemaType as AnyType).in), root),
          root
        ),
        ...Option.match(output, {
          onNone: () => ({}),
          onSome: (o) => ({ outputSchema: o.schema })
        }),
        ...(() => {
          const safetyHints = {
            read: { readOnlyHint: true, destructiveHint: false },
            action: { readOnlyHint: false, destructiveHint: false },
            destructive: { readOnlyHint: false, destructiveHint: true }
          } as const
          // Both hints, always. A client reads an ABSENT destructiveHint
          // as true, so a command that never declared its safety would
          // be treated as destructive — an undeclared command is only
          // unclassified, which is what "action" says.
          const hints = safetyHints[Option.getOrElse(root.safety, () => "action" as const)]
          const merged = { ...hints, ...Option.getOrElse(root.mcpAnnotations, () => ({})) }
          return Record.isEmptyRecord(merged) ? {} : { annotations: merged }
        })()
      }
    }]
    : []
  return pipe(
    Record.toEntries(root.children),
    Array.flatMap(([, child]) => collectTools(child)),
    Array.appendAll(own),
    uniquelyNamed
  )
}

/** an MCP server routes purely by name; flattening can collide (`cache_clear`
 * beside `cache clear`), so later collisions get a numeric suffix rather
 * than silently shadowing the earlier tool */
const uniquelyNamed = (tools: ReadonlyArray<NamedTool>): ReadonlyArray<NamedTool> =>
  pipe(
    tools,
    Array.reduce(
      { seen: {} as globalThis.Record<string, number>, out: [] as ReadonlyArray<NamedTool> },
      (state, tool) =>
        pipe(
          Record.get(state.seen, tool.tool.name),
          Option.match({
            onNone: () => ({
              seen: { ...state.seen, [tool.tool.name]: 1 },
              out: Array.append(state.out, tool)
            }),
            onSome: (count) => ({
              seen: { ...state.seen, [tool.tool.name]: count + 1 },
              out: Array.append(state.out, {
                ...tool,
                tool: { ...tool.tool, name: `${tool.tool.name}_${count + 1}` }
              })
            })
          })
        )
    ),
    ({ out }) => out
  )

// A handler receives the parameters its command declares. An agent may
// send any key it invents. See skills/cmd-mesh/references/reference.md.
const declaredArguments = (cmd: CompiledCommand, args: unknown): unknown =>
  Predicate.isObject(args)
    ? Record.filter(
      args as globalThis.Record<string, unknown>,
      (_, key) => Array.some(cmd.parameters, (p) => p.key === key)
    )
    : {}

interface ToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>
  readonly isError?: boolean
}

const textResult = (text: string, isError?: boolean): ToolResult => ({
  content: [{ type: "text", text }],
  ...(isError === true ? { isError: true } : {})
})

const SPEC_URI = "cmd-mesh://spec"

/** the spec both ways, devframe's precedent: a resource for clients
 * that read resources, and a paired read tool because many MCP clients
 * only consume tools. a declared tool claiming the name wins. */
const specToolFor = (rootName: string): McpTool => ({
  name: `${rootName}_spec`,
  description:
    `The complete command surface of ${rootName} as one JSON descriptor: every command with its input schema, output schema, safety, and examples. Read it to plan calls instead of probing. Safe to call freely.`,
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { spec: {} }, required: ["spec"] },
  annotations: { readOnlyHint: true, destructiveHint: false }
})

/** the server as a pure factory over any transport — stdio in
 * production, an in-memory pair in witnesses */
export const buildMcpServer = (
  root: CompiledCommand,
  meta: { readonly name: string; readonly version: string },
  invoke: (cmd: CompiledCommand, input: unknown, ctx: Ctx) => Effect.Effect<unknown, unknown, any>,
  runPromise: <A>(effect: Effect.Effect<A, never, any>, signal?: AbortSignal) => Promise<A>,
  ctx: Ctx,
  spec: CommandSpec
): Server => {
  {
    const tools = collectTools(root)
    const byName = Record.fromEntries(Array.map(tools, (t) => [t.tool.name, t] as const))
    const specTool = Option.fromNullishOr(
      Record.has(byName, `${meta.name}_spec`) ? undefined : specToolFor(meta.name)
    )
    const server = new Server(
      { name: meta.name, version: meta.version },
      { capabilities: { tools: {}, resources: {} } }
    )
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [{
        uri: SPEC_URI,
        name: "spec",
        description: `The complete command surface of ${meta.name} as one JSON descriptor.`,
        mimeType: "application/json"
      }]
    }))
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (request.params.uri !== SPEC_URI) {
        throw new Error(`unknown resource: ${request.params.uri}`)
      }
      return {
        contents: [{ uri: SPEC_URI, mimeType: "application/json", text: JSON.stringify(spec, null, 2) }]
      }
    })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        ...Array.map(tools, (t) => ({
          name: t.tool.name,
          description: t.tool.description,
          inputSchema: t.tool.inputSchema as { readonly type: "object" },
          ...(t.tool.outputSchema === undefined
            ? {}
            : { outputSchema: t.tool.outputSchema as { readonly type: "object" } }),
          ...(t.tool.annotations === undefined ? {} : { annotations: t.tool.annotations })
        })),
        ...Option.match(specTool, {
          onNone: () => [],
          onSome: (tool) => [{
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as { readonly type: "object" },
            outputSchema: tool.outputSchema as { readonly type: "object" },
            annotations: tool.annotations
          }]
        })
      ]
    }))
    // the sdk demands async handlers: runPromise is the sanctioned bridge,
    // and the request's AbortSignal interrupts the invocation — a
    // cancelled tool call kills any child process it spawned
    server.setRequestHandler(CallToolRequestSchema, (async (request: {
      readonly params: { readonly name: string; readonly arguments?: unknown }
    }, extra: { readonly signal: AbortSignal }) => {
      const specCall = Option.filter(specTool, (tool) => tool.name === request.params.name)
      if (Option.isSome(specCall)) {
        return {
          ...textResult(JSON.stringify(spec, null, 2)),
          structuredContent: { spec }
        }
      }
      return runPromise(
        pipe(
          Record.get(byName, request.params.name),
          Option.match({
            onNone: () => Effect.succeed(textResult(`unknown tool: ${request.params.name}`, true)),
            onSome: (tool) =>
              invoke(tool.command, declaredArguments(tool.command, request.params.arguments), ctx).pipe(
                Effect.match({
                  // agents get json text plus, when an output contract
                  // exists, schema-conformant structuredContent. a void
                  // result is a valid empty content array — never
                  // `text: undefined`, which the protocol rejects
                  onSuccess: (result) =>
                    result === undefined
                      ? { content: [] }
                      : {
                        ...textResult(
                          Predicate.isString(result) ? result : JSON.stringify(result, null, 2)
                        ),
                        ...Option.match(tool.command.outputType, {
                          onNone: () => ({}),
                          onSome: () => ({
                            structuredContent: tool.wrapOutput ? { result } : result as object
                          })
                        })
                      },
                  onFailure: (error) => textResult(`${error}`, true)
                })
              )
          })
        ),
        extra.signal
      )
    }) as never)
    return server
  }
}

/** While serving, stdout IS the transport: one stray `console.log` in a
 * handler puts a non-JSON line into the stream. Handlers are ordinary
 * functions that log like any other code, so the whole console is
 * pointed at stderr for the life of the server rather than asking every
 * handler to know where it is running. */
export const routeConsoleToStderr = (): void => {
  const current = globalThis.console
  // pointed at `error`, which already writes to stderr, rather than at
  // a stream: formatting stays console's own, and this holds under a
  // host that replaced the global console with its own object
  const toStderr = current.error.bind(current)
  globalThis.console = Object.assign(Object.create(current) as Console, {
    log: toStderr,
    info: toStderr,
    debug: toStderr,
    dir: toStderr,
    table: toStderr
  })
}

/** serve the tools over stdio, until the client disconnects and the
 * transport closes. resolving there is what lets a bin exit 0 — a
 * server that waited forever would leave `main()` unsettled, and the
 * host reads that non-zero exit as a crash. */
export const serveMcp = (
  root: CompiledCommand,
  meta: { readonly name: string; readonly version: string },
  invoke: (cmd: CompiledCommand, input: unknown, ctx: Ctx) => Effect.Effect<unknown, unknown, any>,
  runPromise: <A>(effect: Effect.Effect<A, never, any>, signal?: AbortSignal) => Promise<A>,
  ctx: Ctx,
  spec: CommandSpec
): Effect.Effect<void, Error> =>
  Effect.gen(function*() {
    const server = buildMcpServer(root, meta, invoke, runPromise, ctx, spec)
    routeConsoleToStderr()
    yield* Effect.tryPromise({
      try: () => server.connect(new StdioServerTransport()),
      catch: (cause) => new Error(`mcp transport failed: ${cause}`)
    })
    return yield* Effect.callback<void>((resume) => {
      const closed = server.onclose
      server.onclose = () => {
        closed?.()
        resume(Effect.void)
      }
      // the sdk's stdio transport registers only "data" and "error" on
      // stdin, so a client that goes away leaves EOF unnoticed and the
      // transport never closes itself
      globalThis.process.stdin.once("end", () => void server.close())
    })
  })
