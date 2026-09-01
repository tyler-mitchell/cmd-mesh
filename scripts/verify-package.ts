import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const workspace = fileURLToPath(new URL("..", import.meta.url));
const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
  devDependencies?: { npm?: string };
};
const manifest = JSON.parse(
  await readFile(new URL("../packages/cmd-mesh/package.json", import.meta.url), "utf8"),
) as {
  name: string;
  repository?: string | { url?: string };
  scripts?: { prepack?: string; prepublishOnly?: string };
};
const repository =
  typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;

if (!root.devDependencies?.npm) throw new Error("A locked npm 11.15+ tool dependency is required.");
if (manifest.name !== "cmd-mesh") throw new Error("Package name does not match setup.");
if (!repository?.includes("tyler-mitchell/cmd-mesh")) throw new Error("repository.url does not match setup.");
if (!manifest.scripts?.prepack) throw new Error("scripts.prepack is required.");

const directory = await mkdtemp(join(tmpdir(), "package-preflight-"));
const tarball = join(directory, "package.tgz");
try {
  if (manifest.scripts?.prepublishOnly) {
    await run("pnpm", ["--filter", manifest.name, "run", "prepublishOnly"], { cwd: workspace });
  }
  await run("pnpm", ["--filter", manifest.name, "pack", "--out", tarball], { cwd: workspace });
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "package-preflight", private: true, type: "module" })}\n`,
  );
  await run("npm", ["install", tarball, "--no-audit", "--no-fund"], { cwd: directory });
  await copyFile(new URL("./verify-published.mjs", import.meta.url), join(directory, "probe.mjs"));
  await run(process.execPath, ["probe.mjs"], { cwd: directory });
} finally {
  await rm(directory, { recursive: true, force: true });
}
