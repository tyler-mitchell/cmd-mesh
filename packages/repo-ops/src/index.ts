// the closed-distribution operational contract, declared once: the
// Bumpy release procedure, CI runs, dependabot operations, and the
// daily binaries as typed external surfaces — mountable cmd-mesh
// modules, one file per program. a repository mounts them into its
// own program; the one genuine configuration point is the published
// package name.
import { ci } from "./ci.js"
import { deps } from "./deps.js"
import { git } from "./git.js"
import { createRelease } from "./release.js"

export { ci } from "./ci.js"
export { deps } from "./deps.js"
export { git } from "./git.js"
export { createRelease } from "./release.js"

export interface RepositoryOperationsConfig {
  readonly package: string
}

export const repositoryOperations = (config: RepositoryOperationsConfig) => ({
  release: createRelease(config.package),
  ci,
  deps,
  git
})
