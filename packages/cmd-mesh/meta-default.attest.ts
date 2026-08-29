// type-level proof for patches/arktype.patch: a `default` in metadata
// must make the key optional on the INPUT side and present on the OUTPUT
// side, exactly as the `"="` operator does. Without the .d.ts half of the
// patch the two forms disagree and the runtime default becomes a lie.
import { attest, setup, teardown } from "@ark/attest"
import { type } from "arktype"

setup({ shouldFormat: false, tsconfig: "./tsconfig.attest.json" })

try {
  const meta = type({ port: ["number", "@", { default: 3000 }], name: "string" })
  const operator = type({ port: ["number", "=", 3000], name: "string" })

  // the input side: `port` omittable in BOTH forms
  attest(meta.inferIn).type.toString.snap("{ name: string; port?: number }")
  attest(operator.inferIn).type.toString.snap("{ name: string; port?: number }")

  // the output side: `port` present in BOTH forms
  attest(meta.infer).type.toString.snap("{ port: number; name: string }")
  attest(operator.infer).type.toString.snap("{ port: number; name: string }")

  // a caller may omit the defaulted key — the whole point
  attest(meta.from({ name: "ada" })).type.toString.snap("{ port: number; name: string }")

  // and through a morph, where the default is an input-domain value
  const morphing = type({ n: ["string.integer.parse", "@", { default: "7" }] })
  attest(morphing.inferIn).type.toString.snap("{ n?: string }")
  attest(morphing.infer).type.toString.snap("{ n: number }")

  // metadata WITHOUT a default still leaves the key required
  const plain = type({ port: ["number", "@", { description: "the port" }] })
  attest(plain.inferIn).type.toString.snap("{ port: number }")
} finally {
  teardown()
}
