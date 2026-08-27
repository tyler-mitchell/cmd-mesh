// Conventions other ecosystems already litigated.
//
// These cases are borrowed from citty's test suite (unjs/citty test/args,
// test/parser, test/main) — each one encodes a real-world expectation its
// users filed issues over. Two are cases citty itself cannot pass (#237
// short-alias `=`, marked it.fails upstream) — a mesh parser must.

import { afterAll, describe, expect, it } from "vitest"
import { program } from "../src/index.js"
import { captureCli, captureJson } from "./fixtures/capture.js"
import { bake, deploy, disposeAll } from "./fixtures/programs.js"

// a server-style root: declared flags AND subcommands, the shape citty's
// "sub command with parent args" suite exercises
const serve = program({
  name: "serve",
  version: "1.0.0",
  description: "a dev server with root flags and subcommands",
  input: {
    port: { type: "string.integer.parse = '3000'", cli: "--port, -p" },
    watch: { type: "boolean", cli: "--watch" }
  },
  commands: {
    start: {
      description: "start the server",
      output: { started: "boolean" },
      run: () => ({ started: true })
    },
    stop: {
      description: "stop the server",
      output: { stopped: "boolean" },
      run: () => ({ stopped: true })
    }
  }
})

// a program that claims tokens the interpreter also wants
const claimant = program({
  name: "claimant",
  version: "9.9.9",
  description: "declares --version and -h for itself",
  commands: {
    info: {
      description: "report host info",
      input: {
        host: { type: "string = 'localhost'", cli: "--host, -h" },
        version: { type: "boolean", cli: "--version" }
      },
      output: { host: "string", version: "boolean" },
      run: (input) => ({ host: input.host, version: input.version })
    }
  }
})

afterAll(async () => {
  await disposeAll()
  await serve.dispose()
  await claimant.dispose()
})

describe("flag value syntax (citty args/parser)", () => {
  it("accepts --flag=value for string flags", async () => {
    const result = await captureJson(() =>
      deploy.main(["push", "api", "--json", "--message=hotfix", "--env=production"])
    )
    expect(result).toMatchObject({ service: "api", message: "hotfix", env: "production" })
  })

  it("accepts -a=value on a short alias — citty #237, marked it.fails upstream", async () => {
    const result = await captureJson(() => deploy.main(["push", "api", "--json", "-m=hotfix"]))
    expect(result).toMatchObject({ service: "api", message: "hotfix" })
  })

  it("consumes a hyphen-leading token as a flag value — citty #171", async () => {
    const result = await captureJson(() =>
      deploy.main(["push", "api", "--json", "--message", "-not-a-flag"])
    )
    expect(result).toMatchObject({ service: "api", message: "-not-a-flag" })
  })

  it("consumes a multi-token hyphenated string as one flag value — citty #171", async () => {
    const result = await captureJson(() =>
      deploy.main(["push", "api", "--json", "--message", "-a 192.168.1.1 -b -c"])
    )
    expect(result).toMatchObject({ message: "-a 192.168.1.1 -b -c" })
  })
})

describe("boolean negation against defaults (citty parser)", () => {
  it("negates a default-true boolean with --no-", async () => {
    const opinionated = program({
      name: "opinionated",
      version: "0.0.1",
      description: "a default-true boolean",
      commands: {
        build: {
          description: "build with cache on by default",
          input: { cache: { type: "boolean = true", cli: "--cache" } },
          output: { cache: "boolean" },
          run: (input: { readonly cache: boolean }) => ({ cache: input.cache })
        }
      }
    })
    const on = await captureJson(() => opinionated.main(["build", "--json"]))
    const off = await captureJson(() => opinionated.main(["build", "--json", "--no-cache"]))
    await opinionated.dispose()
    expect(on).toMatchObject({ cache: true })
    expect(off).toMatchObject({ cache: false })
  })

  it("lets an explicit --flag=false beat a default of true", async () => {
    const opinionated = program({
      name: "opinionated2",
      version: "0.0.1",
      description: "explicit false over default true",
      commands: {
        build: {
          description: "build",
          input: { install: { type: "boolean = true", cli: "--install" } },
          output: { install: "boolean" },
          run: (input: { readonly install: boolean }) => ({ install: input.install })
        }
      }
    })
    const result = await captureJson(() => opinionated.main(["build", "--json", "--install=false"]))
    await opinionated.dispose()
    expect(result).toMatchObject({ install: false })
  })
})

describe("parent flags before the subcommand (citty resolveSubCommand)", () => {
  it("routes past a declared value flag: --port 4000 start", async () => {
    const { code } = await captureCli(() => serve.main(["--port", "4000", "start"]))
    expect(code).toBe(0)
  })

  it("routes past a declared value flag in = form: --port=4000 start", async () => {
    const { code } = await captureCli(() => serve.main(["--port=4000", "start"]))
    expect(code).toBe(0)
  })

  it("routes past a declared short alias: -p 4000 stop", async () => {
    const result = await captureJson(() => serve.main(["-p", "4000", "--json", "stop"]))
    expect(result).toMatchObject({ stopped: true })
  })

  it("a declared boolean does not swallow the subcommand name: --watch start", async () => {
    const result = await captureJson(() => serve.main(["--watch", "--json", "start"]))
    expect(result).toMatchObject({ started: true })
  })

  it("still rejects an unknown flag before the subcommand", async () => {
    const { code, err } = await captureCli(() => serve.main(["--bogus", "start"]))
    expect(code).toBe(1)
    expect(err).toMatch(/--bogus/)
  })
})

describe("builtin token conflicts (citty main)", () => {
  it("hands -h to a command that declares it as an alias", async () => {
    const result = await captureJson(() => claimant.main(["info", "--json", "-h", "example.com"]))
    expect(result).toMatchObject({ host: "example.com" })
  })

  it("keeps --help working when -h is claimed", async () => {
    const { code, out } = await captureCli(() => claimant.main(["info", "--help"]))
    expect(code).toBe(0)
    expect(out).toMatch(/Usage:/)
  })

  it("hands --version to a command that declares it as its own flag", async () => {
    const result = await captureJson(() => claimant.main(["info", "--json", "--version"]))
    expect(result).toMatchObject({ version: true })
  })

  it("prints the program version for bare --version", async () => {
    const { code, out } = await captureCli(() => claimant.main(["--version"]))
    expect(code).toBe(0)
    expect(out).toBe("9.9.9")
  })
})

describe("empty and near-empty argv (citty main)", () => {
  it("renders help for a bare group invocation", async () => {
    const { code, out } = await captureCli(() => bake.main([]))
    expect(code).toBe(0)
    expect(out).toMatch(/Usage:/)
  })
})
