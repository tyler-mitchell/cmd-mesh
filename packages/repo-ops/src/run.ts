import type { Ctx } from "cmd-mesh"

export const streamed = async (ctx: Ctx, bin: string, args: ReadonlyArray<string>): Promise<{ done: true }> => {
  await ctx.exec(bin, args, {
    cwd: ctx.workspace.workspaceRootDir(),
    preferLocal: true,
    stdio: "inherit",
    successCodes: [0]
  })
  return { done: true }
}

export const captured = async (
  ctx: Ctx,
  bin: string,
  args: ReadonlyArray<string>,
  successCodes: ReadonlyArray<number> = [0]
): Promise<{ text: string }> => {
  const result = await ctx.exec(bin, args, {
    cwd: ctx.workspace.workspaceRootDir(),
    preferLocal: true,
    successCodes
  })
  return { text: result.stdout.trimEnd() }
}

export const text = { text: "string" } as const
export const printText = (output: { text: string }) => output.text
