import type { FetchEngine } from "../fetch.js";
import type { CardActionEngine } from "../actions/card-action-engine.js";
import { ATTACHMENT_MOUNTS } from "../actions/card-action-engine.js";
import type { AttachmentInput, SubcardInput } from "../actions/types.js";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { CardsRow } from "../../server/schema.js";
import { DeckoName } from "../name.js";
import { loadYaml, YamlMap, YamlSymbol, type YamlValue } from "./pod-yaml.js";

export interface PodActor {
  id: number;
  name: string;
}

export interface EatOptions {
  defaultActor: PodActor;
  filesDir?: string;
  codedMod?: string;
  codedDir?: string;
}

export interface EatReport {
  items: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedNotPristine: string[];
  errors: { item: string; error: string }[];
}

export class EatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EatError";
  }
}

const DECKO_BOT_ID = 1;

export async function eatYaml(
  fetch: FetchEngine,
  engineFor: (actor: PodActor, now?: () => Date) => CardActionEngine,
  yaml: string,
  opts: EatOptions,
): Promise<EatReport> {
  const doc = loadYaml(yaml);
  const items = Array.isArray(doc) ? doc : doc === null ? [] : [doc];
  const staleNames = new Map<string, number>();
  const report: EatReport = { items: items.length, created: 0, updated: 0, unchanged: 0, skippedNotPristine: [], errors: [] };
  for (const item of items) {
    if (!(item instanceof YamlMap)) {
      throw new EatError(`inedible pod data: ${String(item)}`);
    }
    const label = describe(item);
    try {
      const outcome = await ensure(fetch, engineFor, item, opts, staleNames);
      if (outcome === "created") report.created++;
      else if (outcome === "updated") report.updated++;
      else if (outcome === "unchanged") report.unchanged++;
      else report.skippedNotPristine.push(label);
    } catch (error) {
      report.errors.push({ item: label, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

function describe(item: YamlMap): string {
  const name = item.get(new YamlSymbol("name"));
  const codename = item.get(new YamlSymbol("codename"));
  if (Array.isArray(name)) return name.map(String).join("+");
  if (name !== undefined && name !== null) return String(name);
  return codename !== undefined ? String(codename) : "(unnamed)";
}

function attrs(item: YamlMap): Map<string, YamlValue> {
  const out = new Map<string, YamlValue>();
  for (const [k, v] of item.entries) out.set(k instanceof YamlSymbol ? k.name : String(k), v);
  return out;
}

type Outcome = "created" | "updated" | "unchanged" | "skipped";

async function ensure(
  fetch: FetchEngine,
  engineFor: (actor: PodActor, now?: () => Date) => CardActionEngine,
  item: YamlMap,
  opts: EatOptions,
  staleNames: Map<string, number>,
): Promise<Outcome> {
  const a = attrs(item);
  const attachment = podAttachment(a, opts);
  const mode = conflictMode(a.get("conflict"));
  const actor = await resolveActor(fetch, a.get("user"), opts.defaultActor);
  const now = clockFor(a.get("time"));
  const engine = engineFor(actor, now);

  const codename = asString(a.get("codename"));
  const name = a.has("name") ? await resolveName(fetch, a.get("name")) : undefined;
  if (codename === undefined && name === undefined) throw new EatError("Card.ensure must have name or codename");

  const typeSpec = typeSpecOf(a.get("type"));
  const content = a.has("content") ? toContent(a.get("content")) : undefined;
  const subcards = await fieldSubcards(fetch, a.get("fields"));
  const wanted: Wanted = {
    name,
    codename,
    typeSpec,
    content,
    subcards,
    attachment,
    codedStorage: asString(a.get("storage_type")) === "coded" && attachment === undefined,
  };

  let row: CardsRow | undefined;
  let other: CardsRow | undefined;
  if (codename !== undefined) {
    row = await liveRowByCodename(fetch, codename);
    if (name !== undefined) {
      const nameId = staleNames.get(name.key) ?? (await liveIdByName(fetch, name));
      if (nameId !== undefined && nameId !== row?.id) other = await rowById(fetch, nameId);
    }
  } else if (name !== undefined) {
    const id = await liveIdByName(fetch, name);
    row = id !== undefined ? await rowById(fetch, id) : undefined;
  }

  if (codename !== undefined && other !== undefined) {
    return ensureAdvanced(fetch, engine, mode, row, other, wanted, staleNames);
  }
  if (row === undefined) return createWanted(engine, wanted, name);
  const attempt = mode === "override" ? true : mode === "default" ? await pristine(fetch, row) : false;
  if (!attempt) return mode === "defer" ? "unchanged" : "skipped";
  return saveIfNeeded(fetch, engine, row, wanted);
}

type ConflictMode = "default" | "defer" | "override";

function conflictMode(v: YamlValue | undefined): ConflictMode {
  if (v === undefined || v === null) return "default";
  const mode = (v instanceof YamlSymbol ? v.name : String(v)).replace(/^:/, "");
  if (mode === "default" || mode === "defer" || mode === "override") return mode;
  throw new EatError(`invalid conflict mode: ${mode}. Must be defer, default, or override`);
}

interface Wanted {
  name: DeckoName | undefined;
  codename: string | undefined;
  typeSpec: { typeCode?: string; typeName?: string };
  content: string | undefined;
  subcards: Record<string, SubcardInput>;
  attachment: AttachmentInput | undefined;
  codedStorage: boolean;
}

function podAttachment(a: Map<string, YamlValue>, opts: EatOptions): AttachmentInput | undefined {
  const key = ["file", "image"].find((k) => a.has(k));
  if (key === undefined) return undefined;
  const filename = String(asString(a.get(key)) ?? "");
  const path = opts.filesDir === undefined ? undefined : join(opts.filesDir, filename);
  if (path === undefined || !existsSync(path)) {
    throw new EatError(`${filename} not found. Should be in data/files.`);
  }
  const storage = asString(a.get("storage_type"));
  return {
    bytes: readFileSync(path),
    originalFilename: basename(filename),
    ...(storage === "coded" ? { coded: { mod: opts.codedMod } } : {}),
  };
}

async function createWanted(
  engine: CardActionEngine,
  wanted: Wanted,
  name: DeckoName | undefined,
): Promise<Outcome> {
  if (name === undefined) throw new EatError(`no card has codename :${wanted.codename} and the pod gives no name`);
  if (wanted.codedStorage) {
    throw await codedStorageError(engine, undefined, name, wanted.typeSpec);
  }
  await engine.createCard({
    name: name.s,
    ...(wanted.content !== undefined ? { content: wanted.content } : {}),
    ...wanted.typeSpec,
    ...(wanted.codename !== undefined ? { codename: wanted.codename } : {}),
    ...(Object.keys(wanted.subcards).length > 0 ? { subcards: wanted.subcards } : {}),
    ...(wanted.attachment !== undefined ? { attachment: wanted.attachment } : {}),
  });
  return "created";
}

async function saveIfNeeded(
  fetch: FetchEngine,
  engine: CardActionEngine,
  row: CardsRow,
  wanted: Wanted,
  opts: { keepName?: boolean } = {},
): Promise<Outcome> {
  const current = await fetch.fetchById(row.id);
  const name = opts.keepName === true ? undefined : wanted.name;
  const nameChanging = name !== undefined && (await nameIsChanging(fetch, row, current?.name, name));
  const contentChanging = wanted.content !== undefined && wanted.content !== (row.db_content ?? "");
  let typeChanging = false;
  let typeId: number | undefined;
  if (wanted.typeSpec.typeCode !== undefined || wanted.typeSpec.typeName !== undefined) {
    typeId = await resolveTypeId(fetch, wanted.typeSpec);
    typeChanging = typeId !== undefined && typeId !== row.type_id;
  }
  const codenameChanging = wanted.codename !== undefined && wanted.codename !== (row.codename ?? undefined);
  const fieldsNeedSave = await subcardsNeedSave(fetch, current?.name, wanted.subcards);
  const attaching = wanted.attachment !== undefined;
  if (!nameChanging && !contentChanging && !typeChanging && !codenameChanging && !fieldsNeedSave && !attaching) {
    return "unchanged";
  }
  if (wanted.codedStorage) throw await codedStorageError(engine, row, wanted.name);
  if (nameChanging || contentChanging || typeChanging || fieldsNeedSave || attaching) {
    await engine.updateCard({
      cardId: row.id,
      ...(nameChanging && name !== undefined ? { name: name.s } : {}),
      ...(contentChanging && wanted.content !== undefined ? { content: wanted.content } : {}),
      ...(typeChanging && typeId !== undefined ? { typeId } : {}),
      ...(fieldsNeedSave ? { subcards: wanted.subcards } : {}),
      ...(attaching ? { attachment: wanted.attachment } : {}),
    });
  }
  if (codenameChanging && wanted.codename !== undefined) {
    await fetch.driver.query("UPDATE cards SET codename = ? WHERE id = ?", [wanted.codename, row.id]);
  }
  return "updated";
}

async function ensureAdvanced(
  fetch: FetchEngine,
  engine: CardActionEngine,
  mode: ConflictMode,
  card: CardsRow | undefined,
  other: CardsRow,
  wanted: Wanted,
  staleNames: Map<string, number>,
): Promise<Outcome> {
  const otherName = (await fetch.fetchById(other.id))?.name ?? DeckoName.parse(other.name ?? "");
  if (mode === "defer") {
    if (card !== undefined) return "unchanged";
    return createWanted(engine, wanted, await alternativeName(fetch, otherName));
  }
  if (mode === "default") {
    if (card !== undefined && !(await pristine(fetch, card))) return "skipped";
    if (card === undefined && (await pristine(fetch, other))) {
      return saveIfNeeded(fetch, engine, other, wanted);
    }
    if (card === undefined) return createWanted(engine, wanted, await alternativeName(fetch, otherName));
    return saveIfNeeded(fetch, engine, card, wanted, { keepName: true });
  }
  if (card === undefined) return saveIfNeeded(fetch, engine, other, wanted);
  const moved = await alternativeName(fetch, otherName);
  await engine.updateCard({ cardId: other.id, name: moved.s });
  staleNames.set(otherName.key, other.id);
  throw new EatError(`Validation failed: Name must be unique; '${moved.s}' already exists.`);
}

async function codedStorageError(
  engine: CardActionEngine,
  row: CardsRow | undefined,
  name: DeckoName | undefined,
  typeSpec?: { typeCode?: string; typeName?: string },
): Promise<EatError> {
  const problems: string[] = [];
  if (row === undefined) {
    let typeCode = typeSpec?.typeCode;
    if (typeCode === undefined && typeSpec?.typeName !== undefined) {
      const id = await engine.fetch.lexicon.id(DeckoName.parse(typeSpec.typeName));
      typeCode = id === undefined ? undefined : (await engine.fetch.fetchById(id))?.codename ?? undefined;
    }
    const mount = typeCode !== undefined ? ATTACHMENT_MOUNTS[typeCode] : undefined;
    if (mount !== undefined) {
      problems.push(`${mount.charAt(0).toUpperCase()}${mount.slice(1)} is missing`);
    }
  }
  const content = row?.db_content ?? "";
  const modern = /^:[:\w/+]+\/([^./]+)\./.exec(content);
  const lines = content.split("\n");
  const deprecated =
    content !== "" && !content.startsWith("~") && lines.length === 4 ? lines[lines.length - 1] : undefined;
  if ((modern === null || modern === undefined) && deprecated === undefined) {
    problems.push("Storage type mod argument needed to save card as coded");
  }
  if (name !== undefined) {
    for (const part of name.partNames) {
      const id = await engine.fetch.lexicon.id(part);
      const code = id === undefined ? undefined : (await engine.fetch.fetchById(id))?.codename;
      if (code === undefined || code === null || code === "") {
        problems.push("Storage type codename needed for storage type coded");
        break;
      }
    }
  }
  return new EatError(`Validation failed: ${problems.join(", ")}`);
}

async function alternativeName(fetch: FetchEngine, name: DeckoName): Promise<DeckoName> {
  for (let n = 1; ; n++) {
    const candidate = DeckoName.parse(`${name.s} ${n}`);
    if ((await fetch.lexicon.id(candidate)) === undefined) return candidate;
  }
}

function asString(v: YamlValue | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (v instanceof YamlSymbol) return v.name;
  return String(v);
}

function toContent(v: YamlValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (v instanceof YamlSymbol) return `:${v.name}`;
  if (Array.isArray(v)) return v.map((x) => toContent(x)).join("\n");
  return String(v);
}

async function resolveName(fetch: FetchEngine, v: YamlValue | undefined): Promise<DeckoName> {
  if (typeof v === "string") return DeckoName.parse(v);
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const part of v) {
      if (part instanceof YamlSymbol) {
        const row = await liveRowByCodename(fetch, part.name);
        if (row === undefined) throw new EatError(`unknown codename in name: :${part.name}`);
        const partName = (await fetch.fetchById(row.id))?.name;
        if (partName === undefined) throw new EatError(`codename :${part.name} has no name`);
        parts.push(partName.s);
      } else {
        parts.push(String(part));
      }
    }
    return DeckoName.parse(parts.join("+"));
  }
  if (v instanceof YamlSymbol) {
    const row = await liveRowByCodename(fetch, v.name);
    const n = row !== undefined ? (await fetch.fetchById(row.id))?.name : undefined;
    if (n === undefined) throw new EatError(`unknown codename: :${v.name}`);
    return n;
  }
  throw new EatError(`unreadable pod name: ${String(v)}`);
}

function typeSpecOf(v: YamlValue | undefined): { typeCode?: string; typeName?: string } {
  if (v === undefined || v === null) return {};
  if (v instanceof YamlSymbol) return { typeCode: v.name };
  return { typeName: String(v) };
}

async function resolveTypeId(
  fetch: FetchEngine,
  spec: { typeCode?: string; typeName?: string },
): Promise<number | undefined> {
  if (spec.typeCode !== undefined) return (await liveRowByCodename(fetch, spec.typeCode))?.id;
  if (spec.typeName !== undefined) return liveIdByName(fetch, DeckoName.parse(spec.typeName));
  return undefined;
}

async function fieldSubcards(fetch: FetchEngine, v: YamlValue | undefined): Promise<Record<string, SubcardInput>> {
  const out: Record<string, SubcardInput> = {};
  if (!(v instanceof YamlMap)) return out;
  for (const [mark, value] of v.entries) {
    let tag: string;
    if (mark instanceof YamlSymbol) {
      const row = await liveRowByCodename(fetch, mark.name);
      const n = row !== undefined ? (await fetch.fetchById(row.id))?.name?.s : undefined;
      if (n === undefined) throw new EatError(`unknown field codename: :${mark.name}`);
      tag = n;
    } else {
      tag = String(mark);
    }
    if (value instanceof YamlMap) throw new EatError(`field hashes with attributes are not supported (+${tag})`);
    out[`+${tag}`] = { content: toContent(value) };
  }
  return out;
}

async function subcardsNeedSave(
  fetch: FetchEngine,
  parent: DeckoName | undefined,
  subcards: Record<string, SubcardInput>,
): Promise<boolean> {
  for (const [key, sub] of Object.entries(subcards)) {
    const full = `${parent?.s ?? ""}${key}`;
    const existing = await fetch.fetchByName(full);
    if (existing === undefined || existing.id === undefined) return true;
    if ((sub.content ?? "") !== (existing.dbContent ?? "")) return true;
  }
  return false;
}

async function nameIsChanging(
  fetch: FetchEngine,
  row: CardsRow,
  current: DeckoName | undefined,
  next: DeckoName,
): Promise<boolean> {
  if (next.isSimple) return row.left_id !== null || row.name !== next.s;
  if (row.left_id === null) return true;
  const left = next.leftName !== undefined ? await fetch.lexicon.id(next.leftName) : undefined;
  const right = next.rightName !== undefined ? await fetch.lexicon.id(next.rightName) : undefined;
  void current;
  return (left ?? null) !== row.left_id || (right ?? null) !== row.right_id;
}

async function pristine(fetch: FetchEngine, row: CardsRow): Promise<boolean> {
  if (row.created_at === row.updated_at && Number(row.creator_id) === DECKO_BOT_ID) return true;
  const { rows } = await fetch.driver.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM card_actions JOIN card_acts ON card_acts.id = card_actions.card_act_id
     WHERE card_actions.card_id = ? AND (card_actions.draft IS NULL OR card_actions.draft = 0)
       AND card_acts.actor_id != ?`,
    [row.id, DECKO_BOT_ID],
  );
  return Number(rows[0]?.n ?? 0) === 0;
}

async function resolveActor(fetch: FetchEngine, user: YamlValue | undefined, fallback: PodActor): Promise<PodActor> {
  if (user === undefined || user === null) return fallback;
  const name = user instanceof YamlSymbol ? undefined : DeckoName.parse(String(user));
  const row =
    user instanceof YamlSymbol
      ? await liveRowByCodename(fetch, user.name)
      : name !== undefined
        ? await rowById(fetch, (await liveIdByName(fetch, name)) ?? -1)
        : undefined;
  if (row === undefined) return fallback;
  return { id: row.id, name: (await fetch.fetchById(row.id))?.name?.s ?? String(user) };
}

function clockFor(v: YamlValue | undefined): (() => Date) | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  let at: Date;
  if (typeof v === "number") at = new Date(v * 1000);
  else if (/^[+-]\d+$/.test(String(v))) at = new Date(Date.now() + Number(String(v)) * 1000);
  else at = new Date(String(v));
  if (Number.isNaN(at.getTime())) throw new EatError(`unreadable :time ${String(v)}`);
  return () => at;
}

async function rowById(fetch: FetchEngine, id: number): Promise<CardsRow | undefined> {
  const { rows } = await fetch.driver.query<CardsRow>("SELECT * FROM cards WHERE id = ?", [id]);
  return rows[0];
}

async function liveRowByCodename(fetch: FetchEngine, codename: string): Promise<CardsRow | undefined> {
  const { rows } = await fetch.driver.query<CardsRow>(
    "SELECT * FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1",
    [codename],
  );
  return rows[0];
}

async function liveIdByName(fetch: FetchEngine, name: DeckoName): Promise<number | undefined> {
  const record = await fetch.fetchByName(name.s);
  if (record === undefined || record.id === undefined || record.trash) return undefined;
  return record.id;
}
