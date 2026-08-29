export interface FigOption {
  readonly name: string | ReadonlyArray<string>
  readonly description?: string
  readonly args?: { readonly name: string; readonly isOptional?: boolean }
}

export interface FigSubcommand {
  readonly name: string
  readonly description?: string
  readonly args?: {
    readonly name: string
    readonly isOptional?: boolean
    readonly isVariadic?: boolean
    readonly template?: string
  }
  readonly options?: ReadonlyArray<FigOption>
}

/** the conversion is generation, not adoption: Fig specs carry no
 * requiredness for option values and no output contracts, so the
 * curation allowlist is mandatory — an uncurated program floods 100+
 * options per command */
export interface FigConversion {
  readonly bin: string
  readonly subcommands: ReadonlyArray<FigSubcommand>
  readonly curation: Readonly<Record<string, ReadonlyArray<string>>>
}

const camel = (kebab: string): string =>
  kebab.replace(/^-+/, "").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())

const flagUsage = (name: string | ReadonlyArray<string>): { readonly key: string; readonly usage: string } => {
  const names = typeof name === "string" ? [name] : [...name]
  const long = names.find((n) => n.startsWith("--")) ?? names[0]!
  const short = names.find((n) => /^-[^-]/.test(n))
  return {
    key: camel(long),
    usage: short === undefined ? long : `${long}, ${short}`
  }
}

const templateComplete = (template: string | undefined): Readonly<Record<string, unknown>> =>
  template === "filepaths" || template === "folders" ? { complete: template } : {}

const convertSubcommand = (sub: FigSubcommand, allow: ReadonlyArray<string>) => {
  const positional = sub.args === undefined
    ? {}
    : {
      [camel(sub.args.name)]: {
        type: "string",
        cli: {
          usage: sub.args.isVariadic === true
            ? sub.args.isOptional === true ? `[...${sub.args.name}]` : `<...${sub.args.name}>`
            : sub.args.isOptional === true ? `[${sub.args.name}]` : `<${sub.args.name}>`,
          ...templateComplete(sub.args.template)
        }
      }
    }
  const flags = Object.fromEntries(
    (sub.options ?? [])
      .filter((option) => {
        const names = typeof option.name === "string" ? [option.name] : option.name
        return names.some((n) => allow.includes(n))
      })
      .map((option) => {
        const { key, usage } = flagUsage(option.name)
        return [key, {
          type: option.args === undefined ? "boolean" : "string",
          ...(option.description === undefined ? {} : { description: option.description }),
          cli: usage
        }]
      })
  )
  return {
    ...(sub.description === undefined ? {} : { description: sub.description }),
    input: { ...positional, ...flags },
    output: "string"
  }
}

/** convert a Fig completion spec subset (withfig/autocomplete shape)
 * into an `external()` declaration. runtime-only Fig fields
 * (generators, insertValue, icon, priority) are ignored; the curation
 * allowlist names, per subcommand, exactly the flag tokens to keep */
export const figToExternal = (conversion: FigConversion): never =>
  ({
    name: conversion.bin,
    description: `the ${conversion.bin} binary as a typed surface`,
    commands: Object.fromEntries(
      conversion.subcommands
        .filter((sub) => conversion.curation[sub.name] !== undefined)
        .map((sub) => [sub.name, convertSubcommand(sub, conversion.curation[sub.name]!)])
    )
  }) as never
