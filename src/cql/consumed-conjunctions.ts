const CONJUNCTION_WORDS = new Set(["any", "in", "or", "all", "and"]);

const RELATIONAL_KEYS = new Set([
  "type", "part", "left", "right",
  "editor_of", "edited_by", "last_editor_of", "last_edited_by",
  "creator_of", "created_by", "updater_of", "updated_by",
  "link_to", "linked_to_by", "include", "included_by",
  "nest", "nested_by", "refer_to", "referred_to_by",
  "member_of", "member", "found_by", "not", "sort", "match",
  "name_match", "complete",
  "plus", "left_plus", "right_plus",
]);

const CLAUSE_KEYS = new Set([...RELATIONAL_KEYS, "and", "or", "all", "any"]);

export function statementAfterFirstQuery(statement: Record<string, unknown>): Record<string, unknown> {
  return consumeClause(statement) as Record<string, unknown>;
}

function consumeClause(clause: unknown): unknown {
  if (Array.isArray(clause)) return clause.map(consumeClause);
  if (clause === null || typeof clause !== "object") return clause;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(clause as Record<string, unknown>)) {
    if (!CLAUSE_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    let next = value;
    if (
      RELATIONAL_KEYS.has(key) &&
      Array.isArray(value) &&
      typeof value[0] === "string" &&
      CONJUNCTION_WORDS.has(value[0])
    ) {
      next = value.slice(1);
    }
    out[key] = consumeClause(next);
  }
  return out;
}
