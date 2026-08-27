import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Array, Effect, Option, Predicate, Record, pipe } from "effect"
import type { AnyType, CompiledCommand } from "./compile.js"
import type { Ctx, McpTool } from "./types.js"

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

/** parameter descriptions live in the descriptor, not the ArkType def —
 * fold them into the projected schema so agents see them */
const withParameterDocs = (schema: unknown, cmd: CompiledCommand): unknown => {
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
              ...prop,
              ...Option.match(p.description, {
                onNone: () => ({}),
                onSome: (description) =>
                  Predicate.hasProperty(prop, "description") ? {} : { description }
              }),
              // static suggestions are universal: agents see them as examples
              ...Option.match(p.staticSuggestions, {
                onNone: () => ({}),
                onSome: (examples) => Predicate.hasProperty(prop, "examples") ? {} : { examples }
              })
            }
            : prop
      })
    ))
  return { ...schema, properties: documented }
}

/** mcp output schemas must describe an object (structuredContent is an
 * object) — non-object outputs are wrapped under a `result` key */
const structuredSchema = (out: AnyType): { readonly schema: unknown; readonly wrapped: boolean } => {
  const schema = jsonSchemaOf(out) as { readonly type?: unknown }
  return schema.type === "object"
    ? { schema, wrapped: false }
    : { schema: { type: "object", properties: { result: schema }, required: ["result"] }, wrapped: true }
}

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
        description: root.description,
        inputSchema: withParameterDocs(jsonSchemaOf(root.schemaType), root),
        ...Option.match(output, {
          onNone: () => ({}),
          onSome: (o) => ({ outputSchema: o.schema })
        })
      }
    }]
    : []
  return pipe(
    Record.toEntries(root.children),
    Array.flatMap(([, child]) => collectTools(child)),
    Array.appendAll(own)
  )
}

interface ToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>
  readonly isError?: boolean
}

const textResult = (text: string, isError?: boolean): ToolResult => ({
  content: [{ type: "text", text }],
  ...(isError === true ? { isError: true } : {})
})

/** serve the tools over stdio; the effect stays alive until the process ends */
export const serveMcp = (
  root: CompiledCommand,
  meta: { readonly name: string; readonly version: string },
  invoke: (cmd: CompiledCommand, input: unknown, ctx: Ctx) => Effect.Effect<unknown, unknown, any>,
  runPromise: <A>(effect: Effect.Effect<A, never, any>) => Promise<A>,
  ctx: Ctx
): Effect.Effect<never, Error> =>
  Effect.gen(function*() {
    const tools = collectTools(root)
    const byName = Record.fromEntries(Array.map(tools, (t) => [t.tool.name, t] as const))
    const server = new Server({ name: meta.name, version: meta.version }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Array.map(tools, (t) => ({
        name: t.tool.name,
        description: t.tool.description,
        inputSchema: t.tool.inputSchema as { readonly type: "object" },
        ...(t.tool.outputSchema === undefined
          ? {}
          : { outputSchema: t.tool.outputSchema as { readonly type: "object" } }),
        ...Option.match(t.command.mcpAnnotations, {
          onNone: () => ({}),
          onSome: (annotations) => ({ annotations })
        })
      }))
    }))
    // the sdk demands async handlers: runPromise is the sanctioned bridge
    server.setRequestHandler(CallToolRequestSchema, (async (request: {
      readonly params: { readonly name: string; readonly arguments?: unknown }
    }) =>
      runPromise(
        pipe(
          Record.get(byName, request.params.name),
          Option.match({
            onNone: () => Effect.succeed(textResult(`unknown tool: ${request.params.name}`, true)),
            onSome: (tool) =>
              invoke(tool.command, request.params.arguments ?? {}, ctx).pipe(
                Effect.match({
                  // agents get json text plus, when an output contract
                  // exists, schema-conformant structuredContent
                  onSuccess: (result) => ({
                    ...textResult(JSON.stringify(result, null, 2)),
                    ...Option.match(tool.command.outputType, {
                      onNone: () => ({}),
                      onSome: () => ({
                        structuredContent: tool.wrapOutput ? { result } : result as object
                      })
                    })
                  }),
                  onFailure: (error) => textResult(`${error}`, true)
                })
              )
          })
        )
      )) as never)
    yield* Effect.tryPromise({
      try: () => server.connect(new StdioServerTransport()),
      catch: (cause) => new Error(`mcp transport failed: ${cause}`)
    })
    return yield* Effect.never
  })
