import { DeckoName } from "../name.js";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import { CardCache } from "./cache.js";
import type { DbLexicon, Lex } from "./lexicon.js";

export const CODENAMES_CACHE_KEY = "CODENAMES";

const CODEHASH_SQL =
  "SELECT id, codename, name, left_id, right_id FROM cards WHERE codename IS NOT NULL";

interface Codehash {
  c2i: Map<string, number>;
  i2c: Map<number, string>;
  i2name: Map<number, string>;
}

export class DbCodenameRegistry {
  private readonly driver: SQLDatabaseDriver;
  private readonly cache: CardCache;
  private readonly lexicon: DbLexicon;
  private codehashValue: Codehash | undefined;

  constructor(driver: SQLDatabaseDriver, cache: CardCache, lexicon: DbLexicon) {
    this.driver = driver;
    this.cache = cache;
    this.lexicon = lexicon;
  }

  async id(codename: string): Promise<number | undefined> {
    const codehash = await this.codehash();
    return codehash.c2i.get(codename);
  }

  async nameForId(id: number): Promise<string | undefined> {
    const codehash = await this.codehash();
    return codehash.i2c.get(id);
  }

  async name(codename: string): Promise<DeckoName | undefined> {
    const cardId = await this.id(codename);
    return cardId === undefined ? undefined : this.lexicon.name(cardId);
  }

  resetCache(): void {
    this.codehashValue = undefined;
    this.cache.delete(CODENAMES_CACHE_KEY);
  }

  async ensureLoaded(): Promise<void> {
    await this.codehash();
  }

  peekId(codename: string): number | undefined {
    return this.codehashValue?.c2i.get(codename);
  }

  peekNameForId(id: number): string | undefined {
    return this.codehashValue?.i2c.get(id);
  }

  peekName(codename: string): string | undefined {
    const id = this.peekId(codename);
    return id === undefined ? undefined : this.codehashValue?.i2name.get(id);
  }

  peekRegisteredName(id: number): string | undefined {
    return this.codehashValue?.i2name.get(id);
  }

  peekEntries(): Array<[string, number]> {
    return [...(this.codehashValue?.c2i.entries() ?? [])];
  }

  codehashStatement(): SQLStatement {
    return { sql: CODEHASH_SQL, params: [] };
  }

  foldCodehashResults(result: SQLQueryResult): void {
    if (this.codehashValue !== undefined) return;
    const codehash = this.buildCodehash(
      result.rows as Array<Pick<CardsRow, "id" | "codename" | "name" | "left_id" | "right_id">>,
    );
    this.cache.write(CODENAMES_CACHE_KEY, codehash);
    this.codehashValue = codehash;
  }

  private async codehash(): Promise<Codehash> {
    if (this.codehashValue !== undefined) return this.codehashValue;
    const cached = this.cache.fetch(CODENAMES_CACHE_KEY, () => null) as Codehash | null;
    if (cached && cached.c2i instanceof Map && cached.i2c instanceof Map) {
      this.codehashValue = cached.i2name instanceof Map
        ? cached
        : { c2i: cached.c2i, i2c: cached.i2c, i2name: new Map() };
      return this.codehashValue;
    }
    const fresh = await this.processCodenames();
    this.cache.write(CODENAMES_CACHE_KEY, fresh);
    this.codehashValue = fresh;
    return fresh;
  }

  private buildCodehash(
    rows: Array<Pick<CardsRow, "id" | "codename" | "name" | "left_id" | "right_id">>,
  ): Codehash {
    const codehash: Codehash = { c2i: new Map(), i2c: new Map(), i2name: new Map() };
    for (const row of rows) {
      if (row.codename === null || row.codename === undefined) continue;
      codehash.c2i.set(row.codename, row.id);
      codehash.i2c.set(row.id, row.codename);
      if (row.name !== null && row.name !== undefined) {
        codehash.i2name.set(row.id, row.name);
      }
      if (row.left_id === null || row.left_id === undefined) {
        const name = row.name !== null && row.name !== undefined ? DeckoName.parse(row.name) : undefined;
        if (name !== undefined) {
          const lex: Lex = name.isSimple ? name.s : [row.left_id ?? undefined, row.right_id ?? undefined];
          this.lexicon.write(row.id, name, lex);
        }
      }
    }
    return codehash;
  }

  private async processCodenames(): Promise<Codehash> {
    const result = await this.driver.query<
      Pick<CardsRow, "id" | "codename" | "name" | "left_id" | "right_id">
    >(CODEHASH_SQL, []);
    return this.buildCodehash(result.rows);
  }
}
