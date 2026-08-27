// the release probe: one real cmd-mesh operation from a clean consumer
// where the exact published version is installed. plain node, no build.
import { program } from "cmd-mesh";

const probe = program({
  name: "probe",
  commands: {
    greet: {
      description: "greet someone",
      input: {
        who: { type: "string", cli: "<who>" },
        times: { type: "string.integer.parse = '1'" },
      },
      output: { message: "string", times: "number" },
      run: (input) => ({ message: `hello ${input.who}`, times: input.times }),
    },
  },
});

const result = await probe.greet({ who: "release" });
if (result.message !== "hello release" || result.times !== 1) {
  throw new Error(`direct invocation returned ${JSON.stringify(result)}`);
}

const [tool] = probe.mcp.tools;
if (tool?.name !== "probe_greet") {
  throw new Error(`mcp projection missing probe_greet: ${JSON.stringify(probe.mcp.tools)}`);
}
if (tool.inputSchema?.properties?.times?.default !== 1) {
  throw new Error(`mcp schema lost the morphed default: ${JSON.stringify(tool.inputSchema)}`);
}

const exit = await probe.main(["greet", "release", "--times", "3"]);
if (exit !== 0) throw new Error(`cli projection exited ${exit}`);

await probe.dispose();
console.log("cmd-mesh probe: direct call, mcp projection, and cli all verified.");
