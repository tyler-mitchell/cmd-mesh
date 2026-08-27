export type MaybePromise<Value> = Value | PromiseLike<Value>;

export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]];

export type Simplify<Value> = { [Key in keyof Value]: Value[Key] } & {};

export type DefaultValue<Value> = Value | (() => Value);

export interface Documentation {
  readonly summary?: string;
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly links?: readonly {
    readonly label?: string;
    readonly url: string;
  }[];
}

export interface Deprecation {
  readonly message?: string;
  readonly since?: string;
  readonly replacement?: string;
}

export interface Presentation extends Documentation {
  readonly displayName?: string;
  readonly icon?: string;
  readonly hidden?: boolean;
  readonly dangerous?: boolean;
  readonly deprecated?: boolean | Deprecation;
  readonly tags?: readonly string[];
}
