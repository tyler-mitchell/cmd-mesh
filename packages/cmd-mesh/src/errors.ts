import { Array, Data, Predicate } from "effect"
import { didYouMean } from "./suggest.js"

// tagged errors for the whole package. Data.TaggedError keeps Effect Schema
// out. message getters make `${error}` presentable at the cli edge.

export interface DeclarationIssue {
  readonly at: string
  readonly problem: string
}

/** thrown synchronously from program()/external() — every declaration
 * problem reported at once, each anchored to its command/parameter path */
export class InvalidDeclaration extends Data.TaggedError("InvalidDeclaration")<{
  readonly issues: ReadonlyArray<DeclarationIssue>
}> {
  override get message(): string {
    return Array.join(
      Array.prepend(
        Array.map(this.issues, (issue) => `  ${issue.at}: ${issue.problem}`),
        "invalid declaration:"
      ),
      "\n"
    )
  }
}

export class CommandNotFound extends Data.TaggedError("CommandNotFound")<{
  readonly path: ReadonlyArray<string>
  readonly token: string
  readonly near: ReadonlyArray<string>
}> {
  override get message(): string {
    return `unknown command "${this.token}"${didYouMean(this.near)}`
  }
}

export class InvalidInput extends Data.TaggedError("InvalidInput")<{
  readonly path: ReadonlyArray<string>
  readonly summary: string
}> {
  override get message(): string {
    return this.summary
  }
}

export class InvalidOutput extends Data.TaggedError("InvalidOutput")<{
  readonly path: ReadonlyArray<string>
  readonly summary: string
}> {
  override get message(): string {
    return `output contract violated: ${this.summary}`
  }
}

export class HandlerFailure extends Data.TaggedError("HandlerFailure")<{
  readonly path: ReadonlyArray<string>
  readonly cause: unknown
}> {
  override get message(): string {
    // an Error cause renders by its own message — never the doubled
    // "x failed: Error: boom" framing
    const cause = Predicate.hasProperty(this.cause, "message")
      ? `${(this.cause as { readonly message: unknown }).message}`
      : `${this.cause}`
    return `${Array.join(this.path, " ")} failed: ${cause}`
  }
}

export class UnknownFlag extends Data.TaggedError("UnknownFlag")<{
  readonly path: ReadonlyArray<string>
  readonly flag: string
  readonly near: ReadonlyArray<string>
}> {
  override get message(): string {
    return `unknown flag ${this.flag}${didYouMean(this.near)}`
  }
}

export class MissingFlagValue extends Data.TaggedError("MissingFlagValue")<{
  readonly path: ReadonlyArray<string>
  readonly flag: string
}> {
  override get message(): string {
    return `flag ${this.flag} expects a value`
  }
}

export class UnexpectedArgument extends Data.TaggedError("UnexpectedArgument")<{
  readonly path: ReadonlyArray<string>
  readonly token: string
}> {
  override get message(): string {
    return `unexpected argument "${this.token}"`
  }
}

export class ExecFailure extends Data.TaggedError("ExecFailure")<{
  readonly bin: string
  readonly args: ReadonlyArray<string>
  readonly cause: unknown
}> {
  override get message(): string {
    return `failed to execute ${this.bin}: ${this.cause}`
  }
}

export class ExternalExit extends Data.TaggedError("ExternalExit")<{
  readonly bin: string
  readonly args: ReadonlyArray<string>
  readonly exitCode: number
  readonly stderr: string
}> {
  override get message(): string {
    return `${this.bin} exited with ${this.exitCode}: ${this.stderr}`
  }
}

export class NoRunnableCommand extends Data.TaggedError("NoRunnableCommand")<{
  readonly path: ReadonlyArray<string>
}> {
  override get message(): string {
    return `"${Array.join(this.path, " ")}" is not a runnable command`
  }
}
