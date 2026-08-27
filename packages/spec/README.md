# `@command-mesh/spec`

`@command-mesh/spec` is the canonical command program model. It combines a
Fig-inspired command grammar with ArkType-compatible definitions that validate
and transform values at runtime.

Arguments, options, and commands accept the same definitions as ArkType's
one-argument `type(definition)` API. Command Mesh compiles each definition to a
concrete Type internally; consumers do not need to import or call ArkType.
Each parameter definition must accept one CLI string token, and its output is
the value exposed to handlers and completion providers.

```ts
import { argument, command, flag, option, program } from "@command-mesh/spec";

const serve = command({
  name: "serve",
  arguments: [argument("directory", "string")],
  options: {
    port: option(["-p", "--port"], "string.integer.parse", {
      required: true,
    }),
    verbose: flag(["-v", "--verbose"]),
  },
  run: ({ input }) => {
    input.directory satisfies string;
    input.port satisfies number;
    input.verbose satisfies boolean;
  },
});

export default program({ root: serve });
```

An optional command-level definition validates the assembled parameter object.
It is the place for defaults, cross-field invariants, and whole-invocation
morphs. Its input must match the grammar-derived object, and its output becomes
the handler input. Existing ArkType Types remain valid definitions for advanced
composition, but they are never required.

The package deliberately contains no citty, Tab, MCP, Effect, or tinyexec
types. Those integrations project or execute this model through adapters.

Type inference is covered with `@ark/attest` in `spec.attest.ts`. Run the full
type suite with:

```sh
pnpm test:types
```
