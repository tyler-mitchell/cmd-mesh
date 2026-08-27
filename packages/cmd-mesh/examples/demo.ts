// drives the real execution paths of @cmd-mesh/core. run with:
//   pnpm exec tsx examples/demo.ts
import { git, mesh } from "./mesh.js"

const show = (label: string, value: unknown) => {
  console.log(`\n== ${label} ==`)
  console.log(typeof value === "string" ? value : JSON.stringify(value))
}

// 1. direct calls: defaults, morphs
show("serve direct (defaults)", await mesh.serve({ directory: "./public" }))
show("serve direct (explicit)", await mesh.serve({ directory: ".", port: 8080, verbose: true }))

// 2. narrow rejection
show(
  "narrow rejects lone tlsCert",
  await mesh.serve({ directory: ".", tlsCert: "cert.pem" }).then(
    () => "UNEXPECTED SUCCESS",
    (error) => `rejected: ${error}`
  )
)

// 3. variadic + output contract
show("build direct", await mesh.build({ entries: ["a.ts", "b.ts"] }))

// 4. nested subcommand as function
show("cache.stat direct", await mesh.cache.stat())

// 5. ctx.exec inside a handler
show("disk (ctx.exec)", await mesh.disk())

// 6. mounted external, called as typed function
show("git.status direct", await git.status({ short: true }))

// 7. argv projection: subcommand + flags + variadic
show("main: build a.ts b.ts --out-dir out", await mesh.main(["build", "a.ts", "b.ts", "--out-dir", "out"]))
show("main: serve ./public -p 9999 -v", await mesh.main(["serve", "./public", "-p", "9999", "-v"]))

// 8. env fallback
process.env["MESH_PORT"] = "4444"
show("main with MESH_PORT=4444: serve ./public", await mesh.main(["serve", "./public"]))
delete process.env["MESH_PORT"]

// 9. argv error surface
show("main: serve without directory (exit code)", await mesh.main(["serve"]))
show("main: unknown flag (exit code)", await mesh.main(["serve", ".", "--nope"]))

// 10. mounted external through argv
show("main: git status --short", await mesh.main(["git", "status", "--short"]))

// 11. help + version
show("main: --help", await mesh.main(["--help"]))
show("main: serve --help", await mesh.main(["serve", "--help"]))
show("main: --version", await mesh.main(["--version"]))

// 12. projections
show("mcp.tools", mesh.mcp.tools)
show("spec", mesh.spec)
show("complete: ['']", mesh.complete([""]))
show("complete: ['serve','--']", mesh.complete(["serve", "--"]))

// 13. args introspection
show("serve.args.allows bad", mesh.serve.args.allows({ directory: 1 }))
show("serve.args json schema", mesh.serve.args.toJsonSchema())

await mesh.dispose()
