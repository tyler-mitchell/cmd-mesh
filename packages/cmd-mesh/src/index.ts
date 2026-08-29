export { external, program } from "./module.js"

// the repository toolkit, re-exported whole from package-management —
// the same day-to-day affordances handlers reach through ctx, importable
// directly where no invocation context is involved: comment-preserving
// JSON/JSONC editing, mkdir-p file writes, alias-grammar path
// resolution, repository/workspace introspection, package-manager
// detection and installs, and install-on-missing imports.
export {
  createFile,
  definePackage,
  definePackageManagerClient,
  getPath,
  importMap,
  importer,
  modifyJSON,
  modifyJSONFile,
  project,
  workspace
} from "package-management"
export type {
  PackageInfo,
  PackageJson,
  PackageName
} from "package-management"
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
  AcquiredResources,
  CliCommandConfig,
  CliParameterConfig,
  CliProjection,
  CommandSafety,
  CommandSpec,
  Ctx,
  ExecOptions,
  ExecResult,
  ExternalCommandDecl,
  ExternalDecl,
  ExternalModule,
  McpCommandConfig,
  McpExample,
  McpProjection,
  McpTool,
  Mounted,
  NarrowContext,
  ParameterDef,
  ParameterSpec,
  ProgramModule,
  ResourceSpec,
  SuggestContext,
  SuggestGenerator,
  SuggestSource,
  Surface
} from "./types.js"
