# Changelog






## 1.0.0
<sub>2026-09-01</sub>

- *(major)*
  Added a shared toolkit for files, paths, configuration, dependencies, typed dynamic imports, module resolution, projects, and workspaces. Hand-built `Ctx` values must spread the exported `toolkit` object.
- *(major)*
  Replaced workspace-only ArkType metadata defaults with native default tuples in declarations, generated code, and documentation. `CMSH1016` rejects metadata that looks like an applied default before it becomes a required parameter.
- *(minor)*
  Added ExecOptions.preferLocal: prepend the enclosing workspace's node_modules/.bin to PATH so workspace-local binaries resolve regardless of how the process was started; a no-op outside any repository.
- *(minor)*
  Added program-level resources: declared acquire/release pairs run around every handler invocation on all three surfaces — acquired before the handler, typed on ctx.resources, released in reverse order whether the handler succeeds or throws.
- *(minor)*
  Added the command safety taxonomy: `safety: "read" | "action" | "destructive"` on internal and external commands, validated at compile time, exposed in the spec, and projected to MCP tool annotations with both hints always explicit (`readOnlyHint` and `destructiveHint`) so clients never fall back to their destructive-by-default assumption. Every repo-ops operation now declares its safety.
- *(minor)*
  Added a version-matched Agent Skill at `skills/cmd-mesh/SKILL.md` with complete CLI-first code, progressive references, and explicit MCP opt-in. The MCP projection also gained `mcp.server()`, the `cmd-mesh://spec` resource, and a paired `<name>_spec` tool.
- *(minor)*
  Declaration validation now emits coded diagnostics: every `InvalidDeclaration` issue line carries a stable `CMSH1xxx` code and a fix hint, built on `nostics` at the validation boundary while the tagged error classes remain the error channel. The errors reference lives at `docs/errors.md` in the package.
- *(minor)*
  An incorrect parameter or command field is now a declaration error (`CMSH1013`). Before, it had no effect and gave no message. TypeScript does not find all of these fields: it does not report a field whose type is a union with a primitive, which is the type of a parameter. Thus `cli: { complete: "filepaths" }` and `sugest: "folders"` both compiled without an error. A JavaScript caller has no check. The interpreter now gives the name of the unknown field and the names of the correct fields. The command case is more important: `mcp: { hiden: true }` kept a command visible to agents. An unknown `suggest` source is also an error now (`CMSH1014`); before, it gave no candidates and no message.
- *(minor)*
  A required parameter that is hidden from mcp is now a declaration error (`CMSH1015`). The tool schema omits the parameter, so an agent cannot supply it and every call fails validation; the `env` fallback does not help, because it runs on the cli path only. Declare a default, make the parameter optional, or hide the whole command from mcp.
- *(minor)*
  Added numeric parameters that accept CLI text and MCP numbers through one ArkType union without weakening prompt validation.
- *(patch)*
  Guided invocation no longer accepts an empty submission for a required positional. The prompt read the flag-only `required` field, which a positional never sets, so `<entry>` was offered as skippable. The command line then failed validation after the walk. The prompt now uses the same requiredness rule as the spec: a positional is optional only when its usage says so.
- *(patch)*
  Every declaration issue now carries a link to its section in the errors reference. The link was computed for each code but discarded before the message was built, so a reader saw the code with no route to the page that explains it.
- *(patch)*
  The README, the reference, and the bundled agent skill now teach that a bare ArkType definition is a complete parameter: `input: { force: "boolean" }` derives the flag `--force` from the key. The shipped code always accepted this, but every example used the `{ type, cli }` descriptor, so readers concluded the descriptor was mandatory.
- *(patch)*
  An mcp tool call now carries only the parameters its command declares. An argument that no parameter declares reached the handler untouched, so an agent could put any key it invented into handler input; the cli already rejects an undeclared flag.
- *(patch)*
  An `ExternalExit` from a streamed command no longer ends in a dangling colon. A child run with `stdio: "inherit"` writes its own stderr to the terminal, so the captured text is empty and the message read `pnpm exited with 1:` with nothing after it. Captured stderr is also trimmed now.
- *(patch)*
  `CMSH1013` now checks a parameter's `mcp` object too. A command's `mcp` block was checked and a parameter's was not, so `mcp: { hiden: true }` on a parameter passed silently and left the parameter advertised in the agent-facing schema — the exact case the diagnostic exists to catch.
- *(patch)*
  Stopped program declarations from attaching unused terminal listeners by providing only the Effect process services they use.
- *(patch)*
  Fixed release-blocking runtime, MCP projection, config-key, generated-identifier, and package-content defects. Added compact review-thread commands for release work.

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
