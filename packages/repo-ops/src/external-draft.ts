// cmd-mesh re-exports package-management's file and path utilities, so a
// consumer needs one dependency, not two
import { createFile, getPath, program } from "cmd-mesh"
import {
  declareExternal,
  parseHelpCommands,
  parseHelpFlags,
  parseHelpPositionals
} from "./help-parse.js"

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
        const drafted = await Promise.all(
          top.map(async ({ name, description }) => {
            // a binary that prints help to stderr and exits non-zero is
            // ordinary, so the exit code is data here, not a failure
            const result = await ctx.exec(input.bin, [name, "-h"])
            const help = `${result.stdout}${result.stderr}`
            return {
              name,
              description,
              flags: parseHelpFlags(help),
              positionals: parseHelpPositionals(help)
            }
          })
        )
        const file = getPath({ to: `${getPath({ to: "<cwd>" })}/${input.out}` })
        createFile(file, declareExternal(input.bin, drafted))
        return {
          file,
          commands: drafted.length,
          flags: drafted.reduce((total, command) => total + command.flags.length, 0)
        }
      }
    }
  }
})
