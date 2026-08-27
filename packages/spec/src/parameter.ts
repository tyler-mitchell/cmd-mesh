import { type } from "arktype";

import type {
  AnyArkType,
  ArkInput,
  ArkOutput,
  RequireIntrospectableDefinition,
  RequireTokenInput,
  TokenArkType,
  TokenArkTypeFromDefinition,
} from "./arktype.js";
import type { CompletionCandidateLike } from "./completion.js";
import type {
  DefaultValue,
  NonEmptyReadonlyArray,
  Presentation,
} from "./shared.js";

export type OptionName = `-${string}`;

export type OptionValueSyntax =
  | { readonly kind: "separate" }
  | {
      readonly kind: "attached";
      readonly separators: NonEmptyReadonlyArray<string>;
    }
  | {
      readonly kind: "separate-or-attached";
      readonly separators: NonEmptyReadonlyArray<string>;
    };

interface ParameterPresentation<Value extends string> extends Presentation {
  readonly valueName?: string;
  readonly suggestions?: readonly CompletionCandidateLike<Value>[];
  readonly sensitive?: boolean;
}

type WithoutDefault = { readonly default?: never };

type WithDefault<Value> = {
  readonly optional: true;
  readonly default: DefaultValue<Value>;
};

type NonVariadicArgumentConfig<Schema extends TokenArkType> =
  ParameterPresentation<ArkInput<Schema>> &
    { readonly variadic?: false } &
    (
      | ({ readonly optional?: boolean } & WithoutDefault)
      | WithDefault<ArkOutput<Schema>>
    );

type VariadicArgumentConfig<Schema extends TokenArkType> =
  ParameterPresentation<ArkInput<Schema>> &
    { readonly variadic: true; readonly optionsCanInterrupt?: boolean } &
    (
      | ({ readonly optional?: boolean } & WithoutDefault)
      | WithDefault<readonly ArkOutput<Schema>[]>
    );

export type ArgumentConfig<Schema extends TokenArkType> =
  | NonVariadicArgumentConfig<Schema>
  | VariadicArgumentConfig<Schema>;

declare const parameterBrand: unique symbol;

export type ArgumentSpec<
  Name extends string,
  Schema extends TokenArkType,
  Config extends ArgumentConfig<Schema>,
> = Readonly<
  {
    readonly kind: "argument";
    readonly name: Name;
    readonly schema: Schema;
    readonly [parameterBrand]: "argument";
  } & Config
>;

export type AnyArgumentSpec = ArgumentSpec<
  string,
  TokenArkType,
  ArgumentConfig<TokenArkType>
>;

interface BaseOptionConfig extends Presentation {
  readonly persistent?: boolean;
  readonly valueSyntax?: OptionValueSyntax;
}

type ScalarOptionConfig<Schema extends TokenArkType> = BaseOptionConfig &
  ParameterPresentation<ArkInput<Schema>> &
  { readonly repeatable?: false } &
  (
    | ({ readonly required?: boolean } & WithoutDefault)
    | {
        readonly required?: false;
        readonly default: DefaultValue<ArkOutput<Schema>>;
      }
  );

type RepeatedOptionConfig<Schema extends TokenArkType> = BaseOptionConfig &
  ParameterPresentation<ArkInput<Schema>> &
  { readonly repeatable: true | number } &
  (
    | ({ readonly required?: boolean } & WithoutDefault)
    | {
        readonly required?: false;
        readonly default: DefaultValue<readonly ArkOutput<Schema>[]>;
      }
  );

export type ValueOptionConfig<Schema extends TokenArkType> =
  | ScalarOptionConfig<Schema>
  | RepeatedOptionConfig<Schema>;

export type ValueOptionSpec<
  Names extends NonEmptyReadonlyArray<OptionName>,
  Schema extends TokenArkType,
  Config extends ValueOptionConfig<Schema>,
> = Readonly<
  {
    readonly kind: "option";
    readonly names: Names;
    readonly schema: Schema;
    readonly [parameterBrand]: "option";
  } & Config
>;

export interface FlagConfig extends Presentation {
  readonly default?: boolean;
  readonly required?: boolean;
  readonly persistent?: boolean;
  readonly negatedNames?: readonly OptionName[];
}

export type FlagSpec<
  Names extends NonEmptyReadonlyArray<OptionName>,
  Config extends FlagConfig,
> = Readonly<
  {
    readonly kind: "flag";
    readonly names: Names;
    readonly schema: typeof BooleanFlag;
    readonly [parameterBrand]: "flag";
  } & Config
>;

export interface CountedFlagConfig extends Presentation {
  readonly maximum?: number;
  readonly persistent?: boolean;
}

export type CountedFlagSpec<
  Names extends NonEmptyReadonlyArray<OptionName>,
  Config extends CountedFlagConfig,
> = Readonly<
  {
    readonly kind: "counted-flag";
    readonly names: Names;
    readonly schema: typeof CountedFlag;
    readonly [parameterBrand]: "counted-flag";
  } & Config
>;

export type AnyOptionSpec =
  | ValueOptionSpec<
      NonEmptyReadonlyArray<OptionName>,
      TokenArkType,
      ValueOptionConfig<TokenArkType>
    >
  | FlagSpec<NonEmptyReadonlyArray<OptionName>, FlagConfig>
  | CountedFlagSpec<
      NonEmptyReadonlyArray<OptionName>,
      CountedFlagConfig
    >;

export type OptionMap = Readonly<Record<string, AnyOptionSpec>>;

export const BooleanFlag = type("boolean");

export const CountedFlag = type("number.integer").narrow(
  (count): count is number => count >= 0,
);

export function argument<
  const Name extends string,
  const Definition,
>(
  name: Name,
  schema: type.validate<Definition> &
    RequireTokenInput<Definition> &
    RequireIntrospectableDefinition<Definition>,
): ArgumentSpec<Name, TokenArkTypeFromDefinition<Definition>, {}>;

export function argument<
  const Name extends string,
  const Definition,
  const Config extends ArgumentConfig<
    TokenArkTypeFromDefinition<Definition>
  >,
>(
  name: Name,
  schema: type.validate<Definition> &
    RequireTokenInput<Definition> &
    RequireIntrospectableDefinition<Definition>,
  config: Config,
): ArgumentSpec<Name, TokenArkTypeFromDefinition<Definition>, Config>;

export function argument(
  name: string,
  schema: unknown,
  config?: object,
): AnyArgumentSpec {
  return {
    ...config,
    kind: "argument",
    name,
    schema: type.raw(schema),
  } as unknown as AnyArgumentSpec;
}

export function option<
  const Names extends NonEmptyReadonlyArray<OptionName>,
  const Definition,
>(
  names: Names,
  schema: type.validate<Definition> &
    RequireTokenInput<Definition> &
    RequireIntrospectableDefinition<Definition>,
): ValueOptionSpec<Names, TokenArkTypeFromDefinition<Definition>, {}>;

export function option<
  const Names extends NonEmptyReadonlyArray<OptionName>,
  const Definition,
  const Config extends ValueOptionConfig<
    TokenArkTypeFromDefinition<Definition>
  >,
>(
  names: Names,
  schema: type.validate<Definition> &
    RequireTokenInput<Definition> &
    RequireIntrospectableDefinition<Definition>,
  config: Config,
): ValueOptionSpec<Names, TokenArkTypeFromDefinition<Definition>, Config>;

export function option(
  names: NonEmptyReadonlyArray<OptionName>,
  schema: unknown,
  config?: object,
): AnyOptionSpec {
  return {
    ...config,
    kind: "option",
    names,
    schema: type.raw(schema),
  } as unknown as AnyOptionSpec;
}

export function flag<
  const Names extends NonEmptyReadonlyArray<OptionName>,
>(
  names: Names,
): FlagSpec<Names, {}>;

export function flag<
  const Names extends NonEmptyReadonlyArray<OptionName>,
  const Config extends FlagConfig,
>(names: Names, config: Config): FlagSpec<Names, Config>;

export function flag(
  names: NonEmptyReadonlyArray<OptionName>,
  config?: object,
): AnyOptionSpec {
  return {
    ...config,
    kind: "flag",
    names,
    schema: BooleanFlag,
  } as unknown as AnyOptionSpec;
}

export function countedFlag<
  const Names extends NonEmptyReadonlyArray<OptionName>,
>(
  names: Names,
): CountedFlagSpec<Names, {}>;

export function countedFlag<
  const Names extends NonEmptyReadonlyArray<OptionName>,
  const Config extends CountedFlagConfig,
>(names: Names, config: Config): CountedFlagSpec<Names, Config>;

export function countedFlag(
  names: NonEmptyReadonlyArray<OptionName>,
  config?: object,
): AnyOptionSpec {
  return {
    ...config,
    kind: "counted-flag",
    names,
    schema: CountedFlag,
  } as unknown as AnyOptionSpec;
}

export type ParameterSchema<Parameter> = Parameter extends {
  readonly schema: infer Schema extends AnyArkType;
}
  ? Schema
  : never;
