export const CARDS_TABLE = "cards";
export const CARD_REFERENCES_TABLE = "card_references";
export const CARD_ACTIONS_TABLE = "card_actions";
export const CARD_ACTS_TABLE = "card_acts";

export const TABLE_PREFIX: Record<string, string> = {
  cards: "c",
  card_references: "cr",
  card_actions: "cn",
  card_acts: "cx",
};

export const BASIC_FIELDS = [
  "id",
  "name",
  "key",
  "type_id",
  "content",
  "left_id",
  "right_id",
  "codename",
  "read_rule_id",
  "created_at",
  "updated_at",
  "creator_id",
  "updater_id",
] as const;

export type BasicField = (typeof BASIC_FIELDS)[number];

export const SQL_FIELD: Record<string, string> = {
  name: "key",
  content: "db_content",
};

export const REFERENCE_FIELDS = ["referer_id", "referee_id", "ref_type", "is_present"] as const;

export const OPERATORS: Record<string, string> = {
  "!=": "!=",
  "=": "=",
  "=~": "=~",
  "<": "<",
  ">": ">",
  in: "in",
  "~": "~",
  is: "is",
  eq: "=",
  gt: ">",
  lt: "<",
  match: "~",
  ne: "!=",
  "not in": "not in",
  "is not": "is not",
  "!": "is not",
};

export const LIST_OPS = new Set(["in", "not in", "IN", "NOT IN"]);

export const CONJUNCTIONS: Record<string, "or" | "and"> = {
  any: "or",
  in: "or",
  or: "or",
  all: "and",
  and: "and",
};

export const MODIFIERS = [
  "conj",
  "return",
  "index",
  "sort_by",
  "sort_as",
  "sort_dir",
  "sort",
  "dir",
  "group",
  "limit",
  "offset",
] as const;

export type Modifier = (typeof MODIFIERS)[number];

export const IGNORED_KEYS = ["prepend", "append", "vars"] as const;
export const DEPRECATED_KEYS = ["view", "params", "size"] as const;

export const ORDER_MAP: Record<string, string> = {
  id: "id",
  update: "updated_at",
  create: "created_at",
  name: "key",
  content: "db_content",
  alpha: "key",
  relevance: "updated_at",
};

export const DEFAULT_ORDER_DIRS: Record<string, string> = {
  update: "desc",
  relevance: "desc",
};

export const SORT_BY_ITEM_JOIN_MAP: Record<string, string> = {
  left: "left_id",
  right: "right_id",
};

export const REFERENCE_ATTRIBUTES: Record<
  string,
  { reftypes: string[]; refMethod: "referee" | "referer"; refField: "referer_id" | "referee_id" }
> = {
  refer_to: { reftypes: ["L", "I"], refMethod: "referee", refField: "referer_id" },
  link_to: { reftypes: ["L"], refMethod: "referee", refField: "referer_id" },
  include: { reftypes: ["I"], refMethod: "referee", refField: "referer_id" },
  nest: { reftypes: ["I"], refMethod: "referee", refField: "referer_id" },
  referred_to_by: { reftypes: ["L", "I"], refMethod: "referer", refField: "referee_id" },
  linked_to_by: { reftypes: ["L"], refMethod: "referer", refField: "referee_id" },
  included_by: { reftypes: ["I"], refMethod: "referer", refField: "referee_id" },
  nested_by: { reftypes: ["I"], refMethod: "referer", refField: "referee_id" },
};

export const SAFE_SQL_RE = /[^\w\s*().,]/;

export const MATCH_FIELD: Record<string, string> = {
  name: "name",
  content: "db_content",
};
