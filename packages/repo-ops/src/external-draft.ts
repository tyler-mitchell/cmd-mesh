// cmd-mesh re-exports package-management's file and path utilities, so a
// consumer needs one dependency, not two
import { createFile, getPath, program } from "cmd-mesh"
import {
  declareExternal,
  parseHelpCommands,
  parseHelpFlags,
  parseHelpPositionals,
  parseHelpSubcommands
} from "./help-parse.js"
import type { DraftCommand, HelpCommand } from "./help-parse.js"

// Wrapping a binary by hand means reading its help and transcribing every
// flag. This reads the help instead and writes the declaration, leaving a
// person the part that needs judgement: safety, narrower types, and which
// commands are worth exposing at all.

export const external = program({
  name: "external",
  description: "draft a typed surface from a binary's own help",
  commands: {
    draft: {
      description: "write a declaration drafted from a binary's help",
      safety: "action",
      input: {
        bin: ["string", "@", { description: "the binary to read", cli: "<bin>" }],
        commands: [
          "string[]",
          "@",
          {
            description: "subcommands to draft; omitted, the binary's own help is asked",
            cli: "[...commands]",
            default: () => []
          }
        ],
        depth: [
          "string.integer.parse | number.integer",
          "@",
          {
            description: "a depth of subcommands to follow",
            cli: "--depth, -d",
            default: "1"
          }
        ],
        out: [
          "string",
          "@",
          {
            description: "file to write, relative to the working directory",
            cli: "--out, -o",
            suggest: "filepaths"
          }
        ]
      },
      output: { file: "string", commands: "number", flags: "number" },
      // an agent otherwise has to guess whether `commands` is required
      // and what `depth` does; these are schema-checked at compile time,
      // so a wrong one is a declaration error rather than bad advice
      mcp: {
        examples: [
          {
            args: { bin: "git", out: "src/git.ts" },
            description: "draft every command the binary documents"
          },
          {
            args: { bin: "git", commands: ["status", "log"], out: "src/git.ts" },
            description: "draft only the commands named"
          },
          {
            args: { bin: "git", commands: ["remote"], depth: 1, out: "src/git-remote.ts" },
            description: "follow a group's own subcommands one level down"
          }
        ]
      },
      run: async (input, ctx) => {
        // named commands win; otherwise ask the binary what it has
        const top: ReadonlyArray<HelpCommand> = input.commands.length > 0
          ? input.commands.map((name) => ({ name, description: `${input.bin} ${name}` }))
          : parseHelpCommands(
            await ctx.exec(input.bin, ["--help"]).then((r) => `${r.stdout}${r.stderr}`)
          )
        // a group like `git remote` names its children only in its own
        // usage block, and each child answers `-h` for itself
        const draftOne = async (
          path: ReadonlyArray<string>,
          description: string,
          depth: number,
          alias?: string
        ): Promise<DraftCommand> => {
          // a binary that prints help to stderr and exits non-zero is
          // ordinary, so the exit code is data here, not a failure
          const result = await ctx.exec(input.bin, [...path, "-h"])
          const help = `${result.stdout}${result.stderr}`
          const children = depth <= 0 ? [] : parseHelpSubcommands(help, [input.bin, ...path])
          return {
            name: path[path.length - 1]!,
            description,
            ...(alias === undefined ? {} : { alias }),
            flags: parseHelpFlags(help),
            positionals: parseHelpPositionals(help),
            ...(children.length === 0 ? {} : {
              commands: await Promise.all(
                children.map((child) =>
                  draftOne([...path, child], `${input.bin} ${[...path, child].join(" ")}`, depth - 1)
                )
              )
            })
          }
        }
        const drafted = await Promise.all(
          top.map(({ name, description, alias }) =>
            draftOne([name], description, input.depth, alias)
          )
        )
        const file = getPath({ to: `${getPath({ to: "<cwd>" })}/${input.out}` })
        createFile(file, declareExternal(input.bin, drafted))
        // counted through the tree: reporting only the top level called a
        // draft of `git remote` one command when it holds ten
        const tally = (commands: ReadonlyArray<DraftCommand>): {
          commands: number
          flags: number
        } =>
          commands.reduce(
            (total, command) => {
              const nested = tally(command.commands ?? [])
              return {
                commands: total.commands + 1 + nested.commands,
                flags: total.flags + command.flags.length + nested.flags
              }
            },
            { commands: 0, flags: 0 }
          )
        return { file, ...tally(drafted) }
      }
    }
  }
})
