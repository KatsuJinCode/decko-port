import type { FetchEngine } from "../fetch.js";
import type { CardsRow } from "../../server/schema.js";
import { DeckoName } from "../name.js";
import { executeQuery, parseOptionsWithLexicon } from "../../cql/execute.js";
import { findRule } from "../rules/lookup.js";
import { ruleWalkPatternInput } from "../actions/rule-content-walk.js";
import { dumpYaml, loadYaml, sym, YamlMap, YamlSymbol, type YamlValue } from "./pod-yaml.js";
import { existsSync, readFileSync } from "node:fs";
import { listItemStrings } from "../actions/list-content.js";
import { resolveTypeId } from "../actions/type-resolution.js";

export interface SowOptions {
  cql?: Record<string, unknown>;
  names?: string[];
  fieldTags?: string[];
  items?: "only" | true;
  url?: string;
  remote?: string;
  mergeInto?: string;
  readUrl?: (url: string) => Promise<string>;
}

export class SowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SowError";
  }
}

export async function sowItems(fetch: FetchEngine, opts: SowOptions): Promise<YamlValue[]> {
  const source = remoteSource(opts);
  if (source !== undefined) return podFromUrl(source, opts);
  if (opts.names !== undefined && opts.names.length > 0 && opts.items !== undefined) {
    return itemPods(fetch, opts);
  }
  const rows = await selectRows(fetch, opts);
  const tags = await fieldTagMarks(fetch, opts.fieldTags ?? []);
  const out: YamlMap[] = [];
  const firstByKey = new Map<string, CardsRow>();
  for (const row of rows) out.push(await podHash(fetch, await asRubyFetches(fetch, row, firstByKey), tags));
  return out;
}

async function asRubyFetches(
  fetch: FetchEngine,
  row: CardsRow,
  firstByKey: Map<string, CardsRow>,
): Promise<CardsRow> {
  const name = (await fetch.fetchById(Number(row.id)))?.name;
  if (name === undefined) return row;
  const first = firstByKey.get(name.key);
  if (first !== undefined) return first;
  firstByKey.set(name.key, row);
  return row;
}

export async function sowYaml(fetch: FetchEngine, opts: SowOptions): Promise<string> {
  const items = await sowItems(fetch, opts);
  if (opts.mergeInto !== undefined && existsSync(opts.mergeInto)) {
    return dumpYaml(await mergeData(fetch, loadYaml(readFileSync(opts.mergeInto, "utf8")), items));
  }
  return dumpYaml(items);
}

function remoteSource(opts: SowOptions): string | undefined {
  if (opts.remote !== undefined) {
    const name = opts.names?.join(",");
    if (name === undefined || name === "") throw new SowError("must specify name (-n)");
    return new URL(`/${DeckoName.parse(name).urlKey}/pod.yml`, opts.remote).toString();
  }
  return opts.url;
}

async function podFromUrl(source: string, opts: SowOptions): Promise<YamlValue[]> {
  let text: string;
  if (/^https?:/i.test(source)) {
    const read = opts.readUrl ?? (async (u: string) => {
      const res = await fetchUrl(u);
      if (!res.ok) throw new SowError(`${u} not available\n${res.status}`);
      return res.text();
    });
    text = await read(source);
  } else {
    text = readFileSync(source, "utf8");
  }
  let doc: YamlValue;
  try {
    doc = loadYaml(text);
  } catch {
    throw new SowError(`Url ${source} provided invalid yaml`);
  }
  return Array.isArray(doc) ? doc : doc === null ? [] : [doc];
}

const fetchUrl = (url: string): Promise<Response> => globalThis.fetch(url);

async function itemPods(fetch: FetchEngine, opts: SowOptions): Promise<YamlValue[]> {
  const rows = await selectRows(fetch, { names: opts.names });
  const tags = await fieldTagMarks(fetch, opts.fieldTags ?? []);
  const out: YamlValue[] = [];
  if (opts.items === true) for (const row of rows) out.push(await podHash(fetch, row, tags));
  for (const row of rows) {
    const owner = (await fetch.fetchById(Number(row.id)))?.name;
    if (owner === undefined) continue;
    for (const item of listItemStrings(row.db_content)) {
      let itemName: DeckoName;
      try {
        itemName = DeckoName.parse(item).absoluteName(owner);
      } catch {
        continue;
      }
      const record = await fetch.fetchByName(itemName.s);
      if (record !== undefined && record.id !== undefined && !record.trash) {
        out.push(await podHash(fetch, await rowOf(fetch, record.id), tags));
      } else {
        out.push(await newCardPodHash(fetch, itemName));
      }
    }
  }
  return out;
}

async function newCardPodHash(fetch: FetchEngine, name: DeckoName): Promise<YamlMap> {
  const typeId = await resolveTypeId(fetch, { name: name.s });
  const entries: [YamlValue, YamlValue][] = [
    [sym("name"), await podName(fetch, name)],
    [sym("type"), await podType(fetch, { type_id: typeId } as CardsRow)],
  ];
  return new YamlMap(entries.filter(([, v]) => !blank(v)));
}

async function mergeData(fetch: FetchEngine, oldDoc: YamlValue, items: YamlValue[]): Promise<YamlValue[]> {
  const target: YamlValue[] = Array.isArray(oldDoc) ? [...oldDoc] : oldDoc === null ? [] : [oldDoc];
  for (const item of items) {
    if (!(item instanceof YamlMap)) {
      target.push(item);
      continue;
    }
    const code = item.get(sym("codename"));
    const key = await podNameKey(fetch, item.get(sym("name")));
    let index = -1;
    for (let i = 0; i < target.length && index < 0; i++) {
      const t = target[i];
      if (!(t instanceof YamlMap)) continue;
      const sameCode = !blank(code) && yamlEqual(code, t.get(sym("codename")));
      if (sameCode || (await podNameKey(fetch, t.get(sym("name")))) === key) index = i;
    }
    if (index >= 0) target[index] = item;
    else target.push(item);
  }
  return target;
}

function yamlEqual(a: YamlValue | undefined, b: YamlValue | undefined): boolean {
  if (a instanceof YamlSymbol && b instanceof YamlSymbol) return a.name === b.name;
  return a === b;
}

async function podNameKey(fetch: FetchEngine, v: YamlValue | undefined): Promise<string> {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const p of v) parts.push(p instanceof YamlSymbol ? ((await codenameName(fetch, p.name)) ?? `:${p.name}`) : String(p));
    return DeckoName.parse(parts.join("+")).key;
  }
  if (v instanceof YamlSymbol) return DeckoName.parse((await codenameName(fetch, v.name)) ?? `:${v.name}`).key;
  return DeckoName.parse(String(v)).key;
}

async function selectRows(fetch: FetchEngine, opts: SowOptions): Promise<CardsRow[]> {
  if (opts.names !== undefined && opts.names.length > 0) {
    const rows: CardsRow[] = [];
    for (const raw of opts.names) {
      const name = raw.trim();
      const record = await fetch.fetchByName(name);
      if (record === undefined || record.id === undefined) throw new SowError(`card not found: ${name}`);
      rows.push(await rowOf(fetch, record.id));
    }
    return rows;
  }
  if (opts.cql !== undefined) {
    const statement = { limit: 0, ...opts.cql };
    const result = await executeQuery(fetch.driver, statement, { parse: parseOptionsWithLexicon(fetch.lexicon) });
    if (!("rows" in result)) throw new SowError("a CQL count statement selects no cards");
    return result.rows;
  }
  throw new SowError("must specify either name (-n) or CQL (-c)");
}

async function rowOf(fetch: FetchEngine, id: number): Promise<CardsRow> {
  const { rows } = await fetch.driver.query<CardsRow>("SELECT * FROM cards WHERE id = ?", [id]);
  if (rows[0] === undefined) throw new SowError(`card not found: ~${id}`);
  return rows[0];
}

async function fieldTagMarks(fetch: FetchEngine, tags: string[]): Promise<(string | YamlSymbol)[]> {
  const out: (string | YamlSymbol)[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag === "") continue;
    out.push(await codenameOrString(fetch, DeckoName.parse(tag.replace(/^:/, ""))));
  }
  return out;
}

async function codenameOrString(fetch: FetchEngine, name: DeckoName): Promise<string | YamlSymbol> {
  const record = await fetch.fetchByName(name.s);
  const codename = record?.codename;
  return codename !== undefined && codename !== null && codename !== "" ? sym(codename) : name.s;
}

function blank(v: YamlValue | undefined): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === "string") return [...v].every((ch) => (/\s/.test(ch) && ch.charCodeAt(0) !== 0xfeff) || ch.charCodeAt(0) === 0x85);
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof YamlMap) return v.entries.length === 0;
  return false;
}

async function podHash(fetch: FetchEngine, row: CardsRow, tags: (string | YamlSymbol)[]): Promise<YamlMap> {
  const record = await fetch.fetchById(Number(row.id));
  const name = record?.name;
  if (name === undefined) throw new SowError(`card ~${row.id} has no resolvable name`);
  const entries: [YamlValue, YamlValue][] = [
    [sym("name"), await podName(fetch, name)],
    [sym("type"), await podType(fetch, row)],
    [sym("codename"), row.codename !== null && row.codename !== "" ? sym(row.codename) : null],
    [sym("content"), await podContent(fetch, row, name)],
    [sym("fields"), await podFields(fetch, name, tags)],
  ];
  return new YamlMap(entries.filter(([, v]) => !blank(v)));
}

async function podName(fetch: FetchEngine, name: DeckoName): Promise<YamlValue> {
  if (name.isSimple) return name.s;
  const parts: YamlValue[] = [];
  for (const part of name.partNames) parts.push(await codenameOrString(fetch, part));
  return parts;
}

async function podType(fetch: FetchEngine, row: CardsRow): Promise<YamlValue> {
  if (row.type_id === null || row.type_id === undefined) return null;
  const typeCard = await fetch.fetchById(Number(row.type_id));
  if (typeCard === undefined) return null;
  if (typeCard.codename === "basic") return null;
  if (typeCard.codename !== undefined && typeCard.codename !== null && typeCard.codename !== "") {
    return sym(typeCard.codename);
  }
  return typeCard.name?.s ?? null;
}

async function podContent(fetch: FetchEngine, row: CardsRow, name: DeckoName): Promise<YamlValue> {
  const pattern = await ruleWalkPatternInput(fetch, {
    name,
    id: Number(row.id),
    isNew: false,
    typeId: row.type_id ?? null,
  });
  const structure = await findRule(fetch, pattern, "*structure");
  if (structure !== undefined && (structure.rule.dbContent ?? "").trim() !== "_self") return null;
  if (await isIdList(fetch, row)) return idListItemNames(fetch, row.db_content ?? "");
  return row.db_content ?? null;
}

async function isIdList(fetch: FetchEngine, row: CardsRow): Promise<boolean> {
  if (row.left_id === null || row.right_id === null) return false;
  const right = await fetch.fetchById(Number(row.right_id));
  if (right?.codename !== "members") return false;
  const left = await fetch.fetchById(Number(row.left_id));
  if (left?.typeId === undefined || left.typeId === null) return false;
  const leftType = await fetch.fetchById(left.typeId);
  return leftType?.codename === "role";
}

async function idListItemNames(fetch: FetchEngine, content: string): Promise<string> {
  const names: string[] = [];
  for (const line of content.split(/\n/)) {
    const id = Number.parseInt(line.replace(/~/g, ""), 10);
    if (!Number.isFinite(id) || id === 0) continue;
    const card = await fetch.fetchById(id);
    if (card?.name !== undefined) names.push(card.name.s);
  }
  return names.join("\n");
}

async function podFields(fetch: FetchEngine, name: DeckoName, tags: (string | YamlSymbol)[]): Promise<YamlValue> {
  if (tags.length === 0) return null;
  const map = new YamlMap();
  for (const tag of tags) {
    const tagName = typeof tag === "string" ? tag : (await codenameName(fetch, tag.name)) ?? tag.name;
    const field = await fetch.fetchByName(`${name.s}+${tagName}`);
    if (field === undefined || field.id === undefined) continue;
    const row = await rowOf(fetch, field.id);
    const content = await podContent(fetch, row, field.name ?? DeckoName.parse(`${name.s}+${tagName}`));
    if (!blank(content)) map.set(tag, content);
  }
  return map;
}

async function codenameName(fetch: FetchEngine, codename: string): Promise<string | undefined> {
  const { rows } = await fetch.driver.query<{ id: number }>("SELECT id FROM cards WHERE codename = ?", [codename]);
  if (rows[0] === undefined) return undefined;
  return (await fetch.fetchById(Number(rows[0].id)))?.name?.s;
}
