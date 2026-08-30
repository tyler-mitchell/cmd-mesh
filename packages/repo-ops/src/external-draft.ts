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
import type { DraftCommand } from "./help-parse.js"

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
          "string.integer.parse",
          "@",
          {
            description: "how many levels of subcommands to follow",
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
      run: async (input, ctx) => {
        // named commands win; otherwise ask the binary what it has
        const top = input.commands.length > 0
          ? input.commands.map((name) => ({ name, description: `${input.bin} ${name}` }))
          : parseHelpCommands(
            await ctx.exec(input.bin, ["--help"]).then((r) => `${r.stdout}${r.stderr}`)
          )
        // a group like `git remote` names its children only in its own
        // usage block, and each child answers `-h` for itself
        const draftOne = async (
          path: ReadonlyArray<string>,
          description: string,
          depth: number
        ): Promise<DraftCommand> => {
          // a binary that prints help to stderr and exits non-zero is
          // ordinary, so the exit code is data here, not a failure
          const result = await ctx.exec(input.bin, [...path, "-h"])
          const help = `${result.stdout}${result.stderr}`
          const children = depth <= 0 ? [] : parseHelpSubcommands(help, [input.bin, ...path])
          return {
            name: path[path.length - 1]!,
            description,
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
          top.map(({ name, description }) => draftOne([name], description, input.depth))
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
