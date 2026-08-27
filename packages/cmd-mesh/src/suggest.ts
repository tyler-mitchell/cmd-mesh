import { Array, Option, Order, pipe } from "effect"

// "did you mean" support for unknown flags and commands.

const editDistance = (a: string, b: string): number => {
  const bChars = Array.fromIterable(b)
  const finalRow = pipe(
    Array.fromIterable(a),
    Array.reduce(
      Array.makeBy(bChars.length + 1, (i) => i) as ReadonlyArray<number>,
      (row, aChar, i) =>
        Array.reduce(bChars, [i + 1] as ReadonlyArray<number>, (acc, bChar, j) =>
          Array.append(
            acc,
            Math.min(
              (row[j] ?? 0) + (aChar === bChar ? 0 : 1),
              (row[j + 1] ?? 0) + 1,
              (acc[j] ?? 0) + 1
            )
          ))
    )
  )
  return Option.getOrElse(Array.last(finalRow), () => 0)
}

/** the closest candidates worth suggesting for a mistyped token */
export const nearest = (
  input: string,
  candidates: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const tolerance = Math.max(2, Math.floor(input.length / 3))
  return pipe(
    candidates,
    Array.map((candidate) => ({ candidate, distance: editDistance(input, candidate) })),
    Array.filter(({ distance }) => distance <= tolerance),
    Array.sortWith((entry) => entry.distance, Order.Number),
    Array.take(2),
    Array.map(({ candidate }) => candidate)
  )
}

export const didYouMean = (near: ReadonlyArray<string>): string =>
  near.length === 0 ? "" : ` — did you mean ${Array.join(near, " or ")}?`
