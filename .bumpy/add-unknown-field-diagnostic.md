---
cmd-mesh: minor
---

An incorrect parameter or command field is now a declaration error (`CMSH1013`). Before, it had no effect and gave no message. TypeScript does not find all of these fields: it does not report a field whose type is a union with a primitive, which is the type of a parameter. Thus `cli: { complete: "filepaths" }` and `sugest: "folders"` both compiled without an error. A JavaScript caller has no check. The interpreter now gives the name of the unknown field and the names of the correct fields. The command case is more important: `mcp: { hiden: true }` kept a command visible to agents. An unknown `suggest` source is also an error now (`CMSH1014`); before, it gave no candidates and no message.
