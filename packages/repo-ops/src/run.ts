import { delimiter, join } from "node:path"
import type { Ctx } from "cmd-mesh"

// workspace-local binaries (bumpy) must resolve however the bin was
// invoked — `pnpm run` puts node_modules/.bin on PATH, a direct
// `node dist/bin.js` or an mcp server does not
const anchored = (ctx: Ctx): { cwd: string; env: Readonly<Record<string, string>> } => {
  const cwd = ctx.workspace.workspaceRootDir()
  return {
    cwd,
    env: {
      ...process.env as Record<string, string>,
      PATH: [join(cwd, "node_modules", ".bin"), process.env.PATH ?? ""].join(delimiter)
    }
  }
}

// the two operational shapes, anchored at the workspace root
// (ctx.workspace owns that resolution). `streamed` hands the child the
// terminal (watchers, interactive tools) and succeeds only on the
// declared codes; `captured` returns stdout as `{ text }` for cli
// rendering and mcp structured content alike.
export const streamed = async (ctx: Ctx, bin: string, args: ReadonlyArray<string>): Promise<{ done: true }> => {
  await ctx.exec(bin, args, { ...anchored(ctx), stdio: "inherit", successCodes: [0] })
  return { done: true }
}

export const captured = async (
  ctx: Ctx,
  bin: string,
  args: ReadonlyArray<string>,
  successCodes: ReadonlyArray<number> = [0]
): Promise<{ text: string }> => {
  const result = await ctx.exec(bin, args, { ...anchored(ctx), successCodes })
  return { text: result.stdout.trimEnd() }
}

export const text = { text: "string" } as const
export const printText = (output: { text: string }) => output.text
