# Fig plugin types

This package preserves the complete ambient TypeScript declarations for Fig's legacy shell-plugin format. The declarations expose the global `Fig` namespace, including `Fig.Plugin` and all installation and configuration types it depends on.

The source is vendored unchanged from [`withfig/plugins`](https://github.com/withfig/plugins/blob/472b99ba0609b55cca8e4a8c0f4a83d768ad59af/index.d.ts) at commit `472b99ba0609b55cca8e4a8c0f4a83d768ad59af`. The upstream license is included in this package.

## Usage

Add the workspace package as a development dependency:

```json
{
  "devDependencies": {
    "@command-mesh/fig-plugin-types": "workspace:*"
  }
}
```

Include it in the consuming package's TypeScript configuration:

```json
{
  "compilerOptions": {
    "types": ["node", "@command-mesh/fig-plugin-types"]
  }
}
```

The types are then available through the original namespace:

```ts
const plugin = {
  name: "zsh-autosuggestions",
  installation: {
    origin: "github",
  },
} satisfies Fig.Plugin;
```
