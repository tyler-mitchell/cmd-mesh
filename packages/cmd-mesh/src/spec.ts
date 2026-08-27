import { Array, Option, Predicate, Record, pipe } from "effect"
import type { CompiledCommand, CompiledParameter } from "./compile.js"

// the spec projection: the compiled model back out as pure data, functions
// stripped — what completion daemons, docs, and other spec-only consumers eat.

const parameterSpec = (p: CompiledParameter): unknown => ({
  type: p.def,
  binding: p.binding,
  ...Option.match(p.description, { onNone: () => ({}), onSome: (description) => ({ description }) }),
  ...Option.match(p.source, { onNone: () => ({}), onSome: (suggest) => ({ suggest }) }),
  ...Option.match(p.staticSuggestions, { onNone: () => ({}), onSome: (suggest) => ({ suggest }) }),
  ...Option.match(p.env, { onNone: () => ({}), onSome: (env) => ({ env }) }),
  ...Option.match(p.defaultValue, {
    onNone: () => ({}),
    onSome: (value) => (Predicate.isFunction(value) ? {} : { default: value })
  })
})

export const commandSpec = (cmd: CompiledCommand): unknown => ({
  name: cmd.name,
  kind: cmd.kind,
  description: cmd.description,
  runnable: Option.isSome(cmd.run) || Option.isSome(cmd.external),
  input: pipe(
    cmd.parameters,
    Array.map((p) => [p.key, parameterSpec(p)] as const),
    Record.fromEntries
  ),
  ...(Record.isEmptyRecord(cmd.children) ? {} : {
    commands: Record.map(cmd.children, commandSpec)
  }),
  ...(cmd.cliHidden ? { cli: { hidden: true } } : {}),
  ...(cmd.mcpHidden ? { mcp: { hidden: true } } : {})
})
