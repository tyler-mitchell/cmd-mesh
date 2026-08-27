import type { AnyCommandSpec } from "./command.js";
import type { Presentation } from "./shared.js";

export interface ProgramDefinition<Root extends AnyCommandSpec>
  extends Presentation {
  readonly root: Root;
  readonly version?: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

declare const programBrand: unique symbol;

export type ProgramSpec<Root extends AnyCommandSpec> = Readonly<
  ProgramDefinition<Root> & {
    readonly specificationVersion: 1;
    readonly [programBrand]: Root;
  }
>;

export const program = <const Root extends AnyCommandSpec>(
  definition: ProgramDefinition<Root>,
): ProgramSpec<Root> =>
  ({ ...definition, specificationVersion: 1 }) as ProgramSpec<Root>;
