export type CqlScalar = string | number | boolean | null;

export type CqlNormalizedValue = CqlScalar | CqlNormalizedValue[] | Record<string, unknown>;

export type ConditionNode =
  | {
      kind: "value";
      field: string;
      op: string;
      values: Array<string | number | null>;
    }
  | {
      kind: "match";
      cqlField: string;
      field: string;
      term: string;
      termKey: string;
      prefix: string;
    }
  | { kind: "like"; field: string; value: string }
  | { kind: "raw"; sql: string }
  | { kind: "group"; conj: "and" | "or"; conditions: ConditionNode[] }
  | { kind: "foundBy"; value: unknown };

export interface JoinNode {
  side?: "LEFT";
  fromAlias: string;
  fromField: string;
  toTable: string;
  toAlias: string;
  toField: string;
  to?: QueryNode;
  countSortSubquery?: QueryNode;
}

export interface Mods {
  return?: string;
  limit?: string;
  offset?: string;
  group?: string;
  index?: string;
  sort?: string[];
  sortBy?: string[];
  sortAs?: string;
  sortDir?: string[];
  dir?: string[];
  inField?: string;
}

export type QueryKind = "card" | "reference" | "action" | "act";

export type Fasten = "join" | "direct" | "exist" | "in";

export interface QueryNode {
  kind: QueryKind;
  table: string;
  tableAlias: string;
  fasten: Fasten;
  negate: boolean;
  conj: string;
  context: string;
  conditions: ConditionNode[];
  joins: JoinNode[];
  subqueries: QueryNode[];
  conditionsOnJoin: boolean;
  mods: Mods;
  statementExtras: { prepend?: CqlNormalizedValue; append?: CqlNormalizedValue };
}

export interface ParseOptions {
  vars?: Record<string, string | number | null | undefined>;
  context?: string;
  resolveCardId?: (name: string) => number | undefined | null;
  ensureCardId?: (name: string) => Promise<number | undefined>;
  resolveCodename?: (codename: string) => number | undefined | null;
  nameToKey?: (name: string) => string;
  onWarning?: (message: string) => void;
}

export class CqlBadQuery extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CqlBadQuery";
  }
}
