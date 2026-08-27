import type { MaybePromise, NonEmptyReadonlyArray, Presentation } from "./shared.js";

export type CompletionKind =
  | "argument"
  | "command"
  | "directory"
  | "file"
  | "history"
  | "option"
  | "shortcut"
  | "value";

export type CompletionFilter = "default" | "fuzzy" | "prefix";

export type CompletionTemplate =
  | "commands"
  | "directories"
  | "files"
  | "help"
  | "history";

export interface CompletionCandidate<Value extends string = string>
  extends Presentation {
  readonly value: Value;
  readonly aliases?: readonly Value[];
  readonly insertValue?: string;
  readonly replaceValue?: string;
  readonly kind?: CompletionKind;
  readonly priority?: number;
}

export type CompletionCandidateLike<Value extends string = string> =
  | Value
  | CompletionCandidate<Value>;

export interface ProcessRequest {
  readonly command: string;
  readonly arguments?: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly input?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly aborted: boolean;
  readonly killed: boolean;
}

export interface RunningProcess
  extends PromiseLike<ProcessResult>, AsyncIterable<string> {
  readonly pid?: number;
  readonly aborted: boolean;
  readonly killed: boolean;
  readonly kill: (signal?: string) => void;
}

export interface ProcessExecutor {
  readonly execute: (request: ProcessRequest) => Promise<ProcessResult>;
  readonly spawn: (request: ProcessRequest) => RunningProcess;
}

export interface CompletionContext<
  Input,
  Target extends string = string,
> {
  readonly target: Target;
  readonly input: Partial<Input>;
  readonly commandPath: readonly string[];
  readonly words: readonly string[];
  readonly currentWord: string;
  readonly cursor: number;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly processes: ProcessExecutor;
}

export type CompletionProvider<
  Value extends string,
  Input,
  Target extends string = string,
> = (
  context: CompletionContext<Input, Target>,
) => MaybePromise<readonly CompletionCandidateLike<Value>[]>;

export type CompletionTrigger =
  | { readonly on: "change" }
  | { readonly on: "match"; readonly value: string | readonly string[] }
  | { readonly on: "threshold"; readonly length: number }
  | ((currentWord: string, previousWord: string) => boolean);

export type CompletionCache =
  | {
      readonly strategy: "max-age";
      readonly ttlMs: number;
      readonly byDirectory?: boolean;
      readonly key?: string;
    }
  | {
      readonly strategy: "stale-while-revalidate";
      readonly ttlMs?: number;
      readonly byDirectory?: boolean;
      readonly key?: string;
    }
  | { readonly strategy: "none" };

export interface CompletionSpec<
  Value extends string,
  Input,
  Target extends string = string,
> {
  readonly suggestions?: readonly CompletionCandidateLike<Value>[];
  readonly templates?: readonly CompletionTemplate[];
  readonly providers?: NonEmptyReadonlyArray<
    CompletionProvider<Value, Input, Target>
  >;
  readonly filter?: CompletionFilter;
  readonly suggestCurrentWord?: boolean;
  readonly debounceMs?: number;
  readonly trigger?: CompletionTrigger;
  readonly cache?: CompletionCache;
}
