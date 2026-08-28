// Shared fixture programs.
//
// These are shaped like tools people actually ship — a deployer, a task
// runner, a passthrough wrapper, a wrapped binary — so every failure the
// suites surface is a failure a real consumer would hit. Nothing
// here is a synthetic minimum: each command carries the parameter shapes
// its real-world counterpart would carry.

import { external, program } from "../../src/index.js"

// ─── deploy: the archetypal service deployer ────────────────────────────────
// positional + short/long flags + enum default + parsed integer + booleans,
// plus a nested config group. the shape almost every internal CLI grows.

export const deploy = program({
  name: "deploy",
  version: "2.1.0",
  description: "ship services to an environment",
  commands: {
    push: {
      description: "push a service build",
      input: {
        service: { type: "string", description: "service name", cli: "<service>" },
        env: {
          type: "'staging' | 'production' = 'staging'",
          description: "target environment",
          cli: { usage: "--env, -e", env: "DEPLOY_ENV" }
        },
        message: { type: "string", description: "release note", cli: "--message, -m" },
        replicas: { type: "string.integer.parse = '2'", description: "replica count", cli: "--replicas" },
        force: { type: "boolean", description: "skip safety checks", cli: "--force, -f" },
        // short-only boolean: no long form to derive a negation from
        watch: { type: "boolean", description: "stream progress", cli: "-w" }
      },
      output: {
        service: "string",
        env: "string",
        replicas: "number",
        force: "boolean",
        watch: "boolean",
        "message?": "string"
      },
      run: (input) => ({
        service: input.service,
        env: input.env,
        replicas: input.replicas,
        force: input.force,
        watch: input.watch,
        ...(input.message === undefined ? {} : { message: input.message })
      })
    },
    rollback: {
      description: "roll a service back to a previous release",
      input: {
        service: { type: "string", cli: "<service>" },
        to: { type: "string", description: "release id", cli: "--to" },
        yes: { type: "boolean", description: "confirm destructive rollback", required: true, cli: "--yes" }
      },
      run: (input) => ({ service: input.service, to: input.to, confirmed: input.yes })
    },
    config: {
      description: "inspect deployment configuration",
      commands: {
        show: {
          description: "print the resolved config",
          output: { env: "string" },
          run: () => ({ env: "staging" })
        },
        set: {
          description: "set a config key",
          input: {
            key: { type: "string", cli: "<key>" },
            value: { type: "string", cli: "<value>" }
          },
          // second-level inline handlers lose contextual parameter types —
          // the documented reverse-mapped-inference limit, annotated here
          // because the prescribed fix (mounting a subprogram) does not
          // survive compilation. see lifecycle "mounted modules".
          run: (input: { readonly key: string; readonly value: string }) => ({
            [input.key]: input.value
          })
        }
      }
    },
    status: {
      description: "list running services",
      output: [{ service: "string", replicas: "number" }, "[]"],
      run: () => [
        { service: "api", replicas: 3 },
        { service: "worker", replicas: 1 }
      ]
    },
    audit: {
      description: "report the last audit result",
      mcp: { name: "deploy_audit_log", annotations: { readOnlyHint: true, destructiveHint: false } },
      output: { ok: "boolean" },
      run: () => ({ ok: true })
    },
    internal: {
      description: "maintenance command agents must not see",
      mcp: { hidden: true },
      output: { drained: "boolean" },
      run: () => ({ drained: true })
    }
  }
})

// ─── tasks: a task runner whose ROOT takes the task name ────────────────────
// the shape that collides with reserved argv tokens: `tasks mcp` is a task
// called "mcp", not a request to serve MCP.

export const tasks = program({
  name: "tasks",
  version: "1.0.0",
  description: "run a named task",
  input: {
    task: { type: "string", description: "task to run", cli: "<task>" },
    silent: { type: "boolean", cli: "--silent, -s" }
  },
  output: { ran: "string", silent: "boolean" },
  run: (input) => ({ ran: input.task, silent: input.silent })
})

// ─── wrap: passthrough to a child tool ──────────────────────────────────────
// every wrapper CLI has this command. everything after `--` belongs to the
// wrapped tool and must survive the parser untouched.

export const wrap = program({
  name: "wrap",
  version: "0.3.0",
  description: "run a tool with forwarded arguments",
  commands: {
    exec: {
      description: "execute a tool with forwarded arguments",
      input: {
        tool: { type: "string", cli: "<tool>" },
        args: { type: "string", description: "forwarded arguments", cli: "<...args>" }
      },
      output: { tool: "string", args: "string[]" },
      run: (input) => ({ tool: input.tool, args: [...input.args] })
    }
  }
})

// ─── bake: boolean shapes that a real build tool accumulates ────────────────
// an explicit `--no-cache` flag living beside a `--cache` boolean is the
// canonical collision: both tokens are meaningful to a human.

export const bake = program({
  name: "bake",
  version: "0.1.0",
  description: "build artifacts",
  commands: {
    run: {
      description: "run a build",
      input: {
        target: { type: "string", cli: "<target>" },
        cache: { type: "boolean", description: "use the build cache", cli: "--cache" },
        noCache: { type: "boolean", description: "bypass the build cache", cli: "--no-cache" },
        quiet: { type: "boolean = false", description: "suppress progress", cli: "--quiet, -q" }
      },
      run: (input) => ({
        target: input.target,
        cache: input.cache,
        noCache: input.noCache,
        quiet: input.quiet
      })
    }
  }
})

// ─── app: two declaration paths that flatten to one MCP tool name ───────────
// a flat `cache_clear` command beside a nested `cache clear` — legal
// declarations, identical flattened tool name.

export const app = program({
  name: "app",
  version: "1.0.0",
  description: "an app with colliding flattened tool names",
  commands: {
    cache_clear: {
      description: "clear the cache (flat spelling)",
      output: { via: "string" },
      run: () => ({ via: "flat" })
    },
    cache: {
      description: "cache operations",
      commands: {
        clear: {
          description: "clear the cache (nested spelling)",
          output: { via: "string" },
          run: () => ({ via: "nested" })
        }
      }
    }
  }
})

// ─── fragile: handlers and presentation hooks that throw ────────────────────
// production handlers throw. `main()` promises an exit code, so a throw
// anywhere under it must still resolve to one.

export const fragile = program({
  name: "fragile",
  version: "0.0.1",
  description: "commands that fail in every available way",
  commands: {
    boom: {
      description: "handler throws",
      run: () => {
        throw new Error("handler exploded")
      }
    },
    rejected: {
      description: "handler rejects",
      run: async () => {
        await Promise.resolve()
        throw new Error("handler rejected")
      }
    },
    badOutput: {
      description: "handler violates its own output contract",
      output: { count: "number" },
      run: () => ({ count: "not a number" }) as never
    },
    badRender: {
      description: "cli render hook throws",
      cli: {
        render: () => {
          throw new Error("render exploded")
        }
      },
      run: () => ({ ok: true })
    },
    badNarrow: {
      description: "narrow predicate throws",
      input: { value: { type: "string", cli: "<value>" } },
      narrow: () => {
        throw new Error("narrow exploded")
      },
      run: (input) => input.value
    },
    noop: {
      description: "succeeds without producing a result",
      run: () => undefined
    }
  }
})

// ─── externals: wrapped binaries ────────────────────────────────────────────

export const git = external({
  name: "git",
  description: "the git binary",
  commands: {
    revParse: {
      description: "resolve a revision",
      input: {
        rev: { type: "string", cli: "<rev>" },
        short: { type: "boolean", cli: "--short" }
      },
      output: "string"
    }
  }
})

export const allPrograms = [deploy, tasks, wrap, bake, app, fragile] as const
