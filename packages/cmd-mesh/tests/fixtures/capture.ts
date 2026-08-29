// stdout/stderr capture for the cli projection.
//
// `main()` renders through Effect's Console service, which writes to the
// global console. Pressure tests assert on what a user would actually see
// in their terminal, so they need the text, not just the exit code.

export interface Capture {
  readonly code: number
  readonly out: string
  readonly err: string
}

/** run a cli invocation, returning its exit code alongside what it printed */
export const captureCli = async (run: () => Promise<number>): Promise<Capture> => {
  const out: Array<string> = []
  const err: Array<string> = []
  const log = console.log
  const error = console.error
  console.log = (...args: Array<unknown>) => {
    out.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "))
  }
  console.error = (...args: Array<unknown>) => {
    err.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "))
  }
  try {
    const code = await run()
    return { code, out: out.join("\n"), err: err.join("\n") }
  } finally {
    console.log = log
    console.error = error
  }
}

/** the parsed JSON a `--json` invocation printed. an unparsable answer
 * reports the whole capture — the exit code and stderr are the diagnosis */
export const captureJson = async (run: () => Promise<number>): Promise<unknown> => {
  const { code, out, err } = await captureCli(run)
  try {
    return JSON.parse(out)
  } catch {
    throw new Error(`expected JSON on stdout (exit ${code})\nstdout: ${out}\nstderr: ${err}`)
  }
}
