# Declaration errors

`program()` and `external()` validate the whole declaration and throw
one `InvalidDeclaration` listing every problem, each line carrying its
command path, a stable code from this page, and a fix:

```
invalid declaration:
  tool broken · bad: CMSH1001: ParseError: 'not.a.keyword' is unresolvable (fix: Use a resolvable ArkType definition.)
  tool broken: CMSH1006: flag --same is claimed by flag and other (fix: Rename one of the flags or aliases.)
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
