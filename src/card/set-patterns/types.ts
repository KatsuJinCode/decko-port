import type { Nameish } from "../name.js";

export interface PatternCardInput {
  name: Nameish;

  id?: number | null;

  isNew?: boolean;

  typeId?: number | null;

  typeName?: Nameish | null;

  leftTypeName?: Nameish | null;

  isRule?: boolean;
}

export interface PrototypeArgs {
  name?: string;

  type?: string;

  supercard?: {
    name: string;
    type?: string;
  };
}
