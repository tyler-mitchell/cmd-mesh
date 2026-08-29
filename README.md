# Command Mesh

Command Mesh is organized as a pnpm workspace for TypeScript applications and packages.

The project is centered on a declarative, ArkType-typed command program
model. One declaration projects into typed functions, a CLI with help and
shell completion, an MCP server for agents, and a machine-readable spec.
Consumers author schema definitions directly without importing ArkType.
Completion runs on [Tab](https://github.com/bombshell-dev/tab); process
execution and the internal runtime are Effect.

## Requirements

- Node.js 24 or newer
- pnpm 11 or newer

## Workspace layout

- `apps/*` contains deployable applications.
- `packages/*` contains reusable packages.
- `tsconfig.base.json` defines the shared TypeScript defaults.

## Workspace packages

- `cmd-mesh` defines the command program model and every projection of it.
- `repo-ops` declares this repository's operations as mountable modules.
- `repokit` (in `apps/`) is the installed bin that consumes them.

Workspace packages should extend the root TypeScript configuration:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

## Commands

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm check
```
