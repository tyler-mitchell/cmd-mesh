import {
  createFile,
  definePackage,
  findDependencyInPackageJson,
  findResolvedModulePath,
  getConfigFormat,
  getFolderByPackageName,
  getGitRootFolder,
  getPackageFolder,
  getPath,
  getWorkspaceFolder,
  importMap,
  importer,
  isConfigFormat,
  isDependencyInPackageJson,
  isPackageDependency,
  isPackageModuleFound,
  isWritable,
  modifyConfig,
  modifyConfigFile,
  modifyJSON,
  modifyJSONFile,
  project,
  readFile,
  readFileSafely,
  resolveConfigSource,
  resolveModule,
  resolveModulePath,
  resolvePackageModulePath,
  workspace
} from "package-management"

/**
 * Common repository operations for direct imports, handlers, and suggestion generators.
 *
 * cmd-mesh exports one `toolkit` value and copies its members into every `Ctx`.
 * The functions retain the package-management implementations and types.
 * Low-level constructors, parser tables, and shared storage stay in package-management.
 * Those exports create custom infrastructure rather than common repository operations.
 */
export interface Toolkit {
  /**
   * Describe one importable package for `importer` or `importMap`.
   * The descriptor can mark a missing package as a development dependency.
   */
  readonly definePackage: typeof definePackage

  /** Search all dependency groups in a supplied package manifest and return the first and all matching entries. */
  readonly findDependencyInPackageJson: typeof findDependencyInPackageJson

  /** Resolve the first module identifier in a candidate list that exists from the selected directory. */
  readonly findResolvedModulePath: typeof findResolvedModulePath

  /** Infer `json`, `jsonc`, `json5`, `yaml`, or `toml` from a file extension. */
  readonly getConfigFormat: typeof getConfigFormat

  /** Find a workspace package directory by its manifest name. Returns `undefined` when no package matches. */
  readonly getFolderByPackageName: typeof getFolderByPackageName

  /** Find the enclosing Git worktree root. The function throws by default when no worktree exists. */
  readonly getGitRootFolder: typeof getGitRootFolder

  /** Find the nearest directory that contains a package manifest. */
  readonly getPackageFolder: typeof getPackageFolder

  /**
   * Resolve built-in aliases such as `<package_folder>`, `<workspace_folder>`, `<gitroot_folder>`, and `<user_tmpdir>`.
   * Options can validate existence or resolve a glob.
   */
  readonly getPath: typeof getPath

  /** Find the workspace root. The function falls back to the Git root by default. */
  readonly getWorkspaceFolder: typeof getWorkspaceFolder

  /**
   * Import a keyed record of modules and retain its key-to-module types.
   * Missing packages install by default when descriptors supply package names.
   */
  readonly importMap: typeof importMap

  /**
   * Import an ordered tuple of modules and retain its tuple types.
   * Missing packages install by default when descriptors supply package names.
   */
  readonly importer: typeof importer

  /** Test whether a string names a supported configuration format. */
  readonly isConfigFormat: typeof isConfigFormat

  /** Test whether a supplied package manifest contains a dependency in the selected dependency groups. */
  readonly isDependencyInPackageJson: typeof isDependencyInPackageJson

  /** Test whether the nearest package manifest declares every named package. */
  readonly isPackageDependency: typeof isPackageDependency

  /** Test whether Node-style package resolution can find a package from the selected directory. */
  readonly isPackageModuleFound: typeof isPackageModuleFound

  /** Test whether the process can write an existing path. */
  readonly isWritable: typeof isWritable

  /** Edit JSON, JSONC, JSON5, YAML, or TOML in memory with one path-based edit model. */
  readonly modifyConfig: typeof modifyConfig

  /**
   * Edit a JSON, JSONC, JSON5, YAML, or TOML file.
   * JSON and JSONC retain untouched text. YAML and TOML serialize the complete document.
   */
  readonly modifyConfigFile: typeof modifyConfigFile

  /** Edit JSON or JSONC in memory while retaining comments and untouched text. */
  readonly modifyJSON: typeof modifyJSON

  /** Edit a JSON or JSONC file while retaining comments and untouched text. */
  readonly modifyJSONFile: typeof modifyJSONFile

  /**
   * Read one package and bind package-manager, dependency, TypeScript-path, and ignore-pattern operations to it.
   */
  readonly project: typeof project

  /** Read a text file. The function throws when the path is absent or unreadable. */
  readonly readFile: typeof readFile

  /** Read a text file or return `undefined` when the path does not exist. */
  readonly readFileSafely: typeof readFileSafely

  /** Parse or serialize JSON, JSONC, JSON5, YAML, or TOML from data, text, or a file path. */
  readonly resolveConfigSource: typeof resolveConfigSource

  /** Await a module and return its default export when one exists. */
  readonly resolveModule: typeof resolveModule

  /** Resolve a module identifier or module-relative path from the selected directory. */
  readonly resolveModulePath: typeof resolveModulePath

  /** Resolve a package through its manifest entry first, then through its public module entry. */
  readonly resolvePackageModulePath: typeof resolvePackageModulePath

  /** Read the workspace root, package list, package graph, package names, or a package-bound project. */
  readonly workspace: typeof workspace

  /** Write a text file and create missing parent directories. Existing files are replaced. */
  readonly writeFile: typeof createFile
}

export const toolkit: Toolkit = {
  definePackage,
  findDependencyInPackageJson,
  findResolvedModulePath,
  getConfigFormat,
  getFolderByPackageName,
  getGitRootFolder,
  getPackageFolder,
  getPath,
  getWorkspaceFolder,
  importMap,
  importer,
  isConfigFormat,
  isDependencyInPackageJson,
  isPackageDependency,
  isPackageModuleFound,
  isWritable,
  modifyConfig,
  modifyConfigFile,
  modifyJSON,
  modifyJSONFile,
  project,
  readFile,
  readFileSafely,
  resolveConfigSource,
  resolveModule,
  resolveModulePath,
  resolvePackageModulePath,
  workspace,
  writeFile: createFile
}
