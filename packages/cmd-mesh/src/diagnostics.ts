import { defineDiagnostics } from "nostics"

// declaration diagnostics: stable codes users can search and docs can
// anchor. the error CHANNEL stays the tagged classes in errors.ts —
// these handles only build coded, fix-carrying issue text at the
// validation boundary. no reporters: construction is pure.

export const diagnostics = defineDiagnostics({
  docsBase: (code) =>
    `https://github.com/tyler-mitchell/cmd-mesh/blob/main/packages/cmd-mesh/docs/errors.md#${code.toLowerCase()}`,
  codes: {
    CMSH1001: {
      why: (p: { error: string }) => p.error,
      fix: "Use a resolvable ArkType definition."
    },
    CMSH1002: {
      why: () => "a positional cannot be boolean — booleans are flag presence",
      fix: "Bind the parameter as a flag."
    },
    CMSH1003: {
      why: () => "env fallback is only meaningful on flags",
      fix: "Move the env fallback to a flag binding or remove it."
    },
    CMSH1004: {
      why: () => "a positional cannot be cli-hidden — it would corrupt argv order",
      fix: "Hide it from mcp instead, or bind it as a flag."
    },
    CMSH1005: {
      why: () => "a boolean flag cannot take a value slot — presence is its value",
      fix: "Drop the value slot from the usage."
    },
    CMSH1006: {
      why: (p: { token: string; owners: string }) => `flag ${p.token} is claimed by ${p.owners}`,
      fix: "Rename one of the flags or aliases."
    },
    CMSH1007: {
      why: () => "variadic positional must be the last positional",
      fix: "Move the variadic parameter after every other positional."
    },
    CMSH1008: {
      why: () => "cannot declare both run and cli.default",
      fix: "Keep the handler or the default subcommand, not both."
    },
    CMSH1009: {
      why: (p: { name: string }) => `cli.default names a missing subcommand: ${p.name}`,
      fix: "Name an existing subcommand or one of its aliases."
    },
    CMSH1010: {
      why: (p: { got: string }) => `safety must be "read", "action" or "destructive" (got: ${p.got})`,
      fix: "Declare one of the three safety values or omit the field."
    },
    CMSH1011: {
      why: (p: { index: number; args: string }) =>
        `mcp.examples[${p.index}] does not satisfy the command's input schema: ${p.args}`,
      fix: "Make the example's args pass the command's own input types."
    },
    CMSH1012: {
      why: (p: { token: string; owners: string }) =>
        `subcommand name ${p.token} is claimed by ${p.owners}`,
      fix: "Rename one of the subcommands or aliases."
    }
  }
})

/** one issue line: code-led, fix-carrying, docs-anchored */
export const issueText = (diagnostic: {
  readonly code: string
  readonly why: string
  readonly fix?: string
}): string =>
  diagnostic.fix === undefined
    ? `${diagnostic.code}: ${diagnostic.why}`
    : `${diagnostic.code}: ${diagnostic.why} (fix: ${diagnostic.fix})`
