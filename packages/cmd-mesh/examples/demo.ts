// drives the real execution paths of @cmd-mesh/core. run with:
//   pnpm exec tsx examples/demo.ts
import { git, mesh } from "./mesh.js"

const show = (label: string, value: unknown) => {
  console.log(`\n== ${label} ==`)
  console.log(typeof value === "string" ? value : JSON.stringify(value))
}

// 1. direct calls: defaults, morphs — sync handlers are sync functions
show("snapshot direct (defaults)", mesh.snapshot({ directory: "./public" }))
show("snapshot direct (explicit)", mesh.snapshot({ directory: ".", depth: "4", verbose: true }))

// 2. narrow rejection — sync, so it throws
try {
  mesh.snapshot({ directory: ".", signCert: "cert.pem" })
  show("narrow rejects lone signCert", "UNEXPECTED SUCCESS")
} catch (error) {
  show("narrow rejects lone signCert", `threw: ${error}`)
}

// 3. variadic + output contract
show("build direct", mesh.build({ entries: ["a.ts", "b.ts"] }))

// 4. nested subcommand as function
show("cache.stat direct", mesh.cache.stat())

// 5. ctx.exec inside a handler — async handler, async function
show("disk (ctx.exec)", await mesh.disk())

// 6. mounted external, called as typed function — process boundary, async
show("git.status direct", await git.status({ short: true }))

// 7. the cli projection: subcommand + flags + variadic
show("cli: build a.ts b.ts --out-dir out", await mesh.cli.run(["build", "a.ts", "b.ts", "--out-dir", "out"]))
show("cli: snapshot ./public -d 4 -v", await mesh.cli.run(["snapshot", "./public", "-d", "4", "-v"]))

// 8. env fallback
process.env["MESH_DEPTH"] = "6"
show("cli with MESH_DEPTH=6: snapshot ./public", await mesh.cli.run(["snapshot", "./public"]))
delete process.env["MESH_DEPTH"]

// 9. argv error surface
show("cli: snapshot without directory (exit code)", await mesh.cli.run(["snapshot"]))
show("cli: unknown flag (exit code)", await mesh.cli.run(["snapshot", ".", "--nope"]))

// 10. mounted external through argv
show("cli: git status --short", await mesh.cli.run(["git", "status", "--short"]))

// 11. help + version
show("cli: --help", await mesh.cli.run(["--help"]))
show("cli: snapshot --help", await mesh.cli.run(["snapshot", "--help"]))
show("cli: --version", await mesh.cli.run(["--version"]))

// 12. projections
show("mcp.tools", mesh.mcp.tools)
show("complete: ['']", await mesh.cli.complete([""]))
show("complete: ['snapshot','--']", await mesh.cli.complete(["snapshot", "--"]))

// 13. args introspection
show("snapshot.args.allows bad", mesh.snapshot.args.allows({ directory: 1 }))
show("snapshot.args json schema", mesh.snapshot.args.toJsonSchema())
