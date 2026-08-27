import { type } from "arktype";

import type {
  AnyArkType,
  ArkInput,
  ArkOutput,
  RequireIntrospectable,
} from "./arktype.js";
import type { CompletionSpec, ProcessExecutor } from "./completion.js";
import type {
  AnyArgumentSpec,
  AnyOptionSpec,
  OptionMap,
} from "./parameter.js";
import type {
  MaybePromise,
  NonEmptyReadonlyArray,
  Presentation,
  Simplify,
} from "./shared.js";

type ArgumentValue<Argument extends AnyArgumentSpec> =
  Argument extends { readonly schema: infer Schema extends AnyArkType }
    ? Argument extends { readonly variadic: true }
      ? Argument extends { readonly optional: true }
        ? readonly ArkOutput<Schema>[]
        : readonly [ArkOutput<Schema>, ...ArkOutput<Schema>[]]
      : ArkOutput<Schema>
    : never;

type ArgumentEntry<Argument extends AnyArgumentSpec> =
  Argument extends { readonly default: unknown }
    ? { readonly [Name in Argument["name"]]: ArgumentValue<Argument> }
    : Argument extends { readonly optional: true }
      ? { readonly [Name in Argument["name"]]?: ArgumentValue<Argument> }
      : { readonly [Name in Argument["name"]]: ArgumentValue<Argument> };

type InferArguments<Arguments extends readonly AnyArgumentSpec[]> =
  Arguments extends readonly [
    infer Head extends AnyArgumentSpec,
    ...infer Tail extends readonly AnyArgumentSpec[],
  ]
    ? ArgumentEntry<Head> & InferArguments<Tail>
    : {};

type ValueOptionValue<Option extends AnyOptionSpec> =
  Option extends {
    readonly kind: "option";
    readonly schema: infer Schema extends AnyArkType;
  }
    ? Option extends { readonly repeatable: true | number }
      ? readonly ArkOutput<Schema>[]
      : ArkOutput<Schema>
    : Option extends { readonly kind: "flag" }
      ? boolean
      : Option extends { readonly kind: "counted-flag" }
        ? number
        : never;

type RequiredOptionKeys<Options extends OptionMap> = {
  [Key in keyof Options]: Options[Key] extends {
    readonly kind: "flag" | "counted-flag";
  }
    | { readonly required: true }
    | { readonly default: unknown }
    ? Key
    : never;
}[keyof Options];

type InferOptions<Options extends OptionMap> = Simplify<
  {
    readonly [Key in RequiredOptionKeys<Options>]: ValueOptionValue<
      Options[Key]
    >;
  } & {
    readonly [Key in Exclude<keyof Options, RequiredOptionKeys<Options>>]?:
      ValueOptionValue<Options[Key]>;
  }
>;

export type ParsedCommandInput<
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
> = Simplify<InferArguments<Arguments> & InferOptions<Options>>;

export type CommandArkType<Input> = AnyArkType & {
  readonly inferIn: Input;
};

export type CommandInput<
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
  Schema extends AnyArkType | undefined = undefined,
> = Schema extends AnyArkType
  ? ArkOutput<Schema>
  : ParsedCommandInput<Arguments, Options>;

type ArgumentMap<Arguments extends readonly AnyArgumentSpec[]> = {
  readonly [Argument in Arguments[number] as Argument["name"]]: Argument;
};

export type CommandParameters<
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
> = Simplify<ArgumentMap<Arguments> & Options>;

type CompletionValue<Parameter> = Parameter extends {
  readonly kind: "argument" | "option";
  readonly schema: infer Schema extends AnyArkType;
}
  ? ArkInput<Schema>
  : never;

export type CommandCompletions<
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
  Input,
  Parameters extends CommandParameters<Arguments, Options> = CommandParameters<
    Arguments,
    Options
  >,
> = {
  readonly [Key in keyof Parameters as CompletionValue<Parameters[Key]> extends string
    ? Key
    : never]?: CompletionSpec<
    CompletionValue<Parameters[Key]> & string,
    Input,
    Key & string
  >;
};

export type ParameterRule<Key extends string> =
  | {
      readonly kind: "conflicts";
      readonly parameters: NonEmptyReadonlyArray<Key>;
    }
  | {
      readonly kind: "requires";
      readonly parameter: Key;
      readonly requires: NonEmptyReadonlyArray<Key>;
    }
  | {
      readonly kind: "at-least-one" | "exactly-one";
      readonly parameters: NonEmptyReadonlyArray<Key>;
    };

export interface ParserDirectives {
  readonly optionMode?: "posix" | "single-hyphen-long";
  readonly optionsMustPrecedeArguments?: boolean;
  readonly optionSeparators?: NonEmptyReadonlyArray<string>;
  readonly endOfOptionsMarker?: string;
  readonly allowOptionChaining?: boolean;
}

export interface RawInvocation {
  readonly argv: readonly string[];
  readonly commandPath: readonly string[];
  readonly cwd: string;
}

export interface CommandContext<Input> {
  readonly input: Input;
  readonly invocation: RawInvocation;
  readonly signal: AbortSignal;
  readonly processes: ProcessExecutor;
}

export type CommandHandler<Input, Result> = (
  context: CommandContext<Input>,
) => MaybePromise<Result>;

export interface DynamicCommandContext {
  readonly commandPath: readonly string[];
  readonly words: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly processes: ProcessExecutor;
}

export interface DynamicCommands {
  readonly kind: "dynamic";
  readonly load: (
    context: DynamicCommandContext,
  ) => MaybePromise<readonly AnyCommandSpec[]>;
  readonly cacheKey?:
    | string
    | ((context: DynamicCommandContext) => MaybePromise<string | undefined>);
}

export type CommandSource = AnyCommandSpec | DynamicCommands;

type CommandSchemaProperty<Schema extends AnyArkType | undefined> =
  Schema extends AnyArkType
    ? { readonly schema: Schema }
    : { readonly schema?: never };

export type CommandDefinition<
  Name extends string,
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
  Schema extends AnyArkType | undefined,
  Children extends readonly CommandSource[],
  Result,
> = Presentation & {
  readonly name: Name;
  readonly aliases?: readonly string[];
  readonly arguments?: Arguments;
  readonly options?: Options;
  readonly rules?: readonly ParameterRule<
    keyof CommandParameters<Arguments, Options> & string
  >[];
  readonly completions?: CommandCompletions<
    Arguments,
    Options,
    CommandInput<Arguments, Options, Schema>
  >;
  readonly parser?: ParserDirectives;
  readonly subcommands?: Children;
  readonly requiresSubcommand?: boolean;
  readonly run?: CommandHandler<
    CommandInput<Arguments, Options, Schema>,
    Result
  >;
} & CommandSchemaProperty<Schema>;

declare const commandBrand: unique symbol;

export type CommandSpec<
  Name extends string,
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
  Schema extends AnyArkType | undefined,
  Children extends readonly CommandSource[],
  Result,
> = Readonly<
  CommandDefinition<Name, Arguments, Options, Schema, Children, Result> & {
    readonly [commandBrand]: {
      readonly input: CommandInput<Arguments, Options, Schema>;
      readonly result: Result;
    };
  }
>;

export interface AnyCommandSpec extends Presentation {
  readonly name: string;
  readonly [commandBrand]: {
    readonly input: unknown;
    readonly result: unknown;
  };
}

export type CommandInputOf<Command extends AnyCommandSpec> =
  Command[typeof commandBrand]["input"];

export type CommandResultOf<Command extends AnyCommandSpec> =
  Command[typeof commandBrand]["result"];

declare const commandConstraint: unique symbol;

type CommandConstraint<Message extends string> = {
  readonly [commandConstraint]: Message;
};

type FirstDuplicateArgument<
  Arguments extends readonly AnyArgumentSpec[],
  Seen extends string = never,
> = Arguments extends readonly [
  infer Head extends AnyArgumentSpec,
  ...infer Tail extends readonly AnyArgumentSpec[],
]
  ? Head["name"] extends Seen
    ? Head["name"]
    : FirstDuplicateArgument<Tail, Seen | Head["name"]>
  : never;

type ArgumentOrderError<
  Arguments extends readonly AnyArgumentSpec[],
  OptionalSeen extends boolean = false,
> = Arguments extends readonly [
  infer Head extends AnyArgumentSpec,
  ...infer Tail extends readonly AnyArgumentSpec[],
]
  ? Head extends { readonly variadic: true }
    ? Tail extends readonly []
      ? never
      : `variadic argument '${Head["name"]}' must be last`
    : Head extends { readonly optional: true }
      ? ArgumentOrderError<Tail, true>
      : OptionalSeen extends true
        ? `required argument '${Head["name"]}' cannot follow an optional argument`
        : ArgumentOrderError<Tail, false>
  : never;

type OptionSpellings<Option extends AnyOptionSpec> = Option["names"][number];

type CollidingOptionSpellings<Options extends OptionMap> = {
  [Key in keyof Options]: Extract<
    OptionSpellings<Options[Key]>,
    OptionSpellings<Options[Exclude<keyof Options, Key>]>
  >;
}[keyof Options];

type CommandCollisions<
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
> =
  | FirstDuplicateArgument<Arguments>
  | Extract<Arguments[number]["name"], keyof Options>
  | CollidingOptionSpellings<Options>;

type ValidateCommand<
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
  Schema extends AnyArkType | undefined,
  Parsed = ParsedCommandInput<Arguments, Options>,
> =
  CommandCollisions<Arguments, Options> extends infer Collision
  ? [Collision] extends [never]
    ? ArgumentOrderError<Arguments> extends infer OrderError
      ? [OrderError] extends [never]
        ? Schema extends AnyArkType
          ? [ArkInput<Schema>] extends [Parsed]
            ? [Parsed] extends [ArkInput<Schema>]
              ? RequireIntrospectable<Schema>
              : CommandConstraint<"command schema input must include every parsed parameter">
            : CommandConstraint<"command schema input contains values not produced by the command grammar">
          : unknown
        : CommandConstraint<OrderError & string>
      : never
    : CommandConstraint<`duplicate parameter or option spelling '${Collision & string}'`>
  : never;

type CommandDefinitionBase<
  Name extends string,
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
  Children extends readonly CommandSource[],
> = Presentation & {
  // Schema-dependent fields stay separate so they cannot widen schema
  // definitions while TypeScript is inferring command literals.
  readonly name: Name;
  readonly aliases?: readonly string[];
  readonly arguments?: Arguments;
  readonly options?: Options;
  readonly rules?: readonly ParameterRule<
    keyof CommandParameters<Arguments, Options> & string
  >[];
  readonly parser?: ParserDirectives;
  readonly subcommands?: Children;
  readonly requiresSubcommand?: boolean;
};

type CommandBehavior<
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
  Input,
  Result,
> = {
  readonly completions?: CommandCompletions<Arguments, Options, Input>;
  readonly run?: CommandHandler<Input, Result>;
};

type CommandSchema<Definition> = type.instantiate<Definition>;

type ValidateCommandDefinition<
  Definition,
  Arguments extends readonly AnyArgumentSpec[],
  Options extends OptionMap,
> = Definition extends type.validate<Definition>
  ? ValidateCommand<
      Arguments,
      Options,
      NoInfer<CommandSchema<Definition>>
    >
  : unknown;

export function command<
  const Name extends string,
  const Arguments extends readonly AnyArgumentSpec[] = readonly [],
  const Options extends OptionMap = {},
  const Children extends readonly CommandSource[] = readonly [],
  Result = never,
>(
  definition: CommandDefinitionBase<
    Name,
    Arguments,
    Options,
    Children
  > &
    CommandBehavior<
      Arguments,
      Options,
      CommandInput<Arguments, Options>,
      Result
    > & { readonly schema?: never } &
    ValidateCommand<Arguments, Options, undefined>,
): CommandSpec<Name, Arguments, Options, undefined, Children, Result>;

export function command<
  const Definition,
  const Name extends string,
  const Arguments extends readonly AnyArgumentSpec[] = readonly [],
  const Options extends OptionMap = {},
  const Children extends readonly CommandSource[] = readonly [],
  Result = never,
>(
  definition: CommandDefinitionBase<Name, Arguments, Options, Children> &
    CommandBehavior<
      Arguments,
      Options,
      CommandInput<
        Arguments,
        Options,
        CommandSchema<NoInfer<Definition>>
      >,
      Result
    > & {
      readonly schema: type.validate<Definition>;
    } &
    ValidateCommandDefinition<
      NoInfer<Definition>,
      Arguments,
      Options
    >,
): CommandSpec<
  Name,
  Arguments,
  Options,
  CommandSchema<Definition>,
  Children,
  Result
> & { readonly schema: CommandSchema<Definition> };

export function command(definition: object): AnyCommandSpec {
  const normalized =
    "schema" in definition
      ? { ...definition, schema: type.raw(definition.schema) }
      : definition;

  return normalized as unknown as AnyCommandSpec;
}
