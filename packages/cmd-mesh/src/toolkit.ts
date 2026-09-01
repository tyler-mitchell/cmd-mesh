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
export const toolkit = {
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
} as const

export type Toolkit = typeof toolkit
