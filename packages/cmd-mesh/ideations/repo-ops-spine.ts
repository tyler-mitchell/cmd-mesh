/**
 * repo-ops spine — the shared repository operations program
 *
 * THESIS. The closed-distribution contract (Bumpy release procedure,
 * gh CI operations, dependabot operations, branch synchronization) is
 * today declared twice: repokit owns it for command-mesh, and
 * package-management carries a byte-copied script contract. One mesh
 * program, extended by both repositories, ends the copy. Blueprint
 * option 2, designed from repokit's landed operational contract
 * (d301225): the operations themselves are repository-generic — only
 * the published package name varies.
 *
 * OWNERSHIP. New workspace package `packages/repo-ops` in command-mesh
 * (npm name decided at the publish gate — `repo-ops` availability
 * unverified; scope creation is a user-level npm act and is NOT
 * required to land: repokit consumes it workspace-internally first,
 * and package-management adopts only after it publishes).
 *
 * SHAPE. A program factory, not a static module: `registry-version`
 * needs the published package name, so the one configuration point is
 * carried by the caller. Everything else — branch names main/release,
 * the bumpy/gh/git vocabularies, report-style exits — is the playbook
 * itself and stays interpreter-owned inside the factory.
 *
 * The factory returns MODULES (release, ci, deps, sync), not a root
 * program: consumers mount them into their own program so the bin,
 * name, and any repository-specific commands stay with the consumer.
 * Mounting by reference is the 08 contract's own mechanism; no
 * adapter exists anywhere in this design.
 *
 * BEHAVIORAL INVARIANTS (carried verbatim from the landed contract):
 * - `streamed` ops hand the child the terminal (stdio inherit) and
 *   succeed only on declared codes; `captured` ops return `{ text }`
 *   rendered plain on the cli and structured over mcp.
 * - Report-style exits are declared, never caught: bumpy status
 *   exits 1 with JSON when nothing is pending (successCodes [0, 1],
 *   regression 0ae7028); git grep semantics stay in the consumer.
 * - Every operation anchors at the repository toplevel.
 * - The op set is exactly the script contract: release
 *   add/check/status/push/promote{pr,create,merge}/pr/merge/update/
 *   registry-version/sync{,merge,push}/preflight/verify; ci
 *   list/watch/logs/rerun/cancel/dispatch; deps list/merge/close/sync.
 *
 * CONSUMPTION (both sides of the extraction):
 *
 *   // command-mesh: apps/repokit/src/repokit.ts
 *   const ops = repositoryOperations({ package: "cmd-mesh" })
 *   export const repokit = program({
 *     name: "repokit",
 *     commands: { search, todos, context, packages, check, ...ops }
 *   })
 *
 *   // package-management: repo.ts (adoption commit, after publish)
 *   const ops = repositoryOperations({ package: "package-management" })
 *   export const repo = program({ name: "repo", commands: { ...ops } })
 *
 * Root package.json scripts in both repos keep delegating to the
 * consumer bin — the scripts stay thin names, the program stays the
 * one owner. package-management's AGENTS.md text is untouched by this
 * spine; its adoption commit swaps script bodies only.
 *
 * OPEN POINTS (defaults chosen; user may veto):
 * - npm name: decide at publish; working name repo-ops.
 * - preflight/verify scripts are repository files (scripts/verify-*.ts)
 *   not generic ops — they STAY consumer-side. Default: excluded from
 *   the factory.
 * - `check <filter>` (workspace script runner) is generic; default:
 *   included as its own module.
 *
 * EXIT PREDICATE for the extraction arc: repo-ops lands, repokit
 * mounts it with its own release/ci/deps declarations deleted, both
 * suites green, committed.
 */
import type { Ctx } from "../src/types.js"

export interface RepositoryOperationsConfig {
  readonly package: string
}

export interface OperationalModules {
  readonly release: unknown
  readonly ci: unknown
  readonly deps: unknown
  readonly sync: unknown
}

export declare const repositoryOperations: (
  config: RepositoryOperationsConfig
) => OperationalModules

export declare const anchoredExec: (
  ctx: Ctx,
  bin: string,
  args: ReadonlyArray<string>,
  successCodes?: ReadonlyArray<number>
) => Promise<{ text: string }>
