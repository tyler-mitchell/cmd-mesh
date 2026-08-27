import type { type as ArkType } from "arktype";

/** A definition accepted by ArkType's one-argument `type(definition)` parser. */
export type ArkTypeDefinition<Definition> = ArkType.validate<Definition>;

/** The concrete Type inferred from an ArkType definition. */
export type ArkTypeFromDefinition<Definition> =
  ArkType.instantiate<Definition>;

/** Any concrete ArkType Type, including branded and morphed Types. */
export type AnyArkType = ArkType.Any;

/** The value accepted before ArkType defaults and morphs run. */
export type ArkInput<Schema extends AnyArkType> = Schema["inferIn"];

/** The validated value produced after ArkType defaults and morphs run. */
export type ArkOutput<Schema extends AnyArkType> = Schema["infer"];

/** The output shape ArkType can inspect at runtime. */
export type ArkIntrospectableOutput<Schema extends AnyArkType> =
  Schema["inferIntrospectableOut"];

/** A Type whose complete input domain is representable by one CLI token. */
export type TokenArkType = AnyArkType & { readonly inferIn: string };

type IsAny<Value> = 0 extends 1 & Value ? true : false;

type IsUnknown<Value> = IsAny<Value> extends true
  ? true
  : unknown extends Value
    ? keyof Value extends never
      ? true
      : false
    : false;

declare const arkTypeConstraint: unique symbol;

export type ArkTypeConstraint<Message extends string> = {
  readonly [arkTypeConstraint]: Message;
};

/** The concrete token Type produced by a valid parameter definition. */
export type TokenArkTypeFromDefinition<Definition> =
  ArkType.instantiate<Definition> extends infer Schema extends TokenArkType
    ? Schema
    : never;

/** CLI parameters consume exactly one string token before validation. */
export type RequireTokenInput<Definition> =
  ArkType.infer.In<Definition> extends string
    ? unknown
    : ArkTypeConstraint<"CLI parameter schemas must accept a string token">;

/** Apply adapter constraints to the concrete Type inferred from a definition. */
export type RequireIntrospectableDefinition<Definition> =
  ArkType.instantiate<Definition> extends infer Schema extends AnyArkType
    ? RequireIntrospectable<Schema>
    : never;

/**
 * Dynamic adapters need an inspectable output Type. A custom morph must use
 * `.to(...)` (or an equivalent validated output) rather than returning an
 * opaque TypeScript-only output.
 */
export type RequireIntrospectable<Schema extends AnyArkType> =
  IsUnknown<ArkIntrospectableOutput<Schema>> extends true
    ? ArkTypeConstraint<"ArkType morph outputs must be validated with .to(...) so adapters can inspect them">
    : unknown;
