# Changelog





## 0.5.0
<sub>2026-08-29</sub>

- *(minor)*
  Added cli.interactive: guided invocation that prompts per parameter (validated by the same token morphs the parser runs), previews the equivalent command line, and dispatches through the ordinary cli path.

## 0.4.0
<sub>2026-08-29</sub>

- *(minor)*
  Added successCodes to ctx.exec: a declared success set makes any other exit throw ExternalExit, the same vocabulary external commands use.
- *(minor)*
  Added ctx.project and ctx.workspace (package-management's repository resolution, manifest, dependency, and package-manager surfaces) to handlers and suggest generators, and re-exported the repository toolkit (getPath, modifyJSON/modifyJSONFile, createFile, importer, workspace, project) from the package index.
- *(minor)*
  Raised the Node floor to 22, matching the runtime the caller-location and dependency stack require; Node 20 reached end of life in April 2026.

## 0.3.0
<sub>2026-08-28</sub>

- *(minor)*
  Added CLI capabilities: help examples sections, alias-aware help/completion/suggestions and alias-named defaults with a (default) marker, --version anywhere, usage lines on usage errors, handler-chosen exit codes via a thrown exitCode, ArkType .describe() metadata reaching help and schemas, typed cli.render, bare - operands, cluster =-values, and directory-descending file completion.
- *(minor)*
  Added program-level options: root-level input joins every command's handler, call surface, and schema, accepted on either side of the subcommand, with root narrow and env fallback traveling with them.
- *(minor)*
  Added module.spec, a JSON-serializable self-description of the whole program (commands, aliases, defaults, parameters, suggestions, schemas, versions) for doc generators, prompt UIs, and install handshakes.
- *(patch)*
  Fixed external repeatable flags to repeat per value, defaulted structured parameters crashing compile, morph output schemas advertising the wrong side, shared defaults bleeding state between invocations, mcp with trailing tokens serving instead of erroring, and mutable spec/tool projections; externals now reject commands redefining binary-global keys; Node floor lowered to 20.

## 0.2.0
<sub>2026-08-27</sub>

- *(minor)*
  Hardened the CLI grammar against a 220-test pressure suite and rebuilt shell completion on @bomb.sh/tab (zsh, bash, fish, powershell via the `complete` protocol, replacing `completion`/`__complete`). Bare `main()` is now a complete bin entry; flags are position-free; boolean flags accept =true/false/yes/no/on/off; external argv reconstruction fences flag-like positional values behind `--`.

## 0.1.0
<sub>2026-08-27</sub>

- *(minor)*
  Initial release: declarative program model with ArkType-typed inputs, direct invocation, CLI with shell completion, MCP server projection, and external binary wrapping.
