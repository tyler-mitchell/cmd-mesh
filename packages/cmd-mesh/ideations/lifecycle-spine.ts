/**
 * lifecycle spine — resources across the three surfaces
 *
 * THESIS. The citty-style per-command setup/cleanup hook was rejected
 * as a cli bolt-on: a hook that fires around `cli.run` says nothing
 * about the typed-function call or the long-lived mcp server, and the
 * 08 contract's ctx is interpreter-owned capability, not user DI —
 * while USER wiring lives in module scope. Module scope covers
 * acquisition fine (`const db = await open()`), but cannot express
 * three things: guaranteed release when a handler fails, per-invocation
 * freshness under a long-lived mcp server, and release at cli process
 * end. Those three are lifecycle, and lifecycle is interpreter work.
 *
 * SHAPE. Config-as-data on the program declaration; a thin interpreter
 * (Effect Scope / acquireRelease internally — the owner cmd-mesh
 * already stands on) fulfills it. No hooks bus, no plugin system:
 * plugins remain DEFERRED because every motivating case so far is a
 * resource, and a bus without a second concrete consumer is
 * speculative machinery.
 *
 *   const mesh = program({
 *     name: "mesh",
 *     resources: {
 *       db: {
 *         acquire: async () => openDatabase(),
 *         release: async (db) => db.close(),
 *         // "invocation" (default): fresh per handler call, released
 *         // in finally — even when the handler throws.
 *         // "server": acquired once per process surface lifetime —
 *         // at mcp.serve() start or first cli/call use — released at
 *         // server close / process end.
 *         scope: "invocation"
 *       }
 *     },
 *     commands: {
 *       stat: {
 *         output: { entries: "number" },
 *         run: async (_input, ctx) => ({ entries: await ctx.resources.db.count() })
 *       }
 *     }
 *   })
 *
 * SURFACE SEMANTICS (one owner, three projections):
 * - typed function: acquire before the handler, release in finally,
 *   result/error propagates after release completes.
 * - cli.run/main: same per invocation; "server"-scoped resources
 *   release before the exit code is returned (never process.exit
 *   before release).
 * - mcp.serve: "server" resources acquire at serve, release at
 *   transport close; "invocation" resources wrap each tool call.
 * - interactive/complete never acquire: prompting and completion are
 *   vocabulary work, not invocation.
 *
 * FAILURE SEMANTICS:
 * - acquire failure = the invocation fails before the handler runs
 *   (HandlerFailure vocabulary, cause preserved).
 * - release always runs (finally); a release failure after a handler
 *   success fails the invocation; after a handler failure it is
 *   aggregated as a suppressed cause, the handler error stays primary.
 * - releases run in reverse acquisition order.
 *
 * TYPING (the physical constraint): resources thread into ctx as
 * `ctx.resources.<key>` with the awaited acquire type. Ctx gains a
 * generic parameter defaulted to empty, threaded through
 * CommandFn/CommandsOverlay the same way RIn already threads — the
 * precedent exists; the open risk is inference cost at large command
 * counts, measured against the compile-cost tripwire before landing.
 * Mounted subprograms keep their OWN resources (a module owns its
 * wiring); a parent's resources do not leak into mounted children —
 * sharing happens in module scope, the 08 way.
 *
 * OPEN POINTS (defaults chosen; user may veto):
 * - per-command `resources: ["db"]` narrowing (acquire only what a
 *   command names) — EXCLUDED for now: acquire-all-invocation-scoped
 *   is the simplest coherent start, narrowing is an optimization with
 *   no consumer yet.
 * - a `Resource<T>` helper export — INCLUDED: `{ acquire, release,
 *   scope? }` object literal is the whole grammar, the helper is only
 *   the type.
 *
 * EXIT PREDICATE for the arc: resources land in packages/cmd-mesh with
 * consumer-driven witnesses (release-on-throw, server-vs-invocation
 * scoping under mcp, reverse order), compile-cost tripwire still green,
 * repokit unaffected, committed.
 */
import type { Ctx } from "../src/types.js"

export interface ResourceSpec<T> {
  readonly acquire: (ctx: Ctx) => T | Promise<T>
  readonly release: (resource: Awaited<T>) => void | Promise<void>
  readonly scope?: "invocation" | "server"
}

export type ResourcesDecl = Readonly<globalThis.Record<string, ResourceSpec<unknown>>>

export type AcquiredResources<R extends ResourcesDecl> = {
  readonly [K in keyof R]: Awaited<globalThis.ReturnType<R[K]["acquire"]>>
}
