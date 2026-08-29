# Declaration errors

`program()` and `external()` validate the whole declaration and throw
one `InvalidDeclaration` listing every problem. Each line carries its
command path, a stable code from this page, a fix, and a link to the
section for that code:

```
invalid declaration:
  tool broken · bad: CMSH1001: ParseError: 'not.a.keyword' is unresolvable (fix: Use a resolvable ArkType definition.) https://github.com/tyler-mitchell/cmd-mesh/blob/main/packages/cmd-mesh/docs/errors.md#cmsh1001
  tool broken: CMSH1006: flag --same is claimed by flag and other (fix: Rename one of the flags or aliases.) https://github.com/tyler-mitchell/cmd-mesh/blob/main/packages/cmd-mesh/docs/errors.md#cmsh1006
```

## CMSH1001

An ArkType definition did not parse — a parameter `type`, an `output`
contract, or the assembled command schema.

```ts
input: { bad: { type: "not.a.keyword" } }  // ✗ unresolvable keyword
input: { bad: { type: "string.numeric" } } // ✓
```

Fix: use a resolvable ArkType definition.

## CMSH1002

A positional parameter compiled to a boolean. Booleans are flag
presence; a positional slot has no presence semantics.

```ts
flag: { type: "boolean", cli: "<flag>" }   // ✗
flag: { type: "boolean", cli: "--flag" }   // ✓
```

## CMSH1003

`env` fallback declared on a positional. The argv > env > default chain
is flag machinery.

```ts
entry: { type: "string", cli: { usage: "<entry>", env: "TOOL_ENTRY" } }  // ✗
entry: { type: "string", cli: { usage: "--entry", env: "TOOL_ENTRY" } }  // ✓
```

## CMSH1004

A positional marked `cli: { hidden: true }`. Hiding a positional would
corrupt argv order for everything after it.

Fix: hide it from mcp instead (`mcp: { hidden: true }`), or bind it as
a flag.

## CMSH1005

A boolean flag declared with a value slot (`--flag <value...>`).
Presence is a boolean flag's value.

## CMSH1006

Two parameters claim the same flag token, aliases included.

```ts
first: { type: "string", cli: "--same" },
second: { type: "string", cli: "--same" }   // ✗ both claim --same
```

## CMSH1007

A variadic positional appears before another positional. The variadic
consumes every remaining token, so it must be last.

```ts
files: { type: "string", cli: "[...files]" },
out: { type: "string", cli: "[out]" }        // ✗ unreachable
```

## CMSH1008

A command declares both `run` and `cli.default`. A group delegates to
its default child or runs itself — one owner.

## CMSH1009

`cli.default` names a subcommand that does not exist under the command,
by canonical name or alias.

## CMSH1010

`safety` is not one of `"read"`, `"action"`, `"destructive"`.

## CMSH1011

A declared `mcp.examples` entry fails the command's own input schema.
Examples are advertised to agents; a lying example is a declaration
error.

```ts
input: { who: { type: "string", cli: "<who>" } },
mcp: { examples: [{ args: { who: 7 } }] }    // ✗ who must be a string
```

## CMSH1012

Two subcommands claim the same name, aliases included. A subcommand
token must resolve to exactly one child.

## CMSH1013

A parameter or a command has a field that the model does not have.

TypeScript does not find all of these fields. It reports an unknown
field when the type is one object. It does not report an unknown field
when the type is a union with a primitive. Parameters have this union
type: `ParameterDef` is `string | ParameterDescriptor`, and `cli` is
`string | CliParameterConfig`. A JavaScript caller has no check. Thus
the interpreter rejects the declaration.

```ts
paths: { type: "string", cli: { usage: "<...paths>", complete: "filepaths" } }  // ✗ no cli.complete
paths: { type: "string", suggest: "filepaths", cli: "<...paths>" }              // ✓
```

The check also applies to command fields. An incorrect name in `mcp` is
more dangerous. `mcp: { hiden: true }` does not set `mcp.hidden`. The
command stays visible to agents.

Parameter fields are `type`, `description`, `suggest`, `required`,
`cli`, `mcp`; the parameter `cli` object takes `usage`, `env`, `hidden`,
and the parameter `mcp` object takes `hidden`.
Command fields are `description`, `input`, `output`, `narrow`, `run`,
`safety`, `commands`, `cli`, `mcp`, `successCodes`, plus `name`,
`version`, `resources` and `bin` at a declaration root; the command
`cli` object takes `hidden`, `alias`, `default`, `render`, `examples`,
and `mcp` takes `hidden`, `name`, `annotations`, `examples`.

## CMSH1014

The `suggest` field names a source that the model does not know. A
string value must be a named source. An unknown name gives no candidates
and shows no error.

```ts
paths: { type: "string", suggest: "flepaths" }              // ✗ lists nothing
paths: { type: "string", suggest: "filepaths" }             // ✓ files and folders
paths: { type: "string", suggest: "folders" }               // ✓ folders only
paths: { type: "string", suggest: ["src", "test"] }         // ✓ a static list
```

The named sources are `filepaths` and `folders`. For other candidates,
use a list of values or a generator function.

## CMSH1015

A parameter is hidden from mcp but the value boundary requires it. The
tool schema does not show the parameter, so an agent cannot supply it,
and every call fails validation. The `env` fallback does not help: it
runs on the cli path only.

```ts
token: { type: "string", required: true, mcp: { hidden: true } }   // ✗ tool is uncallable
token: { type: "string", mcp: { hidden: true } }                   // ✓ optional
token: { type: "string = ''", mcp: { hidden: true } }              // ✓ defaulted
```

To keep a required parameter and still hide the work from agents, hide
the whole command with `mcp: { hidden: true }` on the command.
