import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const manifest = JSON.parse(
  await readFile(new URL("../packages/cmd-mesh/package.json", import.meta.url), "utf8"),
) as { name: string; version: string };
const spec = `${manifest.name}@${manifest.version}`;
const directory = await mkdtemp(join(tmpdir(), "cmd-mesh-release-"));

try {
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "cmd-mesh-verifier", private: true, type: "module" })}\n`,
  );
  const attempts = 10;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await run("npm", ["install", spec, "--no-audit", "--no-fund"], { cwd: directory });
      break;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    }
  }
  await run("npm", ["audit", "signatures"], { cwd: directory });
  await copyFile(new URL("./verify-published.mjs", import.meta.url), join(directory, "probe.mjs"));
  await run(process.execPath, ["probe.mjs"], { cwd: directory });
  const { stdout: provenance } = await run("npm", [
    "view", spec, "dist.attestations.provenance.predicateType",
  ]);
  if (provenance.trim() !== "https://slsa.dev/provenance/v1") {
    throw new Error(`${spec} has no npm provenance.`);
  }
  const { stdout: release } = await run("gh", [
    "release", "view", spec, "--repo", "tyler-mitchell/cmd-mesh", "--json", "isDraft", "--jq", ".isDraft",
  ]);
  if (release.trim() !== "false") throw new Error(`${spec} has no published GitHub Release.`);
  console.log(`${spec} installs, runs, carries provenance, and has a GitHub Release.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
