import { Array, Effect, Option, Predicate, Record, pipe } from "effect"
import type { AnyType, CompiledCommand, CompiledParameter } from "./compile.js"
import { inputSchema } from "./mcp.js"
import { flagDisplay, positionalDisplay } from "./render.js"
import type { CommandSpec, ParameterSpec } from "./types.js"

// program.spec — the compiled model as one JSON-serializable descriptor
// tree, the Fig lineage of the design: doc generators, prompt UIs, and
// install handshakes consume this instead of parsing help text.

/** projection data is shared by every consumer of a long-lived module —
 * mutation must fail loudly, never corrupt another consumer's view */
export const deepFrozen = <T>(value: T): T => {
  if (globalThis.Array.isArray(value)) {
    return Object.freeze(Array.map(value, deepFrozen)) as T
  }
  if (Predicate.isObject(value) && !Predicate.isFunction(value)) {
    return Object.freeze(Record.map(value as globalThis.Record<string, unknown>, deepFrozen)) as T
  }
  return value
}

/** the spec's promise is JSON.stringify — a morphed default (Date,
 * Map, …) enters the spec in its wire form, or not at all */
const wireSafe = (value: unknown): Option.Option<unknown> =>
  Effect.runSync(
    Effect.try((): Option.Option<unknown> => {
      const encoded = JSON.stringify(value)
      return encoded === undefined ? Option.none() : Option.some(JSON.parse(encoded))
    }).pipe(Effect.orElseSucceed(() => Option.none<unknown>()))
  )

const parameterSpec = (p: CompiledParameter): ParameterSpec => ({
  key: p.key,
  kind: p.binding._tag,
  usage: p.binding._tag === "flag" ? flagDisplay(p) : positionalDisplay(p),
  ...Option.match(p.description, {
    onNone: () => ({}),
    onSome: (description) => ({ description })
  }),
  required: p.binding._tag === "positional" ? !p.binding.optional : p.required,
  variadic: p.binding.variadic,
  boolean: p.isBoolean,
  ...Option.match(Option.flatMap(p.defaultValue, wireSafe), {
    onNone: () => ({}),
    onSome: (defaultValue) => ({ defaultValue })
  }),
  ...Option.match(p.env, { onNone: () => ({}), onSome: (env) => ({ env }) }),
  ...Option.match(p.staticSuggestions, {
    onNone: () => ({}),
    onSome: (suggestions) => ({ suggestions })
  }),
  ...Option.match(p.source, {
    onNone: () => ({}),
    onSome: (suggestionSource) => ({ suggestionSource })
  }),
  ...(Option.isSome(p.generator) ? { dynamicSuggestions: true } : {}),
  hidden: { cli: p.cliHidden, mcp: p.mcpHidden }
})

export const specOf = (cmd: CompiledCommand, version?: string): CommandSpec => ({
  path: cmd.path,
  ...(version === undefined ? {} : { version }),
  description: cmd.description,
  aliases: cmd.cliAliases,
  hidden: { cli: cmd.cliHidden, mcp: cmd.mcpHidden },
  examples: cmd.cliExamples,
  ...Option.match(cmd.cliDefault, {
    onNone: () => ({}),
    onSome: (defaultCommand) => ({ defaultCommand })
  }),
  // mirrors the interpreter: external nodes always invoke the binary,
  // internal nodes need an own handler
  runnable: cmd.kind === "external" ? Option.isSome(cmd.external) : Option.isSome(cmd.run),
  external: cmd.kind === "external",
  ...Option.match(cmd.external, {
    onNone: () => ({}),
    onSome: ({ successCodes }) => ({ successCodes })
  }),
  inputSchema: inputSchema(cmd),
  ...Option.match(cmd.outputType, {
    onNone: () => ({}),
    onSome: (out) =>
      // predicates are not JSON-Schema-representable — omit rather than throw
      Effect.runSync(
        Effect.try(() => ({ outputSchema: (out as AnyType).toJsonSchema() })).pipe(
          Effect.orElseSucceed(() => ({}))
        )
      )
  }),
  parameters: Array.map(cmd.parameters, parameterSpec),
  commands: pipe(Record.values(cmd.children), Array.map((child) => specOf(child)))
})
