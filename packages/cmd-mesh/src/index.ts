export { external, program } from "./module.js"
export { toolkit } from "./toolkit.js"
export type { Toolkit } from "./toolkit.js"

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
  getConfigFormat,
  getPath,
  importMap,
  importer,
  isWritable,
  modifyConfig,
  modifyConfigFile,
  modifyJSON,
  modifyJSONFile,
  project,
  readFile,
  readFileSafely,
  resolveConfigSource,
  createFile as writeFile,
  workspace
} from "package-management"
export type {
  ConfigEditData,
  ConfigEditOptions,
  ConfigEdits,
  ConfigFormat,
  ConfigSourceData,
  ConfigSourceInput,
  JSONEditData,
  JSONEditOptions,
  JSONEdits,
  ModifyConfigFileOptions,
  ModifyConfigOptions,
  PackageInfo,
  PackageJson,
  PackageName,
  ReadFileOptions
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
