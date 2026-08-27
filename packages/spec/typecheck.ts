import { type } from "arktype";

import {
  argument,
  command,
  countedFlag,
  flag,
  option,
  program,
  type ArkInput,
  type ArkTypeFromDefinition,
  type CommandInputOf,
  type CommandResultOf,
  type ParsedCommandInput,
} from "./src/index.js";

const Port = "string.integer.parse";
const Environment = "'development' | 'production'";
const Output = {
  directory: "string",
  environment: "'development' | 'production' = 'development'",
  port: "number",
  verbose: "boolean",
  verbosity: "number",
} as const;

const serveArguments = [argument("directory", "string")] as const;
const serveOptions = {
  port: option(["-p", "--port"], Port, { required: true }),
  environment: option(["-e", "--environment"], Environment),
  verbose: flag(["-v", "--verbose"]),
  verbosity: countedFlag(["-V"]),
} as const;

type ParsedServeInput = ParsedCommandInput<
  typeof serveArguments,
  typeof serveOptions
>;
type DeclaredServeInput = ArkInput<ArkTypeFromDefinition<typeof Output>>;

declare const parsedServeInput: ParsedServeInput;
declare const declaredServeInput: DeclaredServeInput;

const acceptsParsedInput: DeclaredServeInput = parsedServeInput;
const grammarProducesDeclaredInput: ParsedServeInput = declaredServeInput;

const serve = command({
  name: "serve",
  arguments: serveArguments,
  options: serveOptions,
  schema: Output,
  completions: {
    environment: {
      suggestions: ["development", "production"],
      providers: [({ input }) =>
        input.port === 3000
          ? (["development"] as const)
          : (["production"] as const)],
    },
  },
  run: ({ input }) => {
    input.port satisfies number;
    input.environment satisfies "development" | "production";
    input.verbose satisfies boolean;
    input.verbosity satisfies number;
    return input;
  },
});

type ServeInput = CommandInputOf<typeof serve>;
type ServeResult = CommandResultOf<typeof serve>;
const input: ServeInput = {
  directory: ".",
  environment: "development",
  port: 3000,
  verbose: false,
  verbosity: 0,
};
const result: ServeResult = input;

// @ts-expect-error command results retain the handler's inferred return type
const invalidResult: ServeResult = "not a serve result";

const spec = program({ root: serve, version: "0.0.0" });

void input;
void result;
void invalidResult;
void spec;
void acceptsParsedInput;
void grammarProducesDeclaredInput;

const opaqueMorph = type("string").pipe((value) => value.length);
const existingType = type("string");

argument("existing", existingType);

option(["--default-port"], "string.integer.parse", { default: 3000 });

option(["--invalid-default-port"], "string.integer.parse", {
  // @ts-expect-error defaults use the definition's inferred output type
  default: "3000",
});

// @ts-expect-error opaque morph outputs need an ArkType `.to(...)` validator
option(["--length"], opaqueMorph);

// @ts-expect-error CLI value schemas consume strings, not numbers
argument("count", "number");

// @ts-expect-error invalid definitions retain ArkType's parser diagnostics
argument("invalid", "strng");

// @ts-expect-error option spellings must begin with a hyphen
flag(["verbose"]);

// @ts-expect-error optional positional arguments cannot precede required ones
command({
  name: "invalid-order",
  arguments: [
    argument("first", "string", { optional: true }),
    argument("second", "string"),
  ],
});

// @ts-expect-error option spellings are unique across a command
command({
  name: "duplicate-options",
  options: {
    first: flag(["-x"]),
    second: flag(["-x", "--extra"]),
  },
});

// @ts-expect-error command schema input must match the grammar-derived object
command({
  name: "invalid-schema",
  arguments: [argument("path", "string")],
  schema: { other: "string" },
});

command({
  name: "invalid-schema-definition",
  // @ts-expect-error command schemas retain ArkType's parser diagnostics
  schema: "strng",
});

command({
  name: "invalid-completion",
  options: {
    environment: option(["--environment"], Environment),
  },
  completions: {
    environment: {
      // @ts-expect-error completion values come from the parameter Type input
      suggestions: ["staging"],
    },
  },
});

command({
  name: "invalid-rule",
  options: { verbose: flag(["--verbose"]) },
  rules: [
    {
      kind: "requires",
      parameter: "verbose",
      // @ts-expect-error rules reference logical parameter keys
      requires: ["missing"],
    },
  ],
});
