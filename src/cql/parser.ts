import {
  ConditionNode,
  CqlBadQuery,
  type CqlNormalizedValue,
  Fasten,
  JoinNode,
  Mods,
  ParseOptions,
  QueryKind,
  QueryNode,
} from "./ast.js";
import {
  CARD_ACTIONS_TABLE,
  CARD_ACTS_TABLE,
  CARD_REFERENCES_TABLE,
  CARDS_TABLE,
  CONJUNCTIONS,
  MATCH_FIELD,
  MODIFIERS,
  OPERATORS,
  REFERENCE_ATTRIBUTES,
  SORT_BY_ITEM_JOIN_MAP,
  SQL_FIELD,
  TABLE_PREFIX,
} from "./constants.js";
import {
  absolutizeName,
  assertSimpleValue,
  defaultNameToKey,
  NEEDS_ABSOLUTIZE_RE,
  parseMatchTermAndPrefix,
  safeSql,
} from "./normalize.js";

const ATTRIBUTE_LISTS = {
  basic: [
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
  ],
  relational: [
    "type",
    "part",
    "left",
    "right",
    "editor_of",
    "edited_by",
    "last_editor_of",
    "last_edited_by",
    "creator_of",
    "created_by",
    "updater_of",
    "updated_by",
    "link_to",
    "linked_to_by",
    "include",
    "included_by",
    "nest",
    "nested_by",
    "refer_to",
    "referred_to_by",
    "member_of",
    "member",
    "found_by",
    "not",
    "sort",
    "match",
    "name_match",
    "complete",
  ],
  plus_relational: ["plus", "left_plus", "right_plus"],
  conjunction: ["and", "or", "all", "any"],
  custom: ["compound"],
  ignore: ["prepend", "append", "vars"],
  deprecated: ["view", "params", "size"],
} as const;

type AttributeType = keyof typeof ATTRIBUTE_LISTS;

const ATTRIBUTES: Record<string, AttributeType> = {};
(Object.entries(ATTRIBUTE_LISTS) as [AttributeType, readonly string[]][]).forEach(
  ([type, keys]) => keys.forEach((key) => (ATTRIBUTES[key] = type)),
);

const ID_LIST_KEY_RE = /^(refer|nest|include|link|member)/;

interface ParsedValue {
  op: string;
  values: Array<string | number | null>;
  nullFromScalar?: boolean;
}

type AttributeHandler = (query: QueryNode, val: unknown) => void;

export function parseCql(statement: unknown, options: ParseOptions = {}): QueryNode {
  return new CqlParser(options).parse(statement);
}

class CqlParser {
  private tableSeq = 0;
  private vars: Record<string, string | number | null | undefined>;
  private readonly nameToKey: (name: string) => string;
  private readonly onWarning?: (message: string) => void;
  private readonly parents = new WeakMap<QueryNode, QueryNode | null>();
  private rootNode: QueryNode | null = null;

  constructor(private readonly opts: ParseOptions) {
    this.vars = opts.vars ?? {};
    this.onWarning = opts.onWarning;
    this.nameToKey = opts.nameToKey ?? defaultNameToKey;
  }

  parse(statement: unknown): QueryNode {
    const root = this.newQuery("card", {}, null);
    this.rootNode = root;

    if (isPlainObject(statement)) {
      const hash = { ...statement };

      const context = takeKey(hash, "context");
      takeKey(hash, "superquery");
      const fasten = takeKey(hash, "fasten");
      if (fasten !== undefined && fasten !== null && fasten !== false) {
        if (fasten !== "join" && fasten !== "exist" && fasten !== "in" && fasten !== "direct") {
          throw new CqlBadQuery(`Invalid fasten strategy: ${String(fasten)}`);
        }
        root.fasten = fasten;
      }
      takeKey(hash, "negate");
      const vars = takeKey(hash, "vars");
      takeKey(hash, "table_suffix");
      root.context = context !== undefined ? String(context) : this.opts.context ?? "";
      if (vars !== undefined && isPlainObject(vars)) {
        this.vars = vars as Record<string, string | number | null | undefined>;
      }

      const prepend = takeKey(hash, "prepend");
      const append = takeKey(hash, "append");
      const resultNameClause = (value: unknown): CqlNormalizedValue | undefined => {
        if (value === undefined || value === null) return undefined;
        return this.normalizeValue(value, root.context);
      };
      root.statementExtras = {
        prepend: resultNameClause(prepend),
        append: resultNameClause(append),
      };

      this.interpret(root, hash);
    } else {
      root.context = this.opts.context ?? "";
      this.interpret(root, statement);
    }
    return root;
  }

  private newQuery(
    kind: QueryKind,
    args: { fasten?: Fasten; negate?: boolean; conj?: string },
    parent: QueryNode | null,
  ): QueryNode {
    const table =
      kind === "card"
        ? CARDS_TABLE
        : kind === "reference"
          ? CARD_REFERENCES_TABLE
          : kind === "action"
            ? CARD_ACTIONS_TABLE
            : CARD_ACTS_TABLE;
    const fasten = args.fasten ?? (parent ? this.inheritFasten(parent) : "join");
    const node: QueryNode = {
      kind,
      table,
      tableAlias:
        fasten === "direct" && parent ? parent.tableAlias : `${TABLE_PREFIX[table]}${this.tableSeq++}`,
      fasten,
      negate: args.negate ?? false,
      conj: args.conj ?? "and",
      context: parent ? parent.context : "",
      conditions: [],
      joins: [],
      subqueries: [],
      conditionsOnJoin: false,
      mods: {},
      statementExtras: {},
    };
    this.parents.set(node, parent);
    return node;
  }

  private inheritFasten(parent: QueryNode): Fasten {
    let node: QueryNode | null = parent;
    while (node !== null && node.fasten === "direct") node = this.parents.get(node) ?? null;
    return node === null ? "join" : node.fasten;
  }

  private interpret(query: QueryNode, clause: unknown): void {
    let hash: Record<string, unknown>;
    if (isPlainObject(clause)) {
      hash = clause;
    } else if (typeof clause === "number" && Number.isInteger(clause)) {
      hash = { id: clause };
    } else if (typeof clause === "string") {
      hash = { id: this.opts.resolveCardId?.(clause) ?? -2 };
    } else {
      throw new CqlBadQuery(`Invalid clause: ${inspect(clause)}`);
    }
    for (const [key, val] of Object.entries(hash)) {
      this.interpretItem(query, key, key === "return" ? val : this.normalizeValue(val, query.context));
    }
  }

  private normalizeValue(val: unknown, context: string): CqlNormalizedValue {
    if (typeof val === "string") return this.normalizeStringValue(val, context);
    if (Array.isArray(val)) return val.map((v) => this.normalizeValue(v, context));
    if (val === null || typeof val === "number" || typeof val === "boolean" || isPlainObject(val)) {
      return val;
    }
    throw new CqlBadQuery(`Invalid value type: ${typeof val} (${inspect(val)})`);
  }

  private normalizeStringValue(val: string, context: string): string {
    const varMatch = /^\$(\w+)$/.exec(val);
    if (varMatch) {
      const raw = this.vars[varMatch[1] ?? ""];
      return String(raw ?? "").trim();
    }
    if (NEEDS_ABSOLUTIZE_RE.test(val)) {
      return absolutizeName(val, context, this.onWarning);
    }
    return val;
  }

  private interpretItem(query: QueryNode, key: string, val: unknown): void {
    if (key in OPERATORS && !ATTRIBUTES[key]) {
      this.addCondition(query, "content", this.buildValue([key, this.normalizeValue(val, query.context)]));
      return;
    }
    if ((MODIFIERS as readonly string[]).includes(key) && !isPlainObject(val)) {
      this.interpretModifier(query, key, val);
      return;
    }
    this.interpretAttributes(query, key, val);
  }

  private interpretModifier(query: QueryNode, key: string, val: unknown): void {
    const mods: Mods = query.mods;
    const list = Array.isArray(val) ? val.map(String) : [String(val)];
    switch (key) {
      case "conj":
        query.conj = String(val);
        break;
      case "return":
        mods.return = String(val);
        break;
      case "index":
        mods.index = String(val);
        break;
      case "sort_by":
        mods.sortBy = list;
        break;
      case "sort_as":
        mods.sortAs = String(val);
        break;
      case "sort_dir":
        mods.sortDir = list;
        break;
      case "sort":
        mods.sort = list;
        break;
      case "dir":
        mods.dir = list;
        break;
      case "group":
        mods.group = String(val);
        break;
      case "limit":
        mods.limit = String(val);
        break;
      case "offset":
        mods.offset = String(val);
        break;
    }
  }

  private interpretAttributes(query: QueryNode, key: string, val: unknown): void {
    const type = ATTRIBUTES[key];
    if (!type) {
      throw new CqlBadQuery(`Invalid attribute: ${key}`);
    }
    switch (type) {
      case "basic":
        this.addCondition(query, key, this.buildValue(val));
        break;
      case "relational":
        this.relate(query, key, val);
        break;
      case "plus_relational":
        this.relateCompound(query, key, val);
        break;
      case "conjunction":
        this.conjoin(query, val, CONJUNCTIONS[key] ?? "and");
        break;
      case "custom":
        query.conditions.push({ kind: "raw", sql: `left_id IS ${val ? "NOT " : ""}NULL` });
        break;
      case "ignore":
        break;
      case "deprecated":
        this.onWarning?.(`Card queries no longer support ${key} attribute`);
        break;
    }
  }

  private buildValue(rawvalue: unknown): ParsedValue {
    if (Array.isArray(rawvalue)) {
      return this.parseArrayValue(rawvalue);
    }
    if (rawvalue === null) {
      return { op: "is", values: [null], nullFromScalar: true };
    }
    return { op: "=", values: [assertSimpleValue(rawvalue)] };
  }

  private parseArrayValue(array: unknown[]): ParsedValue {
    const rest = [...array];
    let op = "in";
    if (typeof rest[0] === "string" && rest[0] in OPERATORS) {
      op = OPERATORS[rest.shift() as string];
    }
    const values = rest.flat(Infinity).map((v) => assertSimpleValue(v));
    this.canonicalizeOperator(op);
    return { op, values };
  }

  private canonicalizeOperator(op: string): void {
    if (!Object.values(OPERATORS).includes(op)) {
      throw new CqlBadQuery(`Invalid operator: ${op}`);
    }
  }

  private addCondition(query: QueryNode, field: string, value: ParsedValue): void {
    if (value.op === "~") {
      const rawTerm = value.values.map((v) => (v === null ? "" : String(v))).join(" ");
      const { prefix, term } = parseMatchTermAndPrefix(rawTerm);
      query.conditions.push({
        kind: "match",
        cqlField: field,
        field: field in MATCH_FIELD ? MATCH_FIELD[field] : this.standardizeField(field),
        term,
        termKey: this.nameToKey(term),
        prefix,
      });
      return;
    }
    query.conditions.push({
      kind: "value",
      field: this.standardizeField(field),
      op: value.op,
      values: this.standardizeValues(field, value.op, value.values, value.nullFromScalar === true),
    });
  }

  private standardizeValues(
    field: string,
    op: string,
    values: Array<string | number | null>,
    nullFromScalar: boolean,
  ): Array<string | number | null> {
    if (field === "name" && op !== "~") {
      const wrapped = nullFromScalar ? [] : values;
      return wrapped.map((v) =>
        v === null ? null : this.nameToKey(String(v)),
      );
    }
    return values;
  }

  private standardizeField(field: string): string {
    return field in SQL_FIELD ? SQL_FIELD[field] : safeSql(field);
  }

  private relate(query: QueryNode, key: string, val: unknown, opts?: { multiple?: boolean }): void {
    const multiple = opts?.multiple ?? Array.isArray(val);
    if (multiple) {
      this.relateMultiValue(query, key, val as unknown[]);
    } else {
      this.relationalHandler(key)(query, val);
    }
  }

  private relateCompound(query: QueryNode, key: string, val: unknown): void {
    const hasMultipleValues =
      Array.isArray(val) &&
      (Array.isArray(val[0]) || (typeof val[0] === "string" && val[0] in CONJUNCTIONS));
    this.relate(query, key, val, { multiple: hasMultipleValues });
  }

  private relateMultiValue(query: QueryNode, key: string, val: unknown[]): void {
    const items = [...val];
    let conj = "and";
    if (typeof items[0] === "string" && items[0] in CONJUNCTIONS) {
      conj = CONJUNCTIONS[items.shift() as string];
    }
    if (this.asListOfIds(conj, key, items)) {
      this.relate(query, key, items, { multiple: false });
    } else if (conj === query.conj) {
      for (const item of items) this.relationalHandler(key)(query, item);
    } else {
      this.conjoin(query, items.map((item) => ({ [key]: item })), conj);
    }
  }

  private asListOfIds(conj: string, key: string, val: unknown[]): boolean {
    return conj === "or" && ID_LIST_KEY_RE.test(key) && this.listOfIds(val);
  }

  private listOfIds(val: unknown[]): boolean {
    return val.every((v) => this.idFromVal(v) !== null);
  }

  private idFromVal(val: unknown): number | null {
    if (typeof val === "number" && Number.isInteger(val)) return val;
    if (typeof val === "string") return this.opts.resolveCardId?.(val) ?? -999;
    return null;
  }

  private relationalHandler(key: string): AttributeHandler {
    const handler = this.relationalHandlers[key];
    if (!handler) {
      throw new CqlBadQuery(`Invalid attribute: ${key}`);
    }
    return handler;
  }

  private readonly relationalHandlers: Record<string, AttributeHandler> = {
    type: (q, val) => this.restrict(q, "type_id", val),
    left: (q, val) => this.restrict(q, "left_id", val),
    right: (q, val) => this.restrict(q, "right_id", val),
    last_edited_by: (q, val) => this.restrict(q, "updater_id", val),
    created_by: (q, val) => this.restrict(q, "creator_id", val),

    part: (q, val) => {
      this.relationalHandlers.any(q, { left: val, right: val });
    },

    editor_of: (q, val) => this.tieAct(q, "action_on", val),
    updater_of: (q, val) => this.tieAct(q, "update_action_on", val),
    edited_by: (q, val) => this.tieAction(q, "action_by", val),
    updated_by: (q, val) => this.tieAction(q, "update_action_by", val),
    last_editor_of: (q, val) => this.tie(q, "card", val, { to: "updater_id" }),
    creator_of: (q, val) => this.tie(q, "card", val, { to: "creator_id" }),

    left_plus: (q, val) => this.junction(q, val, "left", "right_id"),
    right_plus: (q, val) => this.junction(q, val, "right", "left_id"),
    plus: (q, val) => {
      this.relationalHandlers.any(q, { left_plus: val, right_plus: val });
    },

    all: (q, val) => this.conjoin(q, val, "and"),
    and: (q, val) => this.conjoin(q, val, "and"),
    any: (q, val) => this.conjoin(q, val, "or"),
    or: (q, val) => this.conjoin(q, val, "or"),

    not: (q, val) => {
      this.tie(q, "card", val, { from: "id", to: "id" }, { negate: true });
    },

    match: (q, val) => this.matchAttribute(q, val),
    complete: (q, val) => this.completeAttribute(q, val),
    name_match: (q, val) => this.nameMatchAttribute(q, val),

    ...Object.fromEntries(
      Object.entries(REFERENCE_ATTRIBUTES).map(([name, spec]) => [
        name,
        (query: QueryNode, val: unknown) => {
          this.tie(
            query,
            "reference",
            { [spec.refMethod]: { reftype: spec.reftypes, card: val } },
            { to: spec.refField },
          );
        },
      ]),
    ),

    member_of: (q, val) => {
      this.interpret(q, { referred_to_by: { left: val, right: { codename: "members" } } });
    },
    member: (q, val) => {
      const roleId = this.opts.resolveCodename?.("role");
      if (roleId === undefined || roleId === null) {
        throw new CqlBadQuery(
          "member requires codename resolution (Card::RoleID); provide ParseOptions.resolveCodename (deferred)",
        );
      }
      this.interpret(q, {
        type_id: roleId,
        right_plus: [{ codename: "members" }, { refer_to: val }],
      });
    },

    found_by: (q, val) => {
      q.conditions.push({ kind: "foundBy", value: val });
    },

    sort: (q, val) => this.sortAttribute(q, val),
  };

  private restrict(query: QueryNode, idField: string, val: unknown): void {
    const id = this.idFromVal(val);
    if (id !== null) {
      this.addCondition(query, idField, { op: "=", values: [id] });
    } else {
      this.tie(query, "card", val, { from: idField });
    }
  }

  private tieAct(query: QueryNode, action: string, val: unknown): void {
    this.tie(query, "act", { [action]: val }, { to: "actor_id" });
  }

  private tieAction(query: QueryNode, action: string, val: unknown): void {
    this.tie(query, "action", { [action]: val }, { to: "card_id" });
  }

  private junction(query: QueryNode, val: unknown, side: string, field: string): void {
    const [partClause, junctionClause] = Array.isArray(val) ? [val[0], val[1] ?? {}] : [val, {}];
    const merged = {
      ...this.interpretToHash(junctionClause, query.context),
      [side]: partClause,
    };
    this.tie(query, "card", merged, { to: field });
  }

  private conjoin(query: QueryNode, val: unknown, conj: string): void {
    const sub = this.newQuery("card", { fasten: "direct", conj }, query);
    query.subqueries.push(sub);
    const items = Array.isArray(val)
      ? val
      : Object.entries(this.interpretToHash(val, query.context)).map(([k, v]) => ({ [k]: v }));
    for (const item of items) {
      this.interpret(sub, item);
    }
  }

  private tie(
    query: QueryNode,
    kind: QueryKind,
    val: unknown,
    fields: { from?: string; to?: string },
    args: { fasten?: Fasten; negate?: boolean } = {},
  ): QueryNode {
    const sub = this.newQuery(kind, args, query);
    query.subqueries.push(sub);
    this.interpretSubqueryClause(sub, val);
    const mergedFields = { from: "id", to: "id", ...fields };

    switch (sub.fasten) {
      case "join": {
        const side: "LEFT" | undefined = query.conj === "or" || sub.negate ? "LEFT" : undefined;
        const join: JoinNode = {
          side,
          fromAlias: query.tableAlias,
          fromField: mergedFields.from,
          toTable: sub.table,
          toAlias: sub.tableAlias,
          toField: mergedFields.to,
          to: sub,
        };
        if (sub.negate) {
          sub.conditionsOnJoin = true;
          query.conditions.push({
            kind: "raw",
            sql: `${sub.tableAlias}.${mergedFields.to} is null`,
          });
        }
        query.joins.push(join);
        break;
      }
      case "in":
        sub.mods.return = mergedFields.to;
        sub.mods.inField = `${query.tableAlias}.${mergedFields.from}`;
        break;
      case "exist":
        sub.conditions.push({
          kind: "raw", sql: `${sub.tableAlias}.${mergedFields.to} = ${query.tableAlias}.${mergedFields.from}`,
        });
        break;
      case "direct":
        break;
    }
    return sub;
  }

  private interpretSubqueryClause(query: QueryNode, clause: unknown): void {
    if (query.kind === "card") {
      this.interpret(query, clause);
      return;
    }
    const hash = isPlainObject(clause) ? clause : {};
    for (const [key, val] of Object.entries(hash)) {
      if (query.kind === "reference") {
        this.interpretReferenceKey(query, key, val);
      } else if (query.kind === "action") {
        this.interpretActionKey(query, key, val);
      } else {
        this.interpretActKey(query, key, val);
      }
    }
  }

  private interpretReferenceKey(query: QueryNode, key: string, val: unknown): void {
    const outfield = key === "referer" ? "referer_id" : key === "referee" ? "referee_id" : null;
    if (!outfield || !isPlainObject(val)) {
      throw new CqlBadQuery(`Invalid attribute: ${key}`);
    }
    const reftype = val["reftype"];
    const card = val["card"];
    if (reftype !== undefined && reftype !== null && reftype !== "") {
      const letters = (Array.isArray(reftype) ? reftype : [reftype]).map(String);
      query.conditions.push({
        kind: "value",
        field: "ref_type",
        op: letters.length === 1 ? "=" : "IN",
        values: letters,
      });
    }
    this.addOutfieldCondition(query, outfield, card);
  }

  private addOutfieldCondition(query: QueryNode, outfield: string, outcard: unknown): void {
    const idOp = this.opAndIdOrIdsFromVal(outcard);
    if (outcard === "_none") {
      query.conditions.push({ kind: "value", field: "is_present", op: "=", values: [0] });
    } else if (idOp) {
      query.conditions.push({ kind: "value", field: outfield, op: idOp.op, values: idOp.ids });
    } else {
      this.tie(query, "card", outcard, { from: outfield });
    }
  }

  private opAndIdOrIdsFromVal(val: unknown): { op: string; ids: number[] } | null {
    const single = this.idFromVal(val);
    if (single !== null) return { op: "=", ids: [single] };
    if (Array.isArray(val) && this.listOfIds(val)) {
      return { op: "in", ids: val.map((v) => this.idFromVal(v) as number) };
    }
    return null;
  }

  private interpretActionKey(query: QueryNode, key: string, val: unknown): void {
    switch (key) {
      case "action_by":
        this.tie(query, "act", { act_by: val }, { from: "card_act_id" });
        break;
      case "update_action_by":
        this.addUpdateCondition(query);
        this.tie(query, "act", { act_by: val }, { from: "card_act_id" });
        break;
      case "action_on":
        this.tie(query, "card", val, { from: "card_id" });
        break;
      case "update_action_on":
        this.addUpdateCondition(query);
        this.tie(query, "card", val, { from: "card_id" });
        break;
      default:
        throw new CqlBadQuery(`Invalid attribute: ${key}`);
    }
  }

  private addUpdateCondition(query: QueryNode): void {
    query.conditions.push({ kind: "raw", sql: `${query.tableAlias}.action_type = 1` });
  }

  private interpretActKey(query: QueryNode, key: string, val: unknown): void {
    switch (key) {
      case "action_on":
        this.tie(query, "action", { action_on: val }, { to: "card_act_id" });
        break;
      case "update_action_on":
        this.tie(query, "action", { update_action_on: val }, { to: "card_act_id" });
        break;
      case "act_by":
        this.tie(query, "card", val, { from: "actor_id" });
        break;
      default:
        throw new CqlBadQuery(`Invalid attribute: ${key}`);
    }
  }

  private matchAttribute(query: QueryNode, val: unknown): void {
    if (val === null || val === undefined || val === "" || val === false) return;
    const conditions: ConditionNode[] = (["name", "content"] as const).map((field) => {
      const parsed = this.buildValue(["match", val]);
      const rawTerm = parsed.values.map((v) => (v === null ? "" : String(v))).join(" ");
      const { prefix, term } = parseMatchTermAndPrefix(rawTerm);
      return {
        kind: "match" as const,
        cqlField: field,
        field: MATCH_FIELD[field],
        term,
        termKey: this.nameToKey(term),
        prefix,
      };
    });
    query.conditions.push({ kind: "group", conj: "or", conditions });
  }

  private nameMatchAttribute(query: QueryNode, val: unknown): void {
    if (val !== null && val !== undefined && val !== "" && val !== false) {
      this.addCondition(query, "name", this.buildValue(["match", val]));
    }
    this.nameNotNull(query);
  }

  private completeAttribute(query: QueryNode, val: unknown): void {
    const name = String(val);
    if (name.includes("+")) {
      const parts = name.split("+");
      const left = parts.slice(0, -1).join("+");
      const right = parts.at(-1) ?? "";
      this.interpret(query, { left });
      if (right !== "") {
        this.interpret(query, { right: { complete: right } });
      }
      return;
    }
    if (name !== "") {
      query.conditions.push({ kind: "like", field: "key", value: this.nameToKey(name) });
    }
    this.nameNotNull(query);
  }

  private nameNotNull(query: QueryNode): void {
    query.conditions.push({ kind: "raw", sql: `${query.tableAlias}.key IS NOT NULL` });
  }

  private isFull(query: QueryNode): boolean {
    return this.rootNode === query && query.mods.return !== "count";
  }

  private sortAttribute(query: QueryNode, val: unknown): void {
    if (!this.isFull(query)) return;
    if (!isPlainObject(val)) {
      throw new CqlBadQuery(`Invalid clause: ${inspect(val)}`);
    }
    const spec = { ...val };
    const item = spec["item"] !== undefined ? String(spec["item"]) : "left";
    const sortField = spec["return"] !== undefined ? String(spec["return"]) : "db_content";
    delete spec["item"];
    delete spec["return"];

    if (sortField === "count") {
      if (item !== "referred_to") {
        throw new CqlBadQuery(`sorting by #count/${item} not yet implemented`);
      }
      const sub = this.newQuery("card", {}, query);
      this.interpret(sub, spec);
      sub.mods.return = "id";
      query.mods.sortBy = ["coalesce(count,0)"];
      query.joins.push({
        side: "LEFT",
        fromAlias: query.tableAlias,
        fromField: "id",
        toTable: CARD_REFERENCES_TABLE,
        toAlias: "srtbl",
        toField: "sort_join_field",
        countSortSubquery: sub,
      });
      return;
    }
    const joinField = SORT_BY_ITEM_JOIN_MAP[item];
    if (!joinField) {
      throw new CqlBadQuery(`sorting by #join/${item} not yet implemented`);
    }
    const sub = this.newQuery("card", {}, query);
    query.subqueries.push(sub);
    const join: JoinNode = {
      side: "LEFT",
      fromAlias: query.tableAlias,
      fromField: "id",
      toTable: CARDS_TABLE,
      toAlias: sub.tableAlias,
      toField: joinField,
      to: sub,
    };
    query.joins.push(join);
    sub.conditionsOnJoin = true;
    this.interpret(sub, spec);
    if (!query.mods.sortBy) {
      query.mods.sortBy = [`${sub.tableAlias}.${sortField}`];
    }
  }

  private interpretToHash(clause: unknown, context: string): Record<string, unknown> {
    if (isPlainObject(clause)) {
      const normalized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(clause)) {
        normalized[key] = key === "return" ? val : this.normalizeValue(val, context);
      }
      return normalized;
    }
    if (typeof clause === "number" && Number.isInteger(clause)) return { id: clause };
    if (typeof clause === "string") return { id: this.opts.resolveCardId?.(clause) ?? -2 };
    throw new CqlBadQuery(`Invalid clause: ${inspect(clause)}`);
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function takeKey(hash: Record<string, unknown>, key: string): unknown {
  const val = hash[key];
  delete hash[key];
  return val;
}

function inspect(val: unknown): string {
  try {
    return JSON.stringify(val) ?? String(val);
  } catch {
    return String(val);
  }
}
