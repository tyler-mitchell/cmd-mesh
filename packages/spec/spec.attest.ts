import { attest, setup, teardown } from "@ark/attest";

import {
  argument,
  command,
  countedFlag,
  flag,
  option,
  program,
  type ArkInput,
  type ArkOutput,
  type ArkTypeFromDefinition,
  type CommandInputOf,
  type CommandResultOf,
  type ParsedCommandInput,
} from "./dist/index.js";

setup({
  shouldFormat: false,
  tsconfig: "./tsconfig.attest.json",
});

try {
  const Port = "string.integer.parse";
  const Environment = "'development' | 'production'";

  attest({} as ArkInput<ArkTypeFromDefinition<typeof Port>>).type.toString.snap("string");
  attest({} as ArkOutput<ArkTypeFromDefinition<typeof Port>>).type.toString.snap("number");

  const directory = argument("directory", "string");
  const port = option(["-p", "--port"], Port, { required: true });

  attest({} as ArkInput<typeof directory.schema>).type.toString.snap("string");
  attest({} as ArkInput<typeof port.schema>).type.toString.snap("string");
  attest({} as ArkOutput<typeof port.schema>).type.toString.snap("number");
  attest(port.schema.assert("3000")).equals(3000);

  const format = option(
    ["--format"],
    ["'json'", "|", "'text'"],
  );
  const slug = argument("slug", /^[a-z]+$/);

  attest({} as ArkInput<typeof format.schema>).type.toString.snap('"json" | "text"');
  attest({} as ArkOutput<typeof format.schema>).type.toString.snap('"json" | "text"');
  attest({} as ArkInput<typeof slug.schema>).type.toString.snap("string");
  attest({} as ArkOutput<typeof slug.schema>).type.toString.snap("string");
  attest(format.schema.assert("json")).equals("json");
  attest(slug.schema.assert("command")).equals("command");

  const serveArguments = [directory] as const;
  const serveOptions = {
    port,
    environment: option(["-e", "--environment"], Environment),
    verbose: flag(["-v", "--verbose"]),
    verbosity: countedFlag(["-V"]),
  } as const;

  attest({} as ParsedCommandInput<
    typeof serveArguments,
    typeof serveOptions
  >).type.toString.snap(`{
  readonly directory: string
  readonly verbose: boolean
  readonly port: number
  readonly verbosity: number
  readonly environment?: "development" | "production"
}`);

  const serve = command({
    name: "serve",
    arguments: serveArguments,
    options: serveOptions,
    schema: {
      directory: "string",
      environment: "'development' | 'production' = 'development'",
      port: "number",
      verbose: "boolean",
      verbosity: "number",
    },
    run: ({ input }) => input,
  });

  attest(serve.schema.inferIn).type.toString.snap(`{
  directory: string
  port: number
  verbose: boolean
  verbosity: number
  environment?: "development" | "production"
}`);
  attest(serve.schema.infer).type.toString.snap(`{
  directory: string
  environment: "development" | "production"
  port: number
  verbose: boolean
  verbosity: number
}`);
  attest({} as CommandInputOf<typeof serve>).type.toString.snap(`{
  directory: string
  environment: "development" | "production"
  port: number
  verbose: boolean
  verbosity: number
}`);
  attest({} as CommandResultOf<typeof serve>).type.toString.snap(`{
  directory: string
  environment: "development" | "production"
  port: number
  verbose: boolean
  verbosity: number
}`);

  // @ts-expect-error command schema definitions retain ArkType diagnostics
  attest(() => command({ name: "invalid-definition", arguments: [argument("directory", "string")], schema: { directory: "3ioefjfoiejf88f8)))__" } })).throwsAndHasTypeError(/'3ioefjfoiejf88f8' is unresolvable/);

  // @ts-expect-error command schema input must match grammar-derived input
  attest(() => command({ name: "mismatched-schema", arguments: [argument("value", "string")], schema: { other: "string" } })).type.errors(/command schema input contains values not produced by the command grammar/);

  const declarative = command({
    name: "declarative",
    arguments: [argument("value", "string")],
    schema: { value: "string" },
  });
  const schemaLess = command({ name: "schema-less" });
  const schemaLessRunnable = command({
    name: "schema-less-runnable",
    run: () => 42 as const,
  });

  attest(declarative.schema.infer).type.toString.snap("{ value: string }");
  attest({} as CommandResultOf<typeof declarative>).type.toString.snap("never");
  attest(schemaLess.schema).type.toString.snap("undefined");
  attest({} as CommandResultOf<typeof schemaLess>).type.toString.snap("never");
  attest({} as CommandInputOf<typeof schemaLessRunnable>).type.toString.snap("{}");
  attest({} as CommandResultOf<typeof schemaLessRunnable>).type.toString.snap("42");
  attest(serve.schema.assert({
    directory: ".",
    port: 3000,
    verbose: false,
    verbosity: 0,
  })).equals({
    directory: ".",
    environment: "development",
    port: 3000,
    verbose: false,
    verbosity: 0,
  });

  const specification = program({ root: serve });
  attest(specification.root).is(serve);
} finally {
  teardown();
}
