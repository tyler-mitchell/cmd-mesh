# Command Mesh

Command Mesh is organized as a pnpm workspace for TypeScript applications and packages.

The project is centered on a Fig-inspired, ArkType-semantic command
specification that can be projected into CLI runtimes, shell completion, and
MCP tools. Consumers author schema definitions directly without importing
ArkType. Planned adapter targets include citty and
[Tab](https://github.com/bombshell-dev/tab), with
[tinyexec](https://github.com/tinylibs/tinyexec) as the process execution
engine and Effect as a candidate for internal runtime architecture.

## Requirements

- Node.js 24 or newer
- pnpm 11 or newer

## Workspace layout

- `apps/*` contains deployable applications.
- `packages/*` contains reusable packages.
- `tsconfig.base.json` defines the shared TypeScript defaults.

## Workspace packages

- `@command-mesh/spec` defines the command program model and its schema inference.
- `@command-mesh/fig-plugin-types` preserves the complete legacy `Fig.Plugin` declaration and its supporting types.

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
