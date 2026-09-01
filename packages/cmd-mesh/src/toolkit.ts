import {
  createFile,
  getConfigFormat,
  getPath,
  isWritable,
  modifyConfig,
  modifyConfigFile,
  modifyJSON,
  modifyJSONFile,
  project,
  readFile,
  readFileSafely,
  resolveConfigSource,
  workspace
} from "package-management"

/** Stateless file, path, configuration, project, and workspace operations.
 * The same object is exported for direct imports and spread into every Ctx. */
export interface Toolkit {
  readonly getConfigFormat: typeof getConfigFormat
  readonly getPath: typeof getPath
  readonly isWritable: typeof isWritable
  readonly modifyConfig: typeof modifyConfig
  readonly modifyConfigFile: typeof modifyConfigFile
  readonly modifyJSON: typeof modifyJSON
  readonly modifyJSONFile: typeof modifyJSONFile
  readonly project: typeof project
  readonly readFile: typeof readFile
  readonly readFileSafely: typeof readFileSafely
  readonly resolveConfigSource: typeof resolveConfigSource
  readonly workspace: typeof workspace
  readonly writeFile: typeof createFile
}

export const toolkit: Toolkit = {
  getConfigFormat,
  getPath,
  isWritable,
  modifyConfig,
  modifyConfigFile,
  modifyJSON,
  modifyJSONFile,
  project,
  readFile,
  readFileSafely,
  resolveConfigSource,
  workspace,
  writeFile: createFile
}
