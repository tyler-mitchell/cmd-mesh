import { createFile, program } from "cmd-mesh"
import type { Ctx } from "cmd-mesh"
import { git } from "./git.js"
import { captured, printText, streamed, text } from "./run.js"

const scratchDir = async (ctx: Ctx, label: string): Promise<{ dir: string; drop: () => Promise<void> }> => {
  const dir = `${ctx.workspace.workspaceRootDir()}/node_modules/.repo-ops/${label}-${Date.now()}`
  createFile(`${dir}/package.json`, `${JSON.stringify({ name: `${label}-scratch`, private: true, type: "module" })}\n`)
  return {
    dir,
    drop: async () => {
      await ctx.exec("rm", ["-rf", dir], { successCodes: [0] })
    }
  }
}

const runProbe = async (ctx: Ctx, dir: string, probe: string): Promise<void> => {
  const source = probe.startsWith("/") ? probe : `${ctx.workspace.workspaceRootDir()}/${probe}`
  await ctx.exec("cp", [source, `${dir}/probe.mjs`], { successCodes: [0] })
  await ctx.exec(globalThis.process.execPath, ["probe.mjs"], { cwd: dir, successCodes: [0], stdio: "inherit" })
}

const promote = program({
  name: "promote",
  description: "the main → release promotion PR",
  commands: {
    pr: {
      description: "show the open promotion PR",
      safety: "read",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "list", "--head", "main", "--base", "release", "--state", "open", "--limit", "1"])
    },
    create: {
      description: "open the promotion PR",
      safety: "action",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "create", "--head", "main", "--base", "release", "--fill"])
    },
    merge: {
      description: "queue the promotion merge",
      safety: "action",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "gh", ["pr", "merge", "main", "--merge", "--auto"])
    }
  }
})

// the one repository-specific fact the procedure needs is the
// published package name (registry-version), so release is a factory
export const createRelease = (packageName: string) =>
  program({
    name: "release",
    description: "the Bumpy release procedure",
    commands: {
      add: {
        description: "author a bump file (interactive)",
        safety: "action",
        mcp: { hidden: true },
        input: {
          args: ["string[]", "@", { description: "bumpy add arguments", cli: "[...args]", default: () => [] }]
        },
        run: (input, ctx) => streamed(ctx, "bumpy", ["add", ...input.args])
      },
      check: {
        description: "every changed package has a bump",
        safety: "read",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) => captured(ctx, "bumpy", ["check", "--strict"])
      },
      status: {
        description: "pending bumps and planned versions",
        safety: "read",
        output: text,
        cli: { render: printText },
        // bumpy exits 1 when nothing is pending, with the JSON still on
        // stdout — a report-style exit, not a failure
        run: (_input, ctx) => captured(ctx, "bumpy", ["status", "--json"], [0, 1])
      },
      push: {
        description: "push the daily branch",
        safety: "action",
        output: text,
        cli: { render: printText },
        run: async (_input, ctx) => ({
          text: (await git.push(
            { remote: "origin", branch: "main" },
            { cwd: ctx.workspace.workspaceRootDir() }
          )).trimEnd()
        })
      },
      pr: {
        description: "show the open version PR",
        safety: "read",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) =>
          captured(ctx, "gh", [
            "pr", "list", "--head", "bumpy/version-packages", "--base", "release", "--state", "open", "--limit", "1"
          ])
      },
      merge: {
        description: "queue the version PR squash merge",
        safety: "action",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) =>
          captured(ctx, "gh", ["pr", "merge", "bumpy/version-packages", "--auto", "--squash"])
      },
      update: {
        description: "update the version PR branch",
        safety: "action",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) => captured(ctx, "gh", ["pr", "update-branch", "bumpy/version-packages"])
      },
      "registry-version": {
        description: "published version on npm",
        safety: "read",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) => captured(ctx, "npm", ["view", packageName, "version"])
      },
      preflight: {
        description: "pack the package and prove the tarball installs and runs",
        safety: "read",
        input: {
          "probe?": [
            "string",
            "@",
            { description: "probe module run from the scratch consumer", suggest: "filepaths", cli: "--probe" }
          ]
        },
        output: { verified: "string" },
        run: async (input, ctx) => {
          const root = ctx.workspace.workspaceRootDir()
          const pkg = ctx.workspace.packageList().find((entry) => entry.name === packageName)
          if (pkg === undefined) throw new Error(`${packageName} is not a workspace package`)
          const manifest = pkg.packageJson as {
            readonly repository?: string | { readonly url?: string }
            readonly scripts?: { readonly prepack?: string; readonly prepublishOnly?: string }
          }
          if (manifest.scripts?.prepack === undefined) throw new Error("scripts.prepack is required")
          const scratch = await scratchDir(ctx, "preflight")
          try {
            if (manifest.scripts.prepublishOnly !== undefined) {
              await ctx.exec("pnpm", ["--filter", packageName, "run", "prepublishOnly"], { cwd: root, successCodes: [0] })
            }
            const tarball = `${scratch.dir}/package.tgz`
            await ctx.exec("pnpm", ["--filter", packageName, "pack", "--out", tarball], { cwd: root, successCodes: [0] })
            await ctx.exec("npm", ["install", tarball, "--no-audit", "--no-fund"], { cwd: scratch.dir, successCodes: [0] })
            if (input.probe !== undefined) await runProbe(ctx, scratch.dir, input.probe)
            return { verified: `${packageName} packs, installs${input.probe === undefined ? "" : ", and runs"}` }
          } finally {
            await scratch.drop()
          }
        }
      },
      verify: {
        description: "prove the published version installs, runs, and carries provenance",
        safety: "read",
        input: {
          "probe?": [
            "string",
            "@",
            { description: "probe module run from the scratch consumer", suggest: "filepaths", cli: "--probe" }
          ],
          attempts: [
            "string.integer.parse",
            "@",
            { description: "registry propagation retries", default: "10" }
          ]
        },
        output: { verified: "string" },
        run: async (input, ctx) => {
          const version = (await captured(ctx, "npm", ["view", packageName, "version"])).text
          const spec = `${packageName}@${version}`
          const scratch = await scratchDir(ctx, "verify")
          try {
            for (let attempt = 1; ; attempt += 1) {
              const install = await ctx.exec("npm", ["install", spec, "--no-audit", "--no-fund"], { cwd: scratch.dir })
              if (install.exitCode === 0) break
              if (attempt >= input.attempts) throw new Error(`${spec} failed to install: ${install.stderr}`)
              await new Promise((resolve) => globalThis.setTimeout(resolve, 20_000))
            }
            await ctx.exec("npm", ["audit", "signatures"], { cwd: scratch.dir, successCodes: [0] })
            if (input.probe !== undefined) await runProbe(ctx, scratch.dir, input.probe)
            const provenance = await captured(ctx, "npm", ["view", spec, "dist.attestations.provenance.predicateType"])
            if (provenance.text !== "https://slsa.dev/provenance/v1") throw new Error(`${spec} has no npm provenance`)
            const release = await captured(ctx, "gh", ["release", "view", `${packageName}@${version}`, "--json", "isDraft", "--jq", ".isDraft"])
            if (release.text !== "false") throw new Error(`${spec} has no published GitHub Release`)
            return { verified: `${spec} installs, runs, carries provenance, and has a GitHub Release` }
          } finally {
            await scratch.drop()
          }
        }
      },
      sync: {
        description: "synchronize main forward from release",
        safety: "action",
        input: {
          merge: [
            "boolean",
            "@",
            { description: "merge-pull when histories diverged", cli: "--merge", default: false }
          ]
        },
        output: text,
        cli: { render: printText },
        run: async (input, ctx) => ({
          text: (await git.pull(
            {
              ...(input.merge ? { noRebase: true, noEdit: true } : { ffOnly: true }),
              remote: "origin",
              branch: "release"
            },
            { cwd: ctx.workspace.workspaceRootDir() }
          )).trimEnd()
        })
      },
      promote
    }
  })
