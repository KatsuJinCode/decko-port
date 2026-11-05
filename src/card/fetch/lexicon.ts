import { DeckoName } from "../name.js";
import {
  CARD_ID_BY_JUNCTION_SQL,
  CARD_ID_BY_KEY_SQL,
  CARD_NAME_TRIPLE_BY_ID_SQL,
} from "./card-read-shapes.js";
import type { SQLDatabaseDriver, PrefetchOutcome, SQLStatement } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import { CardCache } from "./cache.js";

const JOINT = DeckoName.JOINT;
type NameRow = Pick<CardsRow, "name" | "left_id" | "right_id">;

function idOfOutcome(outcome: PrefetchOutcome | undefined): number | undefined {
  if (outcome === undefined || outcome.unverified || outcome.result === undefined) return undefined;
  const id = (outcome.result.rows[0] as { id?: unknown } | undefined)?.id;
  return typeof id === "number" && Number.isInteger(id) ? id : undefined;
}

export interface PrefetchedNameBlock {
  readonly ids: number[];
  readonly pairs: ReadonlyArray<readonly [number, number]>;
}

export class DbLexicon {
  private readonly driver: SQLDatabaseDriver;
  readonly cache: CardCache;
  private durableIdNames = new Map<number, string>();
  private static readonly DURABLE_ID_NAMES_CAP = 200_000;

  forgetDurableRecords(): void {
    this.durableIdNames.clear();
    this.durableLexIds.clear();
  }

  private durableLexIds = new Map<string, number>();
  private static readonly DURABLE_LEX_IDS_CAP = 200_000;

  peekDurableId(lex: Lex): number | undefined {
    return this.durableLexIds.get(cacheKey(lex));
  }

  private recordDurableId(lex: Lex, id: number | undefined): void {
    if (id === undefined) return;
    const key = cacheKey(lex);
    if (this.durableLexIds.has(key)) return;
    if (this.durableLexIds.size >= DbLexicon.DURABLE_LEX_IDS_CAP) {
      this.durableLexIds.clear();
    }
    this.durableLexIds.set(key, id);
  }

  storedKeyFallback = false;

  constructor(driver: SQLDatabaseDriver, cache: CardCache) {
    this.driver = driver;
    this.cache = cache;
  }

  async name(id: number | undefined): Promise<DeckoName | undefined> {
    return this.nameFromRows(id);
  }

  private async nameFromRows(id: number | undefined, rows?: ReadonlyMap<number, NameRow | undefined>): Promise<DeckoName | undefined> {
    if (id === undefined || id === null) return undefined;
    const lex = await this.idToLex(id, rows);
    const name = lex === undefined ? undefined : await this.lexToName(lex, rows);
    if (name === undefined) return undefined;
    const nameStr = typeof name === "string" ? name : name.s;
    this.recordDurableName(id, nameStr);
    return DeckoName.parse(nameStr);
  }

  async names(ids: readonly number[]): Promise<Map<number, DeckoName | undefined>> {
    const release=this.cache.temp.hold();
    try {
      const rows=new Map<number,NameRow|undefined>(),asked=new Set<number>(),pending=new Set(ids);
      const sides=(lex:unknown)=>{
        if(!Array.isArray(lex))return;
        for(const side of lex){
          if(side===undefined)break;
          if(typeof side==='number'&&!asked.has(side))pending.add(side);
        }
      };
      while(pending.size){
        const wave=[...pending],missing:number[]=[];pending.clear();
        for(const id of wave){
          if(asked.has(id))continue;
          asked.add(id);
          const held=this.cache.temp.exist(String(id)),lex=this.peekStored(String(id));
          if(held||lex!==undefined)sides(lex);
          else missing.push(id);
        }
        for(let start=0;start<missing.length;start+=500){
          const chunk=missing.slice(start,start+500);
          const results=await this.driver.batch(chunk.map(id=>({sql:"SELECT name, left_id, right_id FROM cards WHERE id = ? LIMIT 1",params:[id]})));
          if(results.length!==chunk.length)throw Error('Lexicon name batch returned incomplete results');
          results.forEach((result,index)=>{
            const row=(result.rows as NameRow[])[0];rows.set(chunk[index]!,row);
            if(row!==undefined)sides(row.name??[row.left_id??undefined,row.right_id??undefined]);
          });
        }
      }
      const result=new Map<number,DeckoName|undefined>();
      for(const id of ids)result.set(id,await this.nameFromRows(id,rows));
      return result;
    }finally{release()}
  }

  peekDurableName(id: number): string | undefined {
    return this.durableIdNames.get(id);
  }

  noteDurableName(id: number, name: string): void {
    this.recordDurableName(id, name);
  }

  private recordDurableName(id: number, name: string): void {
    if (this.durableIdNames.has(id)) return;
    if (this.durableIdNames.size >= DbLexicon.DURABLE_ID_NAMES_CAP) {
      this.durableIdNames.clear();
    }
    this.durableIdNames.set(id, name);
  }

  async id(nameish: string | DeckoName): Promise<number | undefined> {
    const name = typeof nameish === "string" ? DeckoName.parse(nameish) : nameish;
    if (name.s === "") return undefined;
    if (name.isRelativeFragment) return undefined;
    const lex = await this.nameToLex(name);
    return lex === undefined ? undefined : this.lexToId(lex);
  }

  peekId(nameish: string | DeckoName): number | undefined {
    const name = typeof nameish === "string" ? DeckoName.parse(nameish) : nameish;
    if (name.s === "") return undefined;
    if (name.isRelativeFragment) return undefined;
    const lex = this.peekLex(name);
    if (lex === undefined) return undefined;
    const id = this.peekStored(cacheKey(lex));
    return typeof id === "number" ? id : undefined;
  }

  private peekStored(key: string): unknown {
    if (this.cache.temp.exist(key)) return this.cache.temp.read(key);
    return this.cache.shared?.read(key);
  }

  private peekLex(name: DeckoName): Lex | undefined {
    if (name.isSimple) return name.s;
    const leftId = this.peekId(name.leftName ?? DeckoName.parse(""));
    if (leftId === undefined) return undefined;
    const rightId = this.peekId(name.rightName ?? DeckoName.parse(""));
    if (rightId === undefined) return undefined;
    return [leftId, rightId];
  }

  async composeName(leftId: number, rightId: number | undefined | null): Promise<DeckoName | undefined> {
    const name = await this.lexToName([leftId, rightId ?? undefined]);
    return name === undefined ? undefined : DeckoName.parse(name);
  }

  writeTemp(id: number | undefined, name: DeckoName | undefined, lex: Lex | undefined): void {
    if (id !== undefined) this.cache.temp.write(String(id), name);
    if (lex !== undefined) {
      this.cache.temp.write(cacheKey(lex), id);
      this.recordDurableId(lex, id);
    }
  }

  write(id: number, name: DeckoName, lex: Lex): void {
    this.cache.write(String(id), name);
    this.cache.write(cacheKey(lex), id);
    this.recordDurableId(lex, id);
  }

  primeIdsByKey(entries: ReadonlyArray<{ key: string; id: number | undefined }>): void {
    for (const entry of entries) {
      this.cache.write(cacheKey(entry.key), entry.id);
      this.recordDurableId(entry.key, entry.id);
    }
  }

  heldKeyNegative(key: string): boolean {
    const cacheKeyValue = cacheKey(key);
    if (this.cache.temp.exist(cacheKeyValue)) {
      return typeof this.cache.temp.read(cacheKeyValue) !== "number";
    }
    return false;
  }

  primeIdByLex(lex: Lex, id: number | undefined): void {
    this.cache.write(cacheKey(lex), id);
    this.recordDurableId(lex, id);
  }

  noteIdToLexRow(
    row: Pick<CardsRow, "id" | "name" | "left_id" | "right_id">,
    options: { primeReverse?: boolean } = {},
  ): void {
    if (row.id === undefined || row.id === null) return;
    const resolved: Lex =
      row.name !== null && row.name !== undefined
        ? row.name
        : [row.left_id ?? undefined, row.right_id ?? undefined];
    this.cache.write(String(row.id), resolved);
    if (options.primeReverse === false) return;
    this.cache.write(cacheKey(resolved), row.id);
    this.recordDurableId(resolved, row.id);
  }

  noteIdToLexMiss(id: number): void {
    this.cache.write(String(id), undefined);
  }

  deleteFor(id: number | undefined, lexBeforeAct: Lex | undefined): void {
    if (id !== undefined) this.cache.delete(String(id));
    if (lexBeforeAct !== undefined) {
      this.cache.delete(cacheKey(lexBeforeAct));
      this.durableLexIds.delete(cacheKey(lexBeforeAct));
    }
  }

  private async idToLex(id: number, rows?: ReadonlyMap<number, NameRow | undefined>): Promise<Lex | undefined> {
    const lex = (await this.cacheFetch(String(id), async () => {
      const row = rows?.has(id) ? rows.get(id) : (await this.driver.query<NameRow>(
        CARD_NAME_TRIPLE_BY_ID_SQL,
        [id],
      )).rows[0];
      if (row === undefined) return undefined;
      const resolved: Lex =
        row.name !== null && row.name !== undefined
          ? row.name
          : [row.left_id ?? undefined, row.right_id ?? undefined];
      await this.cacheWrite(cacheKey(resolved), id);
      this.recordDurableId(resolved, id);
      return resolved;
    })) as Lex | undefined;
    return lex;
  }

  private async nameToLex(name: DeckoName): Promise<Lex | undefined> {
    if (name.isSimple) return name.s;
    const rightId = await this.id(name.rightName ?? DeckoName.parse(""));
    if (rightId === undefined) return undefined;
    const leftId = await this.id(name.leftName ?? DeckoName.parse(""));
    if (leftId === undefined) return undefined;
    return [leftId, rightId];
  }

  private async lexToName(lex: Lex, rows?: ReadonlyMap<number, NameRow | undefined>): Promise<string | DeckoName | undefined> {
    if (!Array.isArray(lex)) return lex;
    const sides: string[] = [];
    for (const sideId of lex) {
      if (sideId === undefined) return undefined;
      const side = rows===undefined ? await this.name(sideId) : await this.nameFromRows(sideId,rows);
      sides.push(side === undefined ? "" : side.s);
    }
    return sides.join(JOINT);
  }

  lexEntryKnown(lex: Lex): boolean {
    const key = cacheKey(lex);
    if (this.cache.temp.exist(key)) return true;
    if (this.cache.shared !== undefined) {
      return this.cache.shared.read(key) !== undefined;
    }
    return false;
  }

  peekIdByLex(lex: Lex): number | undefined {
    const id = this.peekStored(cacheKey(lex));
    return typeof id === "number" ? id : undefined;
  }

  heldIdEntry(id: number): boolean {
    const key = String(id);
    if (this.cache.temp.exist(key)) return true;
    if (this.cache.shared !== undefined) {
      return this.cache.shared.read(key) !== undefined;
    }
    return false;
  }

  async prefetchIds(names: readonly DeckoName[]): Promise<PrefetchedNameBlock> {
    const driver = this.driver;
    if (driver.prefetchReads === undefined || names.length === 0) return { ids: [], pairs: [] };
    const all = new Map<string, DeckoName>();
    const collect = (name: DeckoName): void => {
      if (all.has(name.s)) return;
      all.set(name.s, name);
      if (name.isSimple) return;
      const left = name.leftName;
      const right = name.rightName;
      if (left !== undefined) collect(left);
      if (right !== undefined) collect(right);
    };
    for (const name of names) collect(name);
    const resolved = new Map<string, number>();
    const attempted = new Set<string>();
    const simple: DeckoName[] = [];
    for (const name of all.values()) {
      if (!name.isSimple) continue;
      if (this.lexEntryKnown(name.s)) {
        const held = this.peekStored(cacheKey(name.s));
        if (typeof held === "number") resolved.set(name.s, held);
        else attempted.add(name.s);
        continue;
      }
      simple.push(name);
    }
    if (simple.length > 0) {
      const outcomes = await driver.prefetchReads(
        simple.map((name) => this.lookupStatement(name.s as Lex)),
      );
      simple.forEach((name, index) => {
        const outcome = outcomes[index];
        const id = idOfOutcome(outcome);
        if (id !== undefined) {
          resolved.set(name.s, id);
        } else if (outcome !== undefined && !outcome.unverified && !this.storedKeyFallback) {
          attempted.add(name.s);
        }
      });
    }
    const sideId = async (side: DeckoName): Promise<number | undefined> => {
      const held = resolved.get(side.s);
      if (held !== undefined) return held;
      if (attempted.has(side.s)) return undefined;
      if (!side.isSimple) return undefined;
      const peeked = this.peekId(side);
      if (peeked !== undefined) {
        resolved.set(side.s, peeked);
        return peeked;
      }
      const id = await this.id(side);
      attempted.add(side.s);
      if (id !== undefined) resolved.set(side.s, id);
      return id;
    };
    const compounds = [...all.values()]
      .filter((name) => !name.isSimple)
      .sort((a, b) => a.parts.length - b.parts.length);
    while (true) {
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const name of compounds) {
          if (resolved.has(name.s) || attempted.has(name.s)) continue;
          const left = name.leftName;
          const right = name.rightName;
          if (left === undefined || right === undefined) {
            attempted.add(name.s);
            continue;
          }
          const leftId = resolved.get(left.s) ?? (left.isSimple ? this.peekId(left) : undefined);
          const rightId = resolved.get(right.s) ?? (right.isSimple ? this.peekId(right) : undefined);
          if (leftId !== undefined && rightId !== undefined) {
            const lex: Lex = [leftId, rightId];
            if (this.lexEntryKnown(lex)) {
              attempted.add(name.s);
              const held = this.peekStored(cacheKey(lex));
              if (typeof held === "number") resolved.set(name.s, held);
              progressed = true;
            }
          }
        }
      }
      const statements: SQLStatement[] = [];
      const pending: Array<{ name: DeckoName; leftId: number; rightId: number }> = [];
      for (const name of compounds) {
        if (resolved.has(name.s) || attempted.has(name.s)) continue;
        const left = name.leftName;
        const right = name.rightName;
        if (left === undefined || right === undefined) {
          attempted.add(name.s);
          continue;
        }
        const leftReady = resolved.has(left.s) || attempted.has(left.s) || left.isSimple;
        const rightReady = resolved.has(right.s) || attempted.has(right.s) || right.isSimple;
        if (!leftReady || !rightReady) continue;
        const leftId = await sideId(left);
        const rightId = await sideId(right);
        if (leftId === undefined || rightId === undefined) {
          attempted.add(name.s);
          progressed = true;
          continue;
        }
        const lex: Lex = [leftId, rightId];
        if (this.lexEntryKnown(lex)) {
          attempted.add(name.s);
          const held = this.peekStored(cacheKey(lex));
          if (typeof held === "number") resolved.set(name.s, held);
          progressed = true;
          continue;
        }
        pending.push({ name, leftId, rightId });
        statements.push(this.lookupStatement(lex));
      }
      if (statements.length === 0) {
        if (progressed) continue;
        break;
      }
      const outcomes = await driver.prefetchReads(statements);
      pending.forEach((entry, index) => {
        attempted.add(entry.name.s);
        const outcome = outcomes[index];
        const id = idOfOutcome(outcome);
        if (id !== undefined) {
          resolved.set(entry.name.s, id);
        }
      });
    }
    const pairs: Array<readonly [number, number]> = [];
    for (const name of names) {
      if (name.isSimple) continue;
      const left = name.leftName;
      const right = name.rightName;
      if (left === undefined || right === undefined) continue;
      const leftId = resolved.get(left.s);
      const rightId = resolved.get(right.s);
      if (leftId === undefined || rightId === undefined) continue;
      pairs.push([leftId, rightId]);
    }
    const ids: number[] = [];
    for (const name of names) {
      if (!name.isSimple) continue;
      const id = resolved.get(name.s);
      if (id !== undefined) ids.push(id);
    }
    for (const name of names) {
      if (name.isSimple) continue;
      const id = resolved.get(name.s);
      if (id !== undefined) ids.push(id);
    }
    return { ids, pairs };
  }

  private lookupStatement(lex: Lex): SQLStatement {
    return lexIdStatement(lex);
  }

  private async lexToId(lex: Lex): Promise<number | undefined> {
    const found = (await this.cacheFetch(cacheKey(lex), async () => {
      const statement = lexIdStatement(lex);
      const result = await this.driver.query<{ id: number }>(statement.sql, statement.params);
      let id: number | undefined = result.rows[0]?.id;
      if (id === undefined && this.storedKeyFallback && !Array.isArray(lex)) {
        id = await this.idByStoredName(lex);
      }
      if (id !== undefined && Array.isArray(lex)) {
        await this.cacheWrite(String(id), lex);
      }
      this.recordDurableId(lex, id);
      return id;
    })) as number | undefined;
    return found;
  }

  private async idByStoredName(lex: string): Promise<number | undefined> {
    const requested = DeckoName.parse(lex);
    const texts = lex === requested.s ? [lex] : [lex, requested.s];
    const result = await this.driver.query<{ id: number; name: string | null }>(
      `SELECT id, name FROM cards WHERE name IN (${texts.map(() => "?").join(", ")}) AND trash = 0`,
      texts,
    );
    for (const row of result.rows) {
      if (row.name !== null && DeckoName.parse(row.name).key === requested.key) return row.id;
    }
    return undefined;
  }

  private async cacheFetch(key: string, compute: () => Promise<unknown>): Promise<unknown> {
    if (this.cache.temp.exist(key)) return this.cache.temp.read(key);
    if (this.cache.shared !== undefined) {
      const shared = this.cache.shared.read(key);
      if (shared !== undefined) {
        this.cache.temp.write(key, shared, this.cache.afterWriteToTempCache);
        return shared;
      }
    }
    const computed = await compute();
    this.cache.write(key, computed);
    return computed;
  }

  private async cacheWrite(key: string, value: unknown): Promise<void> {
    this.cache.write(key, value);
  }
}

export type Lex = string | [number | undefined, number | undefined];

export function cacheKey(lex: Lex): string {
  return `L-${Array.isArray(lex) ? lex.map((side) => side ?? "").join("-") : DeckoName.parse(lex).key}`;
}

export function lexQuery(lex: Lex): { sql: string; params: unknown[] } {
  if (Array.isArray(lex)) {
    return {
      sql: `${lex[0] === undefined ? "left_id IS NULL" : "left_id = ?"} AND ${
        lex[1] === undefined ? "right_id IS NULL" : "right_id = ?"
      }`,
      params: [lex[0], lex[1]].filter((side) => side !== undefined),
    };
  }
  return { sql: "key = ?", params: [DeckoName.parse(lex).key] };
}

export function lexIdStatement(lex: Lex): SQLStatement {
  const { sql, params } = lexQuery(lex);
  if (!Array.isArray(lex)) return { sql: CARD_ID_BY_KEY_SQL, params };
  if (lex[0] !== undefined && lex[1] !== undefined) {
    return { sql: CARD_ID_BY_JUNCTION_SQL, params };
  }
  return { sql: `SELECT id FROM cards WHERE ${sql} AND trash = 0 ORDER BY id LIMIT 1`, params };
}
