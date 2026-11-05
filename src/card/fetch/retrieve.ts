import { DeckoName, type Nameish } from "../name.js";
import { CARD_ROW_BY_KEY_SQL, LIVE_CARD_ROW_BY_ID_SQL } from "./card-read-shapes.js";
import { NameNotFoundError, CodenameNotFoundError } from "../name/errors.js";
import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import type { CardRecord } from "./card-record.js";
import type { DbLexicon } from "./lexicon.js";
import type { DbCodenameRegistry } from "./codename.js";

const ID_MARK_REGEXP = /^~(\d+)$/;
const CODENAME_MARK_REGEXP = /^:(\w+)$/;

type FlatArg = number | string | DeckoName | CardRecord | CodenameMarkArg;

function flattenArgs(args: readonly FetchArg[]): FlatArg[] {
  const out: FlatArg[] = [];
  const walk = (items: readonly FetchArg[]): void => {
    for (const item of items) {
      if (Array.isArray(item)) walk(item);
      else out.push(item as FlatArg);
    }
  };
  walk(args);
  return out;
}

export interface CodenameMarkArg {
  readonly codename: string;
}

export type FetchArg =
  | number
  | string
  | DeckoName
  | CardRecord
  | CodenameMarkArg
  | readonly FetchArg[];

export type FetchMark =
  | { kind: "id"; id: number }
  | { kind: "name"; name: DeckoName }
  | { kind: "outOfRange"; digits: string };

export interface MarkOptions {
  newSupercardName?: Nameish;
}

function isCodenameMark(arg: FlatArg): arg is CodenameMarkArg {
  return typeof arg === "object" && arg !== null && !(arg instanceof DeckoName) && "codename" in arg;
}

function isCardRecord(arg: FlatArg): arg is CardRecord {
  return (
    typeof arg === "object" &&
    arg !== null &&
    !isCodenameMark(arg) &&
    !(arg instanceof DeckoName) &&
    "key" in arg
  );
}

export async function normalizeMark(
  args: readonly FetchArg[],
  opts: MarkOptions,
  lexicon: DbLexicon,
  codenames: DbCodenameRegistry,
): Promise<FetchMark | undefined> {
  const flat = flattenArgs(args);
  const mark: FlatArg | undefined = flat.length <= 1 ? flat[0] : undefined;

  if (mark === undefined) {
    const name = await nameFromMarkParts(flat, lexicon, codenames);
    return absolutize({ kind: "name", name }, opts);
  }

  const id = await idFromMark(mark, lexicon, codenames);
  if (typeof id === "number") {
    if (!Number.isSafeInteger(id)) return { kind: "outOfRange", digits: String(id) };
    return { kind: "id", id };
  }
  if (typeof id === "object" && id !== null && "outOfRange" in id) {
    return { kind: "outOfRange", digits: id.outOfRange };
  }
  const name = await nameFromMark(mark, lexicon, codenames);
  return absolutize({ kind: "name", name }, opts);
}

function absolutize(mark: FetchMark & { kind: "name" }, opts: MarkOptions): FetchMark {
  if (opts.newSupercardName === undefined || opts.newSupercardName === null) return mark;
  const supercard = DeckoName.parse(opts.newSupercardName as Exclude<Nameish, null | undefined>);
  return { kind: "name", name: mark.name.absoluteName(supercard) };
}

async function idFromMark(
  mark: FlatArg,
  lexicon: DbLexicon,
  codenames: DbCodenameRegistry,
): Promise<number | undefined | { outOfRange: string }> {
  if (typeof mark === "number") {
    return Number.isSafeInteger(mark) ? mark : { outOfRange: String(mark) };
  }
  if (typeof mark === "string") {
    return idFromStringStrict(mark, lexicon, codenames);
  }
  if (isCodenameMark(mark)) {
    const id = await codenames.id(mark.codename);
    if (id === undefined) {
      throw new CodenameNotFoundError(`codename doesn't exist: ${mark.codename}`);
    }
    return id;
  }
  if (isCardRecord(mark)) return mark.id;
  return undefined;
}

async function idFromStringStrict(
  str: string,
  lexicon: DbLexicon,
  codenames: DbCodenameRegistry,
): Promise<number | undefined | { outOfRange: string }> {
  const idMatch = ID_MARK_REGEXP.exec(str);
  if (idMatch !== null) {
    const digits = idMatch[1] as string;
    const id = Number(digits);
    if (!Number.isSafeInteger(id)) return { outOfRange: digits };
    const known = await lexicon.name(id);
    if (known === undefined || known.s === "") {
      throw new NameNotFoundError(`id doesn't exist: ${digits}`);
    }
    return id;
  }
  const codeMatch = CODENAME_MARK_REGEXP.exec(str);
  if (codeMatch !== null) {
    const codename = codeMatch[1] as string;
    const id = await codenames.id(codename);
    if (id === undefined) {
      throw new CodenameNotFoundError(`codename doesn't exist: ${codename}`);
    }
    return id;
  }
  return undefined;
}

async function nameFromMark(
  mark: FlatArg | undefined,
  lexicon: DbLexicon,
  codenames: DbCodenameRegistry,
): Promise<DeckoName> {
  if (mark === null || mark === undefined) return DeckoName.parse("");
  if (mark instanceof DeckoName) return mark;
  if (typeof mark === "string") return DeckoName.parse(mark);
  if (typeof mark === "number") {
    const name = await lexicon.name(mark);
    return name ?? DeckoName.parse("");
  }
  if (isCodenameMark(mark)) {
    const name = await codenames.name(mark.codename);
    if (name === undefined) {
      throw new CodenameNotFoundError(`codename doesn't exist: ${mark.codename}`);
    }
    return name;
  }
  if (isCardRecord(mark)) return mark.name ?? DeckoName.parse("");
  return DeckoName.parse("");
}

async function nameFromMarkParts(
  parts: readonly FlatArg[],
  lexicon: DbLexicon,
  codenames: DbCodenameRegistry,
): Promise<DeckoName> {
  const resolved: string[] = [];
  for (const part of parts) {
    resolved.push((await nameFromMark(part, lexicon, codenames)).s);
  }
  return DeckoName.compose(resolved);
}

export interface DbRetrievalResult {
  row: CardsRow | undefined;
  freshFromDb: boolean;
}

export interface DbRetrievalOptions {
  lookInTrash: boolean;
}

export async function retrieveFromDb(
  driver: SQLDatabaseDriver,
  mark: FetchMark,
  opts: DbRetrievalOptions,
  lexicon: DbLexicon,
): Promise<DbRetrievalResult> {
  const trashClause = opts.lookInTrash ? "" : " AND trash = 0";

  if (mark.kind === "name" && mark.name.isSimple) {
    if (opts.lookInTrash !== true && lexicon.heldKeyNegative(mark.name.key)) {
      return { row: undefined, freshFromDb: false };
    }
    const result = await driver.query<CardsRow>(
      (opts.lookInTrash === true ? "SELECT * FROM cards WHERE key = ? LIMIT 1" : CARD_ROW_BY_KEY_SQL),
      [mark.name.key],
    );
    return finish(result.rows[0]);
  }

  if (mark.kind === "outOfRange") {
    return { row: undefined, freshFromDb: false };
  }

  const id = mark.kind === "id" ? mark.id : await lexicon.id(mark.name);
  if (id === undefined) return { row: undefined, freshFromDb: false };
  const result = await driver.query<CardsRow>(
    (opts.lookInTrash === true ? "SELECT * FROM cards WHERE id = ? LIMIT 1" : LIVE_CARD_ROW_BY_ID_SQL),
    [id],
  );
  return finish(result.rows[0]);
}

function finish(row: CardsRow | undefined): DbRetrievalResult {
  return { row, freshFromDb: row !== undefined && !row.trash };
}
