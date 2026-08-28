# Design audit

Holistic investigation of gaps, ergonomic deficits, and unleveraged
affordances — and the work log of closing all of it.

**Workstream status: complete.** Every finding (1–58) is closed with
pinned evidence, adjudicated under the user's recorded delegation
ruling ("always make the best possible decision"; faked-but-merited
machinery must be made real — which rebuilt `spec` for real, 36), or
recorded as a deliberate deferral (8 count-flags, 15 stderr-on-success,
24 deprecation — each with its revisit trigger). Final gates: cmd-mesh
299/299, tsc, attest, check:pack, repokit 9/9. Finding texts below keep
their original present tense as the record of what was found.

**The finding above all findings:** the declared capability matrix had
never once been enumerated against the artifacts demonstrating it —
finding 29 (optional positionals: documented, working, and invisible in
every example and test) is the proof, and it means every past "fully
proven" claim was scoped to the tests that happened to exist. This audit
is the first such enumeration; it must become a standing gate, not a
one-off.

**Highest severity first:** 49 (external argv places command-scoped
value options before the subcommand — `git log -n 2` shapes spawn
broken commands) · 39 (the release gate calls the deleted
`dispose()` — the next release fails at preflight and public verify) ·
22b (Type-instance params break the CLI — observed defect against a
documented promise) · 40 (`[...xs]` optional variadic broken on both
boundaries — observed) · 9 (MCP undefined-result emits invalid protocol
content) · 35/36 (contract-mandated per-parameter hiding and `spec`
surface absent/deleted) · 1/5 (no short clustering, no repeatable flags
— POSIX/ecosystem baseline missing from the model) · 13/14 (external
model can't set cwd/env and can't receive exit codes — the dogfood
already routes around it) · 16 (completion contradicts the parser for
default groups) · 10 (cancellation ignored end to end) · 41–43
(agent-contract doc lies about the toolchain; Node floor excludes LTS;
tarball never gated).

Each finding carries a status:

- **observed** — driven against the real code in this audit, output quoted
- **code-read** — established by reading the implementation; not yet driven
- **decision** — a deliberate absence or divergence to confirm, not a defect

Areas: argv grammar · declaration model · typed functions · external model ·
MCP surface · completion · help & errors · inference & types · unleveraged
dependency affordances · deliberate absences.

Findings accumulate below, area by area.

## Argv grammar

### 1 · No POSIX short-flag clustering — observed

```sh
mesh snapshot . -dv 4     # UnknownFlag: unknown flag -dv — did you mean -d or -v?
```

`-dv` meaning `-d -v` is getopt/POSIX baseline, supported by clap, cobra,
and Node's own `util.parseArgs`. Every multi-short invocation a shell user
types from muscle memory fails.

### 2 · No attached short value — observed

```sh
mesh snapshot . -d4       # UnknownFlag: unknown flag -d4
```

`-d4` as `-d 4` is the same getopt convention (`-p3000`, `-n10` are
everywhere). Lower priority than clustering, but the same muscle memory.

### 3 · Bare `-` is rejected instead of being an operand — observed

```sh
mesh snapshot - --json    # UnknownFlag: unknown flag -
```

`-` conventionally means stdin/stdout as a positional value. The walk
classifies any `-`-leading token as a flag before positional assignment.

### 4 · Negative-number values cannot reach positionals or flags — observed

```sh
mesh snapshot -5          # UnknownFlag: unknown flag -5
```

Any tool taking numeric values (offsets, deltas, coordinates) cannot
receive them positionally; `--depth -5` works only because value-taking
flags consume the next token verbatim. clap ships an explicit
negative-number heuristic for this.

### 5 · Repeatable flags do not exist in the model — observed

```sh
mesh snapshot . -d 3 -d 9 --json   # { "depth": 9 } — silently last-wins
```

Repetition (`--tag a --tag b` → array) is standard across clap, cobra,
and commander. Our usage notation has variadic positionals (`<...xs>`)
but no variadic-flag form at all, and repetition silently drops values
(last-wins is pinned by a test as current behavior). This is a model gap,
not just a parser gap: the declaration cannot express the need.

### 6 · Error output leaks internal tag vocabulary — observed

```sh
mesh snapshot . --nope    # "UnknownFlag: unknown flag --nope"
```

The stderr line leads with the `Data.TaggedError` class name. Humans get
compiler-internal vocabulary (`UnknownFlag:`, `InvalidInput:`,
`CommandNotFound:`) where gh/cargo-class tools print plain sentences.

### 7 · One exit code for everything — observed

Usage errors, runtime handler failures, and output-contract violations
all exit `1`. The getopt/clap convention distinguishes usage errors
(`2`/`64`) from runtime failure (`1`), which scripts and CI matrices key
on.

### 8 · No counting flags — code-read

`-vvv` verbosity accumulation (clap `Count`) has no model representation.
Lower priority than 1/5; listed for the matrix.

## MCP surface

### 9 · A handler returning `undefined` emits invalid protocol content — code-read

```ts
// src/mcp.ts — CallTool onSuccess
textResult(JSON.stringify(result, null, 2))
// JSON.stringify(undefined) === undefined → { type: "text", text: undefined }
```

`text` is a required string in the MCP content schema. Any command whose
handler returns nothing breaks the client the first time an agent calls
it. Never exercised over the wire (the wire tests only call
value-returning tools).

### 10 · Cancellation is ignored — code-read

The SDK hands every request handler an `extra` argument carrying an
`AbortSignal`; our CallTool handler is `(request) => …` and never looks.
A long `ctx.exec` keeps running after the agent cancels. The Effect
internals are interruption-native — the affordance exists on both sides
and is wired on neither.

### 11 · `title`, progress, and tasks unused — code-read

The installed SDK speaks protocol `2025-11-25`: tools carry an optional
human `title`, requests carry progress tokens, and long operations can be
represented as tasks. We emit none of these; agents see `mesh_snapshot`
where a title could say "Record a directory snapshot".

### 12 · stdio is the only transport — decision to revisit

`mcp.serve()` hard-codes `StdioServerTransport`. The SDK ships Streamable
HTTP; remote/hosted agent setups can't use a mesh tool today.

## External model

### 13 · No per-invocation cwd or env — code-read

```ts
// src/invoke.ts — runExternal
const result = yield* exec.exec(external.bin, args)   // no options
```

`ExternalCommandDecl` has no channel for it either. `git.status()` can
only ever run in the process cwd — a wrapped binary is unusable against
any other directory, which is most real git/docker/kubectl usage.
(`ctx.exec` has `cwd`/`env`/`timeoutMs`; the external model leverages
none of its own exec affordances.)

### 14 · Nonzero exit is always an error — code-read

`runExternal` throws `ExternalExit` on any nonzero code. The `git grep`
1-means-no-match pattern — the exact case our own docs call canonical for
`ctx.exec` — is unrepresentable in `external()`. There is no way to
declare expected exit codes or receive the code as data. (Telling
evidence: repokit wraps git via `ctx.exec` handlers instead of
`external()` — the dogfood already routed around the model.)

### 15 · stderr is discarded on success — code-read

Binaries that report progress or warnings on stderr lose them silently;
the declared `output` contract applies to stdout only, and nothing else
is reachable.

## Completion

### 16 · Default-subcommand groups diverge from the parser — observed

```ts
dev.cli.complete(["--w"])   // [] — yet `devkit --watch` parses and runs
```

The parser sends `devkit --watch` to the default child, but the tab
registry only knows children by name — at the group level none of the
default child's flags complete. Parser and completion disagree about the
same argv.

### 17 · No path-prefix descent for file sources — code-read

`sourceCandidates` lists `readdir(".")` only: `snapshot src/co<TAB>`
offers nothing because candidates never descend into `src/`. Upstream
tab hard-codes `NoFileComp`, so shell-native fallback is unreachable too
(known; contribution candidate).

### 18 · Command aliases don't complete — decision to confirm

`pm i` runs, but `i` is never offered as a candidate (matches cobra's
default of hiding aliases; listed so the choice is deliberate).

## Declaration model & ergonomics

### 19 · Two alias vocabularies — code-read

Parameter aliases live inside a usage string (`cli: "--force, -f"`);
command aliases live in a field (`cli: { alias: ["i"] }`). Same concept,
two spellings, learned twice. Requiredness is split the same way: flags
use `required: true`, positionals encode it as `<x>` vs `[x]`.

### 20 · No way to hide a parameter anywhere — code-read

Command-level `cli.hidden`/`mcp.hidden` exist; a parameter (an internal
or experimental flag) cannot be hidden from help, completion, or the MCP
schema. The dead per-parameter `mcp` config was rightly deleted, but the
underlying capability was never built on any surface.

### 21 · `cli.render` is typed `never` — code-read

Every other handler position (`run`, `narrow`) is inference-wired to the
command's input/output; the render hook forces the author to annotate or
cast. Ergonomic inconsistency in the one place output typing matters
most.

### 22 · A param-level ArkType predicate silently degrades the MCP schema — code-read

`jsonSchemaOf` catches `toJsonSchema()` failures and returns
`{type:"object"}`. A consumer passing a narrowed `Type` instance as
`type:` gets a lying tool schema with no compile-time warning — the
command-level guard (separate un-narrowed schema type) has no
parameter-level counterpart.

### 23 · ArkType's own metadata is unleveraged — code-read

ArkType defs carry `.describe()`/meta that `toJsonSchema` surfaces — but
help and completion read only `descriptor.description`. A described def
documents the MCP schema and nothing else; two description channels,
one honored inconsistently.

### 24 · No deprecation affordance — code-read

Neither commands nor parameters can be marked deprecated (hidden +
warning on use), which clap/cobra treat as a lifecycle basic.

### 25 · No usage examples in help — code-read

cobra's `Example:` section and citty's examples have no counterpart; help
shows grammar but never one concrete invocation.

### 22b · A `Type` instance as `type:` breaks the CLI path — observed

```ts
input: { port: { type: type("string.integer.parse"), cli: "--port" } }
```
```sh
inst go --port 8080    # InvalidInput: port must be a string (was a number) — exit 1
```

The descriptor docs promise "a string def … or a Type instance". But
`isStringDef` routes every non-string def — Type instances included —
through the structured-JSON-token path (`string.json.parse` → the def),
so the token `"8080"` arrives as the number `8080` inside a morph that
expects a string. The value boundary and JSON schema are correct
(`{"port":{"type":"integer"}}`); only argv is broken. Structured-vs-
scalar classification must ask the TYPE's input domain, not the def's
JS representation.

## Handler context

### 22c · `Ctx` carries exec and surface, nothing else — code-read

No logger channel (handlers `console.log` around the renderer), no
`AbortSignal` (pairs with finding 10 — cancellation has nowhere to
flow), no cwd/env view. Each is a real recurring handler need that
currently escapes the interpreter's control.

## Composition & entry

### 26 · `main(argv)` with head `mcp` never resolves — code-read

The programmatic form inherits the serve branch; a caller forwarding user
argv can hang forever on a Promise typed `Promise<number>`. Sharp edge of
the composition contract.

### 27 · The `mcp` word is undiscoverable from the tool itself — code-read

Help's Built-in section lists `complete <shell>` but can never mention
`mcp` (render can't know which entry composed it). A user of a
`main()`-bin has no in-tool path to learn the word exists.

### 28 · Completion scripts assume bin name = program name — code-read

`completionScript` passes `compiled.name` as both name and executable; a
package whose `bin` field aliases differently gets a script targeting the
wrong command.

## Contract drift and violations (against ideations/08-final.ts — the adopted contract the README links)

### 35 · Per-parameter `cli.hidden` / `mcp.hidden` are contract-mandated and absent — code-read

The contract's flagship example declares `tlsCert: { …, mcp: { hidden:
true } }` and its grammar rules state verbatim: "`cli.hidden` /
`mcp.hidden` drop a command **or parameter** from one surface without
touching the other." Neither parameter-level hide exists. Worse: the
dead `mcp` parameter config was deleted in this session's audit as
purposeless machinery — it was actually an unimplemented contract
obligation. Finding 20 is upgraded from "capability never built" to
"contract violation".

### 36 · `module.spec` is contract-mandated and was deleted — decision needing adjudication

The contract names `mesh.spec` ("the declaration as pure data, functions
stripped") as a module-surface member. It was deleted this session as
consumerless. Contract and simplicity mandate conflict here; the user
must adjudicate — either the contract entry falls or the surface
returns (its natural consumer is the planned `@cmd-mesh/cli` describe
handshake).

### 37 · `ctx.exec`'s contract promises are ¾ unbuilt — code-read

The contract sells routing exec through ctx for four properties:
"every spawn observable per invocation" (nothing surfaces spawns),
"inherits the invocation's cwd/env" (Ctx has no cwd/env concept —
finding 22c is contract-backed), "mockable in tests" (Exec is an
internal Effect service with no public injection point; consumers
cannot mock it), "sandboxable under MCP" (no hook). Only the plain
exec-wrapper half exists.

### 38 · Unrecorded contract divergences — the linked contract lies to readers

The README calls 08-final.ts "the contract; this package is its
interpreter", but the file now diverges silently: `complete:` inside
`cli:` became descriptor-level `suggest:`; `mesh.complete`/`mesh.help`
moved under `cli.*`; `main(argv)` grew the bare/`mcp` composition;
narrow's `reject(reason: string)` became the ArkType spec object;
`spec` is gone. Each divergence may be right, but none is recorded —
a newcomer reading the linked contract learns a different product.

## Verification coverage gaps (code paths that exist but were never driven)

- **29** Optional positionals (`[x]`) — probed in this audit and they DO
  work (cli with/without the value, typed call with/without, all
  correct) — but the notation appears in zero examples, zero fixtures,
  zero tests, and never in the README. An advertised capability that no
  consumer-facing artifact demonstrates and no suite protects; the first
  regression ships silently. Defaulted positionals remain entirely
  unprobed.
- **30** A root with both `run` and `commands` (input + subcommands at the
  same level) has no CLI-path test.
- **31** A mounted *program* (not external) driven through the parent's
  CLI: only MCP naming and direct calls are tested.
- **32** MCP call of a no-output-contract, undefined-returning tool (the
  finding-9 path) — untested by construction.
- **33** `suggest` on external-command parameters: shares
  `compileParameter` but never exercised.
- **34** fish and powershell scripts are generated but have never been
  sourced in those shells; Windows has never run anything.

## Found by leaving context behind (second-pass methodology: read what was never read)

### 39 · The release gate is broken in-tree — observed, blocks the next release

`scripts/verify-published.mjs:36` still calls `await probe.dispose()`.
`dispose()` was demolished; the probe throws, and both `release:preflight`
and the public release verifier fail. Root cause is methodological: the
demolition sweep searched `packages/cmd-mesh` and `apps/repokit` only —
`scripts/` consumes the public API and was never swept. Repo-wide
consumer sweeps, always.

### 40 · Optional variadic `[...xs]` is broken on both boundaries — observed

```sh
probe pick a b     # exit 0
probe pick         # InvalidInput: items must be an array (was missing)
```

`IsVariadic` explicitly documents `[...xs]`, but `tokenEntry`/`valueEntry`
make every variadic a required key — only `<...xs>` should demand
presence. `args.assert({})` fails identically. Second broken documented
notation (with 22b), and like optional positionals it has zero
examples/tests.

### 41 · AGENTS.md opens with instructions for a toolchain this repo doesn't use — observed

The Vite+ block instructs `vp install` / `vp check`; `vite-plus` is not a
dependency and no `vp` workflow exists (builds are tsc, tests vitest).
Every agent reading the repo's own agent contract is told to run
commands that don't exist.

### 42 · `engines: node >=24` locks out both current LTS lines — code-read

A library floor above Node 20/22 blocks most consumers today. If it's a
deliberate platform bet it was never recorded; if not, it's an adoption
bug in the manifest.

### 43 · The packed tarball is never gated — code-read

No `publint`, no `@arethetypeswrong/core`, and `check` never packs. The
playbook's public-package contract calls for both on TS libraries;
exports/types breakage would ship silently. (Related minors: no
`"./package.json"` export, no `keywords`, sourcemap/`declarationMap`
correctness of the shipped `dist` never inspected.)

### 44 · `--json` contradicts the recorded design thesis — decision needing adjudication

ideations/09 argues verbatim that with output contracts "no `--json`
flag [is] needed — that flag exists in other tools only because their
output contract is a terminal string." We shipped a reserved `--json`
anyway (defensible for `jq` pipelines) — but the divergence from the
recorded reasoning was never argued or recorded.

### 45 · Two schema surfaces disagree on documentation — observed

`mesh.snapshot.args.toJsonSchema()` lacks the parameter descriptions that
`mesh.mcp.tools[0].inputSchema` carries — `withParameterDocs` decorates
only the MCP path. Same declaration, two different schemas.

### 46 · `args.assert` throws raw ArkType errors — observed

`args.assert` leaks `TraversalError` while every module call throws the
exported tagged classes. A consumer catching by type gets two error
vocabularies from one surface.

### 47 · Handler error chains double-prefix — code-read

`HandlerFailure.message` is `"<path> failed: <cause>"`, and a thrown
`Error` stringifies with its own `Error:` prefix — repokit's `check`
failure prints `repokit check failed: Error: typecheck failed with exit
code 1` behind finding 6's tag prefix. Three layers of framing around
one sentence.

### 48 · Finding 4 reclassified — the `-5`-as-flag behavior is pinned deliberately

`pressure-argv` asserts the flag-shaped-positional error on purpose
("without `--`, `-5` is a flag by construction"). Still
ecosystem-divergent (clap's negative-number heuristic), but it is a
recorded decision, not an oversight; the audit's severity for 4 drops
accordingly.

### 49 · External value-flag placement breaks command-scoped options — observed

```ts
external({ name: "git", commands: { log: {
  input: { count: { type: "string.integer.parse = '2'", cli: "-n" } }, output: "string" } } })
// g.log({}) → spawns `git -n 2 log` → git usage error, ExternalExit
```

The reconstruction emits **every** value-taking flag before the argPath —
a heuristic built for global options (`git -C`) that breaks every option
belonging to the subcommand itself (`git log -n 2`, `docker run -p`).
The existing fixtures pass only because their value flags happen to be
global. The external model lacks the global-vs-command option
distinction entirely; with 13/14/15 this completes the picture of an
under-designed external parameter model.

### 50 · Externals cannot mount — code-read

`ExternalDecl.commands` accepts only inline decls; `program` mounts
programs and externals, `external` mounts nothing. The "one mounting
mechanism" contract sentence holds for programs only; the asymmetry was
never decided or recorded.

## Agent-consumer ergonomics survey (findings 51–57)

Directive: cmd-mesh is optimized for agents as consumers — including the
weakest models. Two failure modes audited: an agent hand-rolls what the
framework should offer, or an affordance exists but is undiscoverable.
Instruments: README-vs-capability diff, JSDoc sweep of the public types,
agent-journey walkthroughs (build → error-handle → test → serve MCP),
MCP-spec affordance check.

### 51 · The README omitted most of the declaration surface — observed
The #1 agent discovery surface had no usage-notation reference and never
taught: command aliases, default subcommand, hidden (cli+mcp), required
flags, repeatable flags, `--json`, exit codes, `cli.render`,
`cli.examples`, `mcp.name`/`annotations`, env fallback placement, or the
testing story. JSDoc in types.ts was already strong — the gap was the
README.

### 52 · No handler-chosen exit code — observed
The diff/grep convention (nonzero exit as a report) had no affordance;
an agent would fight `asBin` with `process.exitCode`. Commander/oclif
carry `exitCode` on the thrown error.

### 53 · Testing story undocumented — decision
Typed functions are the test seam; `cli.run(argv)` returns the exit code
and never touches the process. No new capture API — that would duplicate
what every test harness owns. Documented in README instead.

### 54 · Parse-without-run — decision: not now
A `cli.parse(argv)` returning bound values without executing would serve
REPLs/tests, but no concrete need exists in any consumer. Speculative
machinery under /simple; revisit on a real ask.

### 55 · stdin — decision: node-native
Bare `-` now parses as an operand (finding 3). Reading stdin is the
handler's business via node; a framework stdin affordance would wrap a
platform capability. Not built.

### 56 · Output styling — decision: `cli.render` is the seam
Human rendering stays neutral (grep convention). A consumer wanting
color uses `cli.render` with any styling lib. No built-in styling.

### 57 · Ctx mockability — decision: already an affordance
Handlers are plain functions; `Ctx` is exported and structural. A
hand-built fake ctx is complete mocking. Pinned in reference.test.ts and
documented in README. The 08 contract's observability/sandbox promises
remain roadmap (adjudication).

### 58 · Usage errors did not teach the fix — observed
The weakest-agent lens: a failed invocation printed only the error
message, forcing a second `--help` probe. clap/commander append the
usage line. Now every exit-2 error carries the routed command's usage
line plus a `--help` pointer; exit-1 stays bare (pressure-argv "usage
errors teach the fix"). `usageLine` extracted from renderHelp — one
shape for help and errors.

## Work log

### Identification: EXHAUSTION DECLARED (round 5 closes the campaign)

Round 5 swept the residual census — root-option env through a child,
declared `--json` beating the reserved meaning, external output-contract
violation messaging, unsupported completion shells, cluster `=` values —
and yielded ONE finding against four clean probes:

- **87 · `-fm=hotfix` was UnknownFlag** — the `=` branch looked up
  `-fm` whole before decomposition could run. The miss now falls
  through to short-cluster decomposition, whose attached remainder also
  strips the `=` separator (both halves pinned).

**Stopping criterion, stated:** the yield curve is 8 → 9 → 1 across
rounds 3–5, with round 5's single find a grammar micro-corner. The
domain census — argv grammar, routing/reserved tokens, program-level
options, value boundary, externals, MCP conformance, completion, help,
spec, errors/exit codes, lifecycle/process, declaration validation,
rendering — has every row swept by at least one dedicated round, and
the last full sweep of the residue produced no defect of consequence.
Within these bounds, identification is complete: every actionable
defect derivable from the census is found and fixed or recorded.

**Named bounds (not covered, and not claimed):** Windows and
fish/powershell environments (tab's upstream-tested surface; local
protocol fully pinned); real-client mid-call abort over stdio (the
interruption seam is unit-pinned; wire-level abort needs a client that
cancels, recorded as environment-bound); adversarial inputs beyond the
hostile suite's classes; and unknown unknowns, which no census closes.

Final gates: 354/354, tsc, attest, check:pack, repokit 9/9.

### Identification round 4 (shared-state & contract enumeration) — findings 77–86

New enumerations: state bleed across a long-lived module, throwing vs
ctx.error morphs, help's default-child visibility, the generator words
contract, deep external trees, projection-object mutability. Nine
witnessed findings, all fixed or reclassified:

- **77 · default child invisible in help** — help now marks it
  `(default)` beside the name list.
- **78/80 · spec and mcp.tools were shared mutable objects** — one
  consumer splicing them corrupted every other's view. Both now
  deep-frozen (`deepFrozen`): mutation fails loudly.
- **79 · generators received raw words** — an alias-routed line handed
  `["ws", …]` to a generator that matches on real names. completeEffect
  now hands generators the canonical word list.
- **81 · defaulted-object state bleed (worst of the round)** — the
  default was evaluated once at compile and the SAME instance reached
  every invocation; a handler mutating it corrupted all later calls
  (witnessed: second call saw `retries: 99`). CompiledParameter gains
  `defaultFactory` — the probe re-runs per invocation, so the author's
  own default factory produces a fresh value; `defaultValue` stays as
  the display snapshot.
- **82 · throwing morph — reclassified correct.** ArkType's contract:
  fallible morphs report via `ctx.error` (that path is exit 2 naming
  the parameter, now pinned); a THROWING morph is an author bug and
  exits 1 crash-free (pinned).
- **83 · external command silently redefined a binary-global key** —
  own-wins would ship wrong argv; now a declaration error.
- **84 · defaulted Type-instance structured params CRASHED compile**
  with a raw ParseError (`.to()` rejects defaultable defs) — jsonToken
  now targets the unwrapped output type for defaulted params.
- **84b · assembly-time parse errors escaped InvalidDeclaration** —
  now captured into the aggregate like every other declaration problem.
- **84c · type-level bound (recorded):** defaultness of a Type INSTANCE
  is not statically detectable, so such params type as optional on the
  handler though the runtime always supplies the default.

Probed and CLEAN: defaults-before-narrow ordering, structured-token
inner-path errors, generator-throw degradation, two-level external
argPath ordering, wire-delivered documented schemas.

Gates: 349/349, tsc, attest, check:pack, repokit 9/9.

### Suite reorganization — session vocabulary purged

The "pressure-" prefix on nine test files was conversational residue
(the user's phrase "pressure test"), not domain naming — the exact
transplant failure the naming rules forbid. Renamed by subject via git
mv: argv, routing, conventions, boundaries, external, lifecycle,
hostile, e2e (was pressure-usage), composition; pressure-projections
merged INTO projections.test.ts (one subject, one file). Header
comments swept of the same residue. Historical entries below keep the
old names as a record. Gates re-run green after the move: 336/336,
tsc, attest.

### Identification round 3 (vitest-probe enumeration) — 8 findings (69–76), all fixed or bounded

Method: seven enumerations swept via a vitest probe suite (20 probes,
each pinning correct behavior; failures = findings), then every probe
distributed into its subject-owning suite — round-named test files are
conversational residue and are banned; suites are organized by subject.

- **69 · root narrow leaked around children** — the invariant over
  program-level options was silently bypassed (exit 0) when a child
  was invoked. Root narrow now travels with the root's options
  (compile threads inheritedNarrow beside inherited input).
- **70 · `--version` after a subcommand was UnknownFlag** — now a
  walk-reserved token like `--help` (a command claiming it still
  wins); the old head-only shortcut deleted as subsumed.
- **71 · did-you-mean pool lacked aliases** — `wz` suggested nothing
  though `ws` routes. The suggestion pool is now the resolver's full
  vocabulary (names + aliases).
- **72 · external repeatable flags emitted `--tag a,b`** — a CSV
  convention no binary speaks; reconstruction now repeats the flag per
  value (echo-observed pin).
- **73 · spec had no suggestions** — the prompt-UI consumer (the Fig
  core!) had nothing to generate choices from. ParameterSpec gains
  `suggestions` / `suggestionSource` / `dynamicSuggestions`.
- **74 · spec had no successCodes** — doc gen could not explain a
  `git grep` exit 1. External spec nodes carry them now.
- **75 · root `cli.render` was typed `(output: never)`** — unusable at
  the root while children's is typed. Now typed from the declared root
  output, mirroring the overlay decision.
- **76 · inference bound (documented, not fixed):** a root `narrow`
  beside BARE child handlers trips TS2589; annotating the handler
  clears it (annotating the narrow does not — bisected). README
  documents the bound beside the depth-two limit.

Probed and CLEAN (14 pins distributed to owning suites): `=` splitting
at first =, unicode via =, `--` as an open value-slot value, empty
positional, help-wins-over---json, void under --json, group-call
teaching error, external variadic order, mounted successCodes through
the parent cli, external annotations/examples projection, object-morph
output, merged args surface, root-narrow pair acceptance.

Gates: 336/336, tsc, attest, check:pack, repokit 9/9.

### Penetration round 2 — 6 NEW DEFECTS (63–68), all fixed

**Honest scoping first.** These six were derivable from information
already in hand — no new reads were needed to hypothesize them. Every
earlier "complete" was scoped to "the findings then written down are
closed" and was presented as more than that. The correction is standing:
completion claims below name their enumeration; "done" bare is banned.

- **63 · root program flags were silently swallowed.** `serve --port
  4000 start` bound the value at the root frame and `descend` reset the
  record — accepted input reaching no handler. Model fix (the external
  symmetry): program root `input` is program-level options joining
  every command's handler, call surface, and schema; compile merges
  root input into descendants (own keys win, `global` marked), descend
  carries record entries the child declares. Types thread `RIn` through
  `CommandFn`/`CommandModule`/`CommandsOverlay` exactly like
  `ExternalCommandFn` — attest pins the child handler seeing
  `registry: string` and the call surface `{ pkg, registry? }`.
  Mounted programs keep their own model (finished modules).
- **64 · `cli.default` could not name an alias.** Same root cause
  class as 59/60 — a raw `Record.get` beside the alias-aware resolver.
  Swept ALL sibling sites this time (occurrences over `children`): the
  three remaining raw lookups were all `cliDefault` resolution
  (argv defaultChild, compile validation, completion withDefaultChild).
  Fixed at the ROOT: compile resolves the default to the child's
  canonical name once; every downstream lookup stays a plain access.
- **65 · MCP outputSchema projected the wrong side of a morph.** A
  morph's `toJsonSchema()` throws; the swallow degraded to
  `{type:"object"}`, which then SKIPPED the result-wrap — a live
  protocol violation (bare number advertised as an object). Probed
  ArkType: `.out.toJsonSchema()` is correct and identity for
  non-morphs; `structuredSchema` now projects the output side.
- **66 · `main(["mcp", …extra])` served forever on a typo'd host
  config** — witnessed as a 5s test timeout. `mcp` with trailing
  tokens now errors exit 2 naming the extras.
- **67/68 · spec could not answer its consumers' identity questions.**
  No program `version` (the handshake verifies "which tool, which
  version") and no `defaultCommand` (doc gen must document bare-
  invocation behavior). Both added; the wire pins cover them.

Probed and CLEAN this round: nested default-child chains (`tool` →
default group → its default leaf, flags delivered through both hops) —
pinned as a passing composition test.

README: the reference program now declares a program-level option,
mirrored and pinned (both argv positions + typed surface). Gates:
320/320, tsc, attest (+RIn proof), check:pack, repokit 9/9.

### Test-integrity campaign + penetration round — 4 NEW DEFECTS (59–62), all fixed

The user caught spec.test.ts asserting fields instead of use. The
campaign that followed: every suite read in full, weak/lying pins
rewritten as consumer-driven behavior, a composition suite added, and a
penetration round that surfaced four real defects:

- **59 · help was alias-blind.** `pm.cli.help(["ws"])` said "unknown
  command" though the parser routes `ws`. Fix: `childFor` (the parser's
  own resolver, now exported) resolves help paths — one resolver for
  every projection. Pinned in pressure-conventions.
- **60 · completion was alias-blind.** `complete(["ws",""])` offered
  nothing. Fix: `canonicalWords` rewrites alias tokens to real names
  before tab parses, using the same `childFor` walk — candidates stay
  canonical (decision 18 intact). Bound: a flag VALUE spelling an alias
  of the current node's child would be rewritten; noted in-source.
- **61 · an env value on a repeatable flag rejected.** One exported
  value should equal one `--tag` occurrence; applyEnv now wraps it as a
  single-element array for variadic flags. Pinned in pressure-argv.
- **62 · spec broke its JSON promise for morphed defaults.** A Date
  default sat live in the spec; `wireSafe` now enters defaults in wire
  form (Date → ISO string) or omits the unrepresentable. Pinned in
  spec.test.

Also probed and CLEAN: `-fmhotfix` cluster-remainder consumption
(pinned as a new passing test).

Rewritten-from-first-principles pins: spec.test is now three real
consumers (cli-reference generator, agent tool inventory, wire
handshake — all fail against a fake, witnessed); the lying
"thousand variadic tokens" test (it passed ONE token) now drives 1000
through wrap with order pinned; `toBeTypeOf("function")` /
`typeof out === "string"` / `err.length > 0` / `not.toBe` pins replaced
with content pins (porcelain `## ` headers from real git, echo-observed
external argv reconstruction, exact annotation objects, spec-cross-
checked mcp schemas, named-parameter error messages).

New tests/pressure-composition.test.ts: a package-manager-shaped
program running alias→default-child chains, repeatable flags + env +
variadic positionals in one invocation, carried exit codes, a mounted
external with defaulted flags, and the same composition across typed
calls, completion, help, mcp, and spec — 11 pins.

Gates: 312/312, tsc, attest, check:pack, repokit 9/9.

### 36, 41, 42, 44, 12, 18, 27, 34, 37-residue — ADJUDICATED

**The user's recorded ruling (verbatim intent):** decisioning at this
level is the agent's responsibility — "always make the best possible
decision", "stop asking me questions" — and, on faked machinery:
"clearly nothing should be faked and if there is merit to the thing
which was faked to begin with then it should be real." That standing
ruling delegates these adjudications and adds one substantive
requirement, which changed 36:

- **36 · `spec` — REBUILT REAL (was: stays deleted).** The no-op was
  deleted under the no-purposeless-machinery ruling; the merit test
  then passes on its own terms: the Fig lineage of the design (a rich
  spec powering UIs), doc generation, the planned prompt projection,
  and the install-handshake all need machine-readable command metadata,
  and without it agents hand-roll help-text parsing — the exact failure
  the agent-ergonomics directive names. Shipped as `module.spec`: a
  JSON-serializable descriptor tree (src/spec.ts) mirroring the
  interpreter's own runnability rule, reusing `inputSchema` (documented
  schemas) and the render grammar displays — no parallel model. Pinned
  by tests/spec.test.ts (7 pins incl. JSON round-trip and mounted
  externals); README module-table row added; 08 addendum updated.
- **41 · AGENTS.md Vite+ block — deleted.** It described a toolchain
  this repo does not use (no `vp`, no vite.config anywhere); a doc that
  lies to agents is a defect, not a preference. Reversal: none needed —
  the block can only return with the toolchain.
- **42 · engines `>=24` → `>=20` — verified and lowered.** Dep floors:
  effect/arktype/tab declare none, MCP SDK `>=18`. Our own node usage is
  `readdirSync` + `process.{env,argv,exitCode}` + child_process via
  effect — nothing above 18. Floor set to 20, the oldest maintained
  LTS. Reversal: raise on the first genuinely 22+/24+ API.
- **44 · `--json` — stays.** The "human output only" sentence lives in
  09-practical, an ideation that was never adopted; 08 is the contract
  and does not forbid it. Machine output on the cli surface is what
  agents and scripts consume; it is tested and README-taught. 08
  addendum records it.
- **12 · HTTP MCP transport — deliberate absence.** stdio is what every
  current host (Claude, Cursor, Codex) launches; Streamable HTTP is
  purely additive via the same SDK when a remote-server consumer
  exists. Added to the deliberate-absences list.
- **18 · alias completion — canonical names only, deliberate.** cobra
  behaves the same; completing aliases doubles the candidate list for
  zero teaching value. Recorded.
- **27 · `mcp` word discoverability — closed by 51.** The README's
  module-surface table, reference section, and the mesh example all
  teach `main()` / the `mcp` head token; help's Built-in row covers
  `complete`. No further mechanism.
- **34 · shell/OS matrix — closed by scoping.** What cmd-mesh OWNS is
  the Cobra completion protocol (`complete <shell>` / `complete --`),
  fully pinned in-repo. The per-shell scripts are @bomb.sh/tab's owned,
  upstream-tested surface; a CI matrix here would re-test upstream. The
  one local Windows-sensitive path (completion descent) uses `/`
  separators, valid on Windows Node. Bound stays recorded in exhaustion
  evidence; revisit on the first Windows/fish bug report.
- **37 residue · ctx observability/sandbox — deliberate absence.** All
  process execution is already routed through the Exec service, which
  is the seam any future per-invocation observability or MCP sandboxing
  attaches to; building either now has no consumer. Mockability (the
  third contract promise) is closed (57).

### 19, 24, 38, 50, 58 — closure addendum

- **38** the implementation addendum now lives at the top of
  ideations/08-final.ts (divergences + extensions; 36/44 marked pending
  their rulings).
- **58** closed with the batch below (usage errors carry the usage
  line + --help pointer).
- **19/24/50** decision records below.

Final batch gates: 292/292, tsc, attest, repokit 9/9.

### 3, 17, 30, 31, 33, 21, 23, 25, 51, 52, 53, 55, 56, 57 — CLOSED (agent-ergonomics batch)

- **3** `-` is an operand: walk classifies a lone `-` as positional
  before dash handling (pressure-argv "bare dash").
- **17** file-source completion descends: the current word threads
  buildTab → sourceCandidates; the word's directory part is listed and
  prefixed (`src/com<TAB>` → `src/compile.ts`; projections pin). Dead
  `parameterCandidates` export dropped.
- **30** root `run` beside `commands` driven through the CLI: bare
  invocation runs root with flags bound; children still route; help
  shows both (pressure-conventions "root run beside subcommands").
- **31/33** mounted program AND mounted external driven through the
  parent CLI: `host inner ping` runs, `host echo say hi` spawns the
  binary with the external's own argPath and without the mount token
  (pinned `"say hi\n"`), mounted-external static suggestions complete,
  parent help lists mounts (pressure-external "mounted modules").
- **21** `cli.render` typed: `CliCommandConfig<Out>` generic; the
  overlay types render from the DECLARED output contract only
  (`OutputOf<M[N], unknown>`) — referencing Rs made the reverse mapped
  type uninvertible and collapsed all handler inference to unknown
  (observed via attest; NoInfer did not rescue it). Contract-less
  commands render `unknown`. Attest pins `{ url: string }` in context.
  RawCommandDecl's duplicated inline cli/mcp types replaced with the
  real CliCommandConfig/McpCommandConfig (the duplication had already
  drifted).
- **23** ArkType meta descriptions: `.describe()`/meta reaches help,
  completion, and MCP schemas as the fallback when the descriptor has no
  `description`. Authored-only — `t.meta.description` is empty for
  plain types, so auto-descriptions ("a string") never leak; a default
  wrapper hides meta one level down, recovered via
  `inner.out.exclude("undefined").meta` (probed, then pinned in
  projections "arktype meta descriptions").
- **25** `cli.examples`: rendered as an Examples help section
  (reference.test pin).
- **52** handler-chosen exit codes: a thrown error carrying numeric
  `exitCode` owns the cli exit and prints its message bare (no
  "failed:" framing); the typed surface still throws the framed
  HandlerFailure (pressure-boundaries "handler-chosen exit codes").
- **51/53/57** README: new "Declaration reference" (the notation
  mini-language + every cli/mcp config key, mirrored verbatim by
  tests/reference.test.ts — 13 pins), "Exit codes", and "Testing a mesh
  program" (typed-function seam + fake-Ctx mocking) sections.
- **55/56** recorded above; no code.

Gates: 288/288 + reference suite, tsc, attest (render-typing proof
added), all green.

### 19, 24, 50 — decisions recorded

- **19 · two alias vocabularies — deliberate, closed.** Parameter
  aliases live in the usage string (`"--force, -f"`) because the usage
  string IS the parameter's cli grammar; command aliases live in
  `cli.alias` because commands have no usage string to carry them. The
  asymmetry mirrors the artifact difference — unifying would invent a
  usage string for commands or a config field duplicating the parameter
  grammar, both worse. No change.
- **24 · deprecation affordance — deferred, recorded.** No consumer has
  a deprecated command or flag; building `deprecated:` now is
  speculative machinery under /simple. Revisit on the first real
  deprecation, alongside 15 (stderr-on-success) since a deprecation
  warning is exactly a stderr-on-success emission.
- **50 · externals cannot mount externals — deliberate, closed.** An
  external declaration models ONE binary; its command tree is that
  binary's own subcommand tree (single `bin`, single argPath root).
  Cross-binary composition already exists — mount multiple externals
  into a program (`commands: { git, docker }`), now pinned by the
  mounted-modules suite (31/33). Mounting an external inside an
  external would splice two binaries into one argPath, which is not a
  thing any binary accepts. Contract sentence holds: programs are the
  composition mechanism.

### Argv grammar cluster (1, 2, 5; 8 deferred) — design record

Candidates for short-option grammar (1/2):

- **Decompose-on-miss (chosen).** A `-abc` token that is not itself a
  declared token decomposes per POSIX guideline 5 / clap rules: each char
  resolves as a declared short; every char but the last must be boolean;
  a value-taking last char consumes the remainder as an attached value
  (`-d4`) or the next token. Any unresolvable char fails the WHOLE token
  with the existing UnknownFlag suggestion — so `-5` stays an error
  (finding 48's pinned decision) because digits are never declared
  shorts. Declared tokens win before decomposition, so an explicitly
  declared multi-char short keeps meaning itself.
- Rejected: always-decompose (breaks declared multi-char shorts);
  config-gated clustering (POSIX baseline should not be opt-in).

Candidates for repeatable flags (5):

- **Commander's value-slot notation (chosen).** Usage may carry a
  variadic value slot after the flag: `cli: "--tag <tags...>, -t"`.
  This reuses the exact vocabulary positionals already use (`<...xs>`)
  and the ecosystem already knows (Commander `--tag <value...>`; Fig
  `isRepeatable`). Semantics mirror positional variadics: occurrences
  append; omitted ⇒ `[]`; `required: true` ⇒ at least one. Last-wins
  stays the pinned behavior for non-variadic flags.
- Rejected: array-typed element inference (`type: "string[]"` implying
  repetition — conflates value shape with argv arity; a structured
  JSON-token param can legitimately BE an array), and a boolean
  `repeatable` config key (a second vocabulary for what notation
  already expresses).

Count flags (8) stay deferred: `-vvv` decomposes to three booleans
today; counting semantics wait for a real consumer.

### 45 — CLOSED

The doc-decoration was never mcp-specific: split `documentSchema`
(descriptions + suggestion examples) from the mcp-only hidden filter;
`args.toJsonSchema()` now projects through it, so both schema surfaces
carry the same documentation. Pinned by the usage-suite parity
assertion. Gates: 258/258.

### 28 — CLOSED · 26 — reclassified as decision

Completion scripts now target the name the process was invoked as
(`invokedBinName` from `argv[1]`, bin-mode only — programmatic runs keep
the declared name, pinned both ways; the real bin observed emitting
`#compdef bin.ts` in dev). 26 (`main(argv)` with head `mcp` serves
forever) is the documented composition contract, not a defect — the doc
now states the promise resolves only when the server ends; callers who
must not serve use `cli.run`. Gates: 259/259, attest, pack, repokit.

### 6, 7, 46, 47 — CLOSED (design below)

Implemented as designed: curated messages on stderr (no tag names,
pinned negatively), usage-vs-runtime exit codes via one tag map (every
suite's pins updated deliberately, incl. repokit's), `args.assert`
throwing the exported `InvalidInput`, and single-framed handler
failures. Three new presentation pins. Gates: 258/258 + repokit 9/9,
attest, pack gate.

### Error presentation cluster (6, 7, 46, 47) — design record

- **6 · stderr vocabulary**: the CLI prints each error's curated
  `message`; the internal tag name (`UnknownFlag:`) never reaches
  humans. Unexpected defects keep their full string — hiding those
  would obscure real crashes.
- **7 · exit codes**: adopt the getopt/clap split — usage errors exit
  `2` (routing, parsing, input validation: CommandNotFound, UnknownFlag,
  MissingFlagValue, UnexpectedArgument, InvalidInput), runtime failures
  exit `1` (HandlerFailure, ExternalExit, InvalidOutput,
  NoRunnableCommand, defects). `--help`/`--version` stay `0`. Pinned
  suite expectations updated deliberately — this is the recorded
  contract change scripts can key on.
- **46 · one error vocabulary**: `args.assert` maps ArkType's
  TraversalError into the exported `InvalidInput`, so every surface
  throws the same catchable classes.
- **47 · no double framing**: `HandlerFailure.message` renders an
  `Error` cause by its own message (`x failed: boom`), not its
  stringified `Error: boom` form.

### 10 — CLOSED

Cancellation flows end to end: the SDK hands each request handler an
`AbortSignal` (`extra.signal`); a new `runAbortable` boundary util forks
the invocation fiber, aborts interrupt it via the Fiber interface's
designated external hook (`interruptUnsafe`), and interruption closes
the invocation scope — which kills any spawned child. Pinned by a test
running a real `sleep 10` under the real Exec layer, aborted at 150ms,
rejecting in well under 3s. v4 has no run-option signal (checked in
source); the fork/listen/join seam is the native shape. Gates: 255/255,
attest.

### 16 — CLOSED

Failing test first (`devkit --w<TAB>` must offer `--watch` because
`devkit --watch` parses). Fix in the registry projection where the rule
belongs: a group with `cli.default` also registers its default child's
parameters on its own node (`withDefaultChild`, applied at root and at
every group). Completion and parser now share one rule. Gates: 254/254.

### 1, 2, 5 — CLOSED (8 stays deferred)

Implemented per the design record above, failing-tests-first (nine new
grammar tests): clustered boolean shorts (`-fw`), attached short values
(`-mhotfix`), booleans-then-value-taker clusters (`-fm note`),
whole-token failure on any unresolvable char, repeatable flags via
`cli: "--tag <tags...>, -t"` (append across `--tag`, `-t`, and `=`
spellings; `[]` when omitted; typed surface returns arrays; last-wins
pinned for non-variadic flags; boolean + value-slot is a declaration
error). One shared `withFlagValue` records values in every branch; the
type-level `IsVariadic` unified to "usage contains `...`" across all
four spellings. Gates: 253/253, attest, pack gate, repokit 9/9.

### Hand-roll ⇄ installed-affordance sweep — record (per goal rule 1)

Read in full for this sweep: Effect's complete v4 module catalog (135
modules) and its bundled `ai-docs` index; Formatter's surface.

- **ADOPTED — `Formatter.format`** for the human render fallback:
  handles BigInt, Dates, Maps, and circular references instead of
  throwing. Cyclic handler output now renders (`[Circular]`) at exit 0
  for humans; strict `--json` still refuses loudly (machine-honest).
  Deleted a whole class of defect-path exits; tests updated to pin the
  better contract.
- **Evaluated, not adopted — `Config`/`ConfigProvider`** for env
  fallback: our pinned semantics treat an empty export as unset (the CI
  `DEPLOY_ENV=` case); Config treats "" as present, so adoption would
  need a wrapper reimplementing exactly the filter we have — more
  machinery for the same one platform-boundary read.
- **No affordance exists** — edit distance (suggest.ts): no
  Levenshtein/distance module in the catalog (Trie is prefix-only);
  column alignment (render.ts): Formatter formats values, not tables.
  Both hand-rolls stand as the smallest owners of their jobs.
- **Seam justified, unchanged** — `readdirSync` in completion sources:
  Effect's FileSystem service is async-effectful while tab handlers are
  synchronous callbacks; the sync platform read remains the boundary.
  Console capture around `tab.parse`: tab prints via the global console
  directly, so Effect's Console substitution cannot intercept it.

### 35 — CLOSED (with 20)

The contract's per-parameter hiding now exists, matching the
command-level precedent: hidden = unadvertised on that surface, still
functional. `cli: { hidden: true }` drops a flag from help and
completion (still parses; positionals cannot be cli-hidden — declaration
error, since it would corrupt argv order); `mcp: { hidden: true }` drops
a parameter from the advertised tool schema and its `required` list
(still validates if supplied — 09-practical's secret-token case).
Failing tests first (three, incl. the wire-visible schema and the
declaration error). The previously deleted dead config is thus
reinstated as a working capability, resolving the 35/20 contract
violation. Gates: 244/244, attest, build, repokit 9/9.

### 9 — CLOSED

Discovery: asked the SDK's own `CallToolResultSchema` directly —
`content: []` parses valid, `text: undefined` is rejected. The example
gained a genuinely representative void command (`mesh cache clear`),
pinned by a failing wire test over the real stdio transport, then the
CallTool success path maps an `undefined` result to `{ content: [] }` —
symmetric with the CLI's print-nothing behavior for void results.
Gates: 241/241, attest, build.

### 22b — CLOSED

Failing boundary-agreement test first (Type-instance `--port 8080` must
equal the typed call). Fix: scalar-vs-structured classification now asks
the compiled type's INPUT domain — `inner.in.extract("string")` non-never
⇒ raw token — instead of the def's JS representation; `isStringDef`
replaced by `takesRawToken` (string defs short-circuit identically).
Affordance: ArkType's `.in`/`.extract` introspection, per the skill.
Gates: 240/240, attest, build.

### 40 — CLOSED (and 29's test half)

Failing tests first (`positional notations` in pressure-argv: `[x]`
accept/omit, `[...xs]` collect/empty, typed-surface parity). Affordance:
the ArkType skill's canonical array-default form — an optional variadic
compiles as `[arrayType, "=", () => []]` (factory per parse), a required
one keeps `atLeastLength(1)`. Two-line change per boundary in
`tokenEntry`/`valueEntry`; the call-side types already agreed
(`IsOptionalPositional` matches `[…`). `[x]` runtime behavior is now
pinned by suite, closing finding 29's missing-test half; its
missing-example/README half stays open under 29. Gates: 239/239, attest,
build.

### 39 — CLOSED

Reproduced via `pnpm run release:preflight` (TypeError: probe.dispose is
not a function), fixed by aligning the probe to the current surface
(`cli.run`, no dispose), re-run to exit 0. The gate itself is the pin —
it is the repo's own failing-then-passing test; duplicating it in vitest
would be ceremony. Version-skew note: the probe verifies the release it
ships with, so aligning to the current surface is correct for both
preflight (packed tree) and the public verifier (next published
version). Follow-up recorded, not smuggled in: the playbook's preferred
MCP wire probe (client over production transport) remains a gap in this
gate — the usage suite covers the wire in CI, the published-artifact
probe does not.

### External model redesign (closes 49, 13, 14; defers 15 pieces) — design record

Candidates considered:

- **A · Level = placement (chosen).** `external()` gains root-level
  `input`: root parameters are the binary's global options and emit
  before the subcommand path; command-level parameters all emit after it
  (flags in declaration order, then positionals). This is Fig's
  persistent-option model — our own lineage — and matches how binaries
  document themselves (git's man page splits options exactly this way).
  Finding 49's broken heuristic (value-flags-always-pre) is deleted, not
  patched: placement follows declaration level, a fact, instead of
  flag kind, a guess.
- **B · Per-parameter `global: true` annotation.** Rejected: repeats the
  declaration on every command, and global options are binary-level
  facts, not per-command ones.
- **C · Verbatim declaration-order interleaving with an explicit argPath
  marker.** Rejected: exotic grammar for no expressive gain.

Mechanism: global parameters are compile-time merged into each leaf's
parameter list with a placement marker — so typed calls, MCP schemas,
and the CLI walk all handle them with zero new machinery; only the
spawn-time reconstruction reads the marker. (CLI users write globals
after the subcommand like any flag — flags are position-free — and the
spawn still places them correctly for the binary.)

For 13 (cwd/env): the value surface takes an optional second options
argument — `git.status(input?, { cwd, env, timeoutMs })` — the
`fetch(url, init)` shape, typed as the existing `ExecOptions` subset;
`ChildProcess.CommandOptions` already owns all of it underneath. Not
exposed to MCP (agents don't choose spawn contexts — deliberate).

For 14 (exit codes): command-level `successCodes?: ReadonlyArray<number>`
(default `[0]`) — listed codes are success and the stdout contract
applies (git-grep declares `[0, 1]`; no-match yields stdout `""` which
the morph shapes); anything else remains `ExternalExit`.

Deferred, recorded: stderr-on-success capture (15) and cli-surface
delivery notes folded into the mechanism above; externals mounting
externals (50) is a separate model decision.

**CLOSED (49, 13, 14)** — implemented as designed, pinned by six new
tests in pressure-external (each written failing first; the two that
passed vacuously were made discriminating before implementation):
`git log -n 2` shapes now spawn correctly (49), root-level `-C` reaches
the binary pre-subcommand and is proven by a failing non-repo target,
`{ cwd }` on the call surface is proven the same way (13), and
`successCodes: [0, 1]` makes git-grep's no-match a value while 128 still
fails (14). Affordances: `ChildProcess.CommandOptions` already owned
cwd/env/timeout — only threading was added; the placement model is Fig's
persistent-option concept via declaration level; the old value-kind
heuristic was deleted, not patched. repokit's hand-rolled exit-code
branching could now migrate to `external()` — left as the author's
choice since its header declares ctx.exec exercising deliberate.
Gates: 236/236, attest, build, repokit 9/9.

| capability | example | test | status |
| --- | --- | --- | --- |
| `<x>` required positional | ✓ | ✓ | proven |
| `[x]` optional positional | — | ✓ | tested (40 closure); example/README still owed (29) |
| `<...xs>` variadic | ✓ | ✓ | proven |
| `[...xs]` optional variadic | — | ✓ | fixed + tested (40 closure) |
| positional with ArkType default | — | — | works (audit probe, both boundaries) |
| flag + aliases (usage string) | ✓ | ✓ | proven |
| clustered shorts / attached values | — | ✓ | proven (1/2 closure) |
| repeatable flags (`--tag <tags...>`) | — | ✓ | proven (5 closure) |
| `required: true` flag | ✓ | ✓ | proven |
| `cli.env` fallback | ✓ | ✓ | proven |
| `suggest: "folders"/"filepaths"` | ✓ | ✓ | proven |
| `suggest: [static]` | — | — | works (audit probe only) |
| `suggest: generator` | ✓ (repokit) | ✓ | proven |
| `type:` string def | ✓ | ✓ | proven |
| `type:` object def (structured) | ✓ | ✓ | proven |
| `type:` Type instance | — | ✓ | fixed + tested (22b closure) |
| `cli.hidden` (command) | ✓ (repokit) | ✓ | proven |
| `cli.alias` (command) | ✓ (README reference, pinned) | ✓ | proven |
| `cli.default` (group) | ✓ (README reference, pinned) | ✓ | proven |
| `cli.render` | ✓ (README reference, pinned) | ✓ | proven; typed from declared output (21 closure) |
| `cli.examples` | ✓ (README reference, pinned) | ✓ | proven (25 closure) |
| `mcp.hidden` (command) | ✓ (repokit) | ✓ | proven |
| `mcp.name` / `mcp.annotations` | ✓ (deploy fixture) | ✓ | proven; annotations never wire-tested on external |
| cli/mcp hidden (parameter) | — | — | **missing, contract-mandated** (35) |
| `narrow` + NarrowContext | ✓ | ✓ | proven |
| `output` contract (program) | ✓ | ✓ | proven |
| `output` morph (external stdout) | — | — | works (audit probe) |
| external param defaults | — | ✓ | proven (`git log -n '2'` default drives the spawn) |
| external global options (root input) | — | ✓ | proven (49 closure) |
| external `successCodes` | — | ✓ | proven (49 closure) |
| external call options `{cwd,env,timeoutMs}` | — | ✓ | proven (49 closure) |
| `narrow` ctx.mustBe (runtime) | — | — | works (audit probe) |
| externals mounting externals | — | — | **impossible** (50) |
| `main()` / `cli.run()` / `mcp.serve()` | ✓ | ✓ | proven |
| `args.allows` / `toJsonSchema` | ✓ | ✓ | proven |
| `args.assert` | — | — | works; wrong error vocabulary (46) |
| exported error classes | ✓ (README Synchrony) | ✓ | proven |
| handler `exitCode` carry | ✓ (README Exit codes, pinned) | ✓ | proven (52 closure) |
| arktype `.describe()` → docs | — | ✓ | proven (23 closure) |

## Exhaustion evidence

The audit's coverage claim rests on four systematic instruments, each run
to completion rather than sampled:

1. **Contract diff** — ideations/08-final.ts and 09-practical.ts read in
   full against the implementation; every divergence recorded (35–38, 44).
2. **Capability matrix** — every declaration field, usage notation, config
   key, and module-surface member enumerated above; every previously
   unprobed cell has now been driven (positional defaults ✓, external
   output morph ✓, runtime `mustBe` ✓, external param defaults → 49) —
   **no cell remains unprobed**.
3. **Repo-wide unread-artifact sweep** — every consumer-facing artifact
   outside the package read in full: repokit source, both release
   verifier scripts and the probe (→ 39), AGENTS.md (→ 41), package
   manifests (→ 42–43), all pressure-suite bodies (→ 48), demo driven
   end to end (→ 45).
4. **Ecosystem-convention sweep** — POSIX/getopt, clap, cobra, citty, tab,
   and the MCP spec each checked capability-by-capability (1–8, 10–12,
   16–18).

Bounds stated honestly: findings marked code-read are established by
implementation reading, not yet by failing execution; Windows and
fish/powershell remain unexercised environments (34); and no audit can
certify the absence of unknown unknowns — but every *enumerable*
dimension above was enumerated and closed.

## Deliberate absences (confirmed decisions, restated so they stay visible)

- camelCase↔kebab argv interchange — rejected (ambiguity).
- Reserved `-v` — rejected (loses to `--verbose`).
- Raw argv exposure to handlers — rejected (value-boundary purity).
- Lazy subcommand loading — deferred pending a measured ArkType
  compile-cost problem.
- setup/cleanup hooks + plugins — deferred pending a three-surface
  lifecycle design.
- Config-file layer (argv > env > config > default) — never designed;
  large CLIs will ask.
- Shell completion for aliases — see 18.
- HTTP MCP transport — see 12; stdio is every current host's launch
  mode, Streamable HTTP is additive via the same SDK.
- ctx observability/sandbox — see 37; the Exec service is the seam,
  no consumer yet.
- Parse-without-run (`cli.parse`) — see 54.
- Framework stdin affordance — see 55; `-` parses, node owns reading.
- Built-in output styling — see 56; `cli.render` is the seam.
