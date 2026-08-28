export { external, program } from "./module.js"
export {
  CommandNotFound,
  ExecFailure,
  ExternalExit,
  HandlerFailure,
  InvalidDeclaration,
  InvalidInput,
  InvalidOutput,
  MissingFlagValue,
  NoRunnableCommand,
  UnexpectedArgument,
  UnknownFlag
} from "./errors.js"
export type {
  CliCommandConfig,
  CliParameterConfig,
  CliProjection,
  CommandSpec,
  Ctx,
  ExecOptions,
  ExecResult,
  ExternalCommandDecl,
  ExternalDecl,
  ExternalModule,
  McpCommandConfig,
  McpProjection,
  McpTool,
  Mounted,
  NarrowContext,
  ParameterDef,
  ParameterDescriptor,
  ParameterSpec,
  ProgramModule,
  SuggestContext,
  SuggestGenerator,
  SuggestSource,
  Surface
} from "./types.js"
