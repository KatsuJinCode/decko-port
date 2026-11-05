import { CardCache, type SharedCacheStore } from "./fetch/cache.js";
import { DbLexicon, cacheKey as lexiconCacheKey } from "./fetch/lexicon.js";
import { DbCodenameRegistry, CODENAMES_CACHE_KEY } from "./fetch/codename.js";
import {
  composeCardRecord,
  newCardRecord,
  isKnownCard,
  isNewCard,
  isRealCard,
  idString,
  type CardRecord,
} from "./fetch/card-record.js";
export type { CardRecord };
import {
  normalizeMark,
  retrieveFromDb,
  type FetchArg,
  type FetchMark,
} from "./fetch/retrieve.js";
import type { VirtualCardResolution } from "./fetch/virtual-cards.js";
import type { SQLDatabaseDriver } from "../server/driver.js";
import { ReplayPlanRouter } from "./one-trip/replay-plan-router.js";
import { DeckoName, type Nameish } from "./name.js";
import { getNameEnvironment, setNameEnvironment, type NameEnvironment } from "./name/environment.js";

export interface FetchOptions {
  skipVirtual?: boolean;
  skipModules?: boolean;
  lookInTrash?: boolean;
  localOnly?: boolean;
  skipTypeLookup?: boolean;
  eagerCache?: boolean;
  new?: NewCardOptions;
}

export type VirtualCardLookup = (
  name: DeckoName,
) => Promise<VirtualCardResolution | undefined>;

export interface NewCardOptions {
  supercard?: Nameish;
  typeId?: number;
  typePreset?: boolean;
  typeCode?: string;
  typeName?: Nameish;
  content?: string;
  defaultContent?: string;
  name?: Nameish;
}

const DEFAULT_DATABASE_NAME = "decko";

export class FetchEngine {
  readonly driver: SQLDatabaseDriver;
  readonly replayRouter: ReplayPlanRouter;
  readonly cardCache: CardCache;
  readonly lexiconCache: CardCache;
  readonly lexicon: DbLexicon;
  readonly codenames: DbCodenameRegistry;
  virtualCardLookup?: VirtualCardLookup;
  private stalenessKeeper = new Map<string, CardRecord>();

  constructor(
    driver: SQLDatabaseDriver,
    opts: {
      sharedStore?: SharedCacheStore;
      database?: string;
      maxTemporaryCacheKeys?: number;
    } = {},
  ) {
    this.replayRouter = new ReplayPlanRouter(driver);
    this.driver = this.replayRouter;
    this.cardCache = new CardCache({
      className: "Card",
      sharedStore: opts.sharedStore,
      database: opts.database ?? DEFAULT_DATABASE_NAME,
      maxTemporaryKeys: opts.maxTemporaryCacheKeys,
    });
    this.lexiconCache = new CardCache({
      className: "Lexicon",
      sharedStore: opts.sharedStore,
      database: opts.database ?? DEFAULT_DATABASE_NAME,
      maxTemporaryKeys: opts.maxTemporaryCacheKeys,
    });
    this.lexicon = new DbLexicon(this.replayRouter, this.lexiconCache);
    this.codenames = new DbCodenameRegistry(this.replayRouter, this.cardCache, this.lexicon);
    this.cardCache.afterWriteToTempCache = (value) => {
      if (isCardValue(value)) this.writeLexiconTemp(value);
    };
    if (getNameEnvironment() === undefined) this.installNameEnvironment();
  }

  async fetch(...args: readonly (FetchArg | FetchOptions)[]): Promise<CardRecord | undefined> {
    const { marks, opts } = splitArgs(args);
    return this.fetchWithOptions(marks, opts);
  }

  async fetchWithOptions(
    marks: readonly FetchArg[],
    opts: FetchOptions = {},
  ): Promise<CardRecord | undefined> {
    if (opts.new !== undefined && opts.skipVirtual === true) {
      throw new Error("fetch called with new args and skip_virtual");
    }

    const mark = await normalizeMark(
      marks,
      { newSupercardName: opts.new?.supercard },
      this.lexicon,
      this.codenames,
    );
    if (mark === undefined) return undefined;

    if (mark.kind === "outOfRange") {
      return newCardRecord(DeckoName.parse(`card id out of range: ${mark.digits}`));
    }

    const retrieved = await this.retrieveExisting(mark, opts);
    return await this.updateCache(mark, retrieved, opts);
  }

  private async retrieveExisting(
    mark: FetchMark,
    opts: FetchOptions,
  ): Promise<{ card: CardRecord | undefined; freshFromDb: boolean }> {
    if (mark.kind === "name" && mark.name.s === "") return { card: undefined, freshFromDb: false };
    const fromCache = await this.retrieveFromCache(mark, opts);
    if (fromCache !== undefined) return { card: fromCache, freshFromDb: false };
    const { row, freshFromDb } = await retrieveFromDb(
      this.driver,
      mark,
      { lookInTrash: opts.lookInTrash === true },
      this.lexicon,
    );
    if (row === undefined) return { card: undefined, freshFromDb: false };
    return { card: await composeCardRecord(row, this.lexicon), freshFromDb };
  }

  private async retrieveFromCache(
    mark: FetchMark,
    opts: FetchOptions,
  ): Promise<CardRecord | undefined> {
    const localOnly = opts.localOnly === true;
    let card: CardRecord | undefined;
    if (mark.kind === "id") {
      card = await this.retrieveFromCacheById(mark.id, localOnly);
    } else if (mark.kind === "name") {
      card = this.retrieveFromCacheByKey(mark.name.key, localOnly);
    }
    if (card !== undefined && isNewCard(card) && opts.lookInTrash === true) {
      return undefined;
    }
    return card;
  }

  retrieveFromCacheByKey(key: string, localOnly = false): CardRecord | undefined {
    const kept = localOnly ? undefined : this.stalenessKeeper.get(key);
    if (kept !== undefined) return kept;
    const value = localOnly ? this.cardCache.temp.read(key) : this.cardCache.read(key);
    return isCardValue(value) ? value : undefined;
  }

  async retrieveFromCacheById(id: number, localOnly = false): Promise<CardRecord | undefined> {
    const name = await this.lexicon.name(id);
    if (name === undefined || name.key === "") return undefined;
    return this.retrieveFromCacheByKey(name.key, localOnly);
  }

  private async updateCache(
    mark: FetchMark,
    retrieved: { card: CardRecord | undefined; freshFromDb: boolean },
    opts: FetchOptions,
  ): Promise<CardRecord | undefined> {
    let card = retrieved.card;
    let createdPlaceholder = false;
    if (this.newForCacheApplies(mark, card, opts)) {
      card = this.instantiatePlaceholder(mark as MarkWithName, opts);
      createdPlaceholder = true;
    }
    if ((retrieved.freshFromDb || createdPlaceholder) && card !== undefined && !card.uncacheable) {
      this.storeCard(card, opts);
    }
    return await this.results(card, mark, opts);
  }

  private reusable(mark: FetchMark, opts: FetchOptions): boolean {
    if (mark.kind !== "name") return false;
    return !(mark.name.s === "" && opts.new === undefined);
  }

  private newCardNeeded(card: CardRecord | undefined, opts: FetchOptions): boolean {
    return !(card !== undefined && (card.typeId !== undefined || opts.skipTypeLookup === true));
  }

  private newForCacheApplies(
    mark: FetchMark,
    card: CardRecord | undefined,
    opts: FetchOptions,
  ): boolean {
    return this.reusable(mark, opts) && this.newCardNeeded(card, opts);
  }

  private instantiatePlaceholder(mark: MarkWithName, opts: FetchOptions): CardRecord {
    const newOpts = opts.new;
    const eager =
      opts.eagerCache === true && newOpts !== undefined && mark.name.isAbsolute;
    return newCardRecord(
      mark.name,
      eager ? { typeId: newOpts?.typeId, content: newOpts?.content } : {},
    );
  }

  private storeCard(card: CardRecord, opts: FetchOptions): void {
    if (card.uncacheable) return;
    this.writeToCache(card, opts.localOnly === true);
  }

  async isKnownByStructure(name: Nameish): Promise<boolean> {
    const lookup = this.virtualCardLookup;
    if (lookup === undefined) return false;
    const parsed = DeckoName.parse(name);
    if (!parsed.isCompound) return false;
    return (await lookup(parsed)) !== undefined;
  }

  private async results(
    card: CardRecord | undefined,
    mark: FetchMark,
    opts: FetchOptions,
  ): Promise<CardRecord | undefined> {
    if (card === undefined) return undefined;
    return isNewCard(card) ? await this.newResultCard(card, mark, opts) : this.finalizeResultCard(card);
  }

  private finalizeResultCard(card: CardRecord): CardRecord {
    return card;
  }

  private async newResultCard(
    card: CardRecord,
    mark: FetchMark,
    opts: FetchOptions,
  ): Promise<CardRecord | undefined> {
    const newOpts = opts.new;
    let effective: CardRecord = { ...card };
    if (newOpts !== undefined) {
      const markName = mark.kind === "name" ? mark.name : DeckoName.parse("");
      if (!this.quickRenew(effective, markName, newOpts, opts)) {
        effective = await this.renew(effective, markName, newOpts);
      }
    } else if (opts.skipVirtual === true) {
      return undefined;
    } else {
      this.assignName(effective, mark, opts);
    }
    this.finalizeResultCard(effective);
    if (newOpts !== undefined || isKnownCard(effective)) return effective;
    if (
      this.virtualCardLookup !== undefined &&
      effective.name !== undefined &&
      effective.name.isCompound
    ) {
      const virtual = await this.virtualCardLookup(effective.name);
      if (virtual !== undefined) {
        if (virtual.typeId !== undefined && effective.typeId === undefined) {
          effective.typeId = virtual.typeId;
        }
        effective.dbContent = virtual.templateContent;
        return effective;
      }
    }
    return undefined;
  }

  private quickRenew(
    card: CardRecord,
    mark: DeckoName,
    newOpts: NewCardOptions,
    opts: FetchOptions,
  ): boolean {
    if (Object.keys(newOpts).length === 0) {
      const requested = newOpts.name !== undefined ? DeckoName.parse(newOpts.name) : undefined;
      this.assignName(
        card,
        { kind: "name", name: requested !== undefined && requested.s !== "" ? requested : mark },
        opts,
      );
      return true;
    }
    if (this.typeChange(card, newOpts)) return false;
    if (this.nameChange(card, newOpts, mark)) return false;
    if (this.fancyRenew(newOpts)) return false;
    this.quickContent(card, newOpts);
    return true;
  }

  private async renew(card: CardRecord, mark: DeckoName, newOpts: NewCardOptions): Promise<CardRecord> {
    const requestedName =
      newOpts.name !== undefined ? DeckoName.parse(newOpts.name) : mark;
    const renewed: CardRecord = { ...card };
    if (requestedName.s !== (card.name?.s ?? "")) {
      renewed.name = requestedName;
      renewed.key = requestedName.key;
    }
    const content = this.assignableContent(card, newOpts);
    if (content !== undefined) renewed.dbContent = content;
    if (
      newOpts.typeId !== undefined ||
      newOpts.typeCode !== undefined ||
      newOpts.typeName !== undefined
    ) {
      renewed.typeId = await typeIdFromNewOpts(newOpts, this.codenames, this.lexicon);
    }
    return renewed;
  }

  private typeChange(card: CardRecord, newOpts: NewCardOptions): boolean {
    if (card.typeId === undefined) return true;
    return newOpts.typeId !== undefined && newOpts.typeId !== card.typeId;
  }

  private nameChange(card: CardRecord, newOpts: NewCardOptions, mark: DeckoName): boolean {
    if (newOpts.name === undefined) return false;
    const newName = DeckoName.parse(newOpts.name);
    if (newName.isRelative && mark.isAbsolute) return false;
    return newName.s !== (card.name?.s ?? "");
  }

  private fancyRenew(newOpts: NewCardOptions): boolean {
    const handled = new Set(["supercard", "name", "typeId", "typePreset", "typeCode", "typeName", "content", "defaultContent"]);
    return Object.keys(newOpts).some((key) => !handled.has(key));
  }

  private assignableContent(card: CardRecord, newOpts: NewCardOptions): string | undefined {
    if (newOpts.content !== undefined) return newOpts.content;
    const dbContent = card.dbContent ?? "";
    if (dbContent === "" && newOpts.defaultContent !== undefined) return newOpts.defaultContent;
    return undefined;
  }

  private quickContent(card: CardRecord, newOpts: NewCardOptions): void {
    const content = this.assignableContent(card, newOpts);
    if (content !== undefined) card.dbContent = content;
  }

  private assignName(card: CardRecord, mark: FetchMark, opts: FetchOptions): void {
    if (opts.localOnly === true) return;
    const requested = mark.kind === "name" ? mark.name : undefined;
    if (requested === undefined) return;
    if (requested.s === (card.name?.s ?? "")) return;
    card.name = requested;
    card.key = requested.key;
  }

  async fetchById(id: number, opts: FetchOptions = {}): Promise<CardRecord | undefined> {
    return this.fetchWithOptions([id], opts);
  }

  async fetchByKey(key: string, opts: FetchOptions = {}): Promise<CardRecord | undefined> {
    return this.fetchWithOptions([DeckoName.parse(key)], opts);
  }

  async fetchByName(
    name: string | DeckoName,
    opts: FetchOptions = {},
  ): Promise<CardRecord | undefined> {
    return this.fetchWithOptions([typeof name === "string" ? DeckoName.parse(name) : name], opts);
  }

  async bracket(...marks: readonly FetchArg[]): Promise<CardRecord | undefined> {
    return this.fetchWithOptions(marks, { skipVirtual: true });
  }

  async quickFetch(...marks: readonly FetchArg[]): Promise<CardRecord | undefined> {
    return this.fetchWithOptions(marks, { skipVirtual: true, skipModules: true });
  }

  async refreshCard(card: CardRecord, force = false): Promise<CardRecord | undefined> {
    if (!force) return card;
    if (card.id === undefined) return undefined;
    const { row } = await retrieveFromDb(
      this.driver,
      { kind: "id", id: card.id },
      { lookInTrash: false },
      this.lexicon,
    );
    return row === undefined ? undefined : await composeCardRecord(row, this.lexicon);
  }

  async standardUriFetch(
    params: { mark?: FetchArg; lookInTrash?: boolean; assign?: boolean },
    cardOpts: NewCardOptions,
  ): Promise<CardRecord | undefined> {
    const mark = params.mark ?? cardOpts.name;
    const card = await this.fetch(mark as FetchArg, {
      new: cardOpts,
      skipModules: true,
      lookInTrash: params.lookInTrash,
    });
    if (params.assign === true && card !== undefined && isRealCard(card)) {
      if (cardOpts.name !== undefined) {
        card.name = DeckoName.parse(cardOpts.name);
        card.key = card.name.key;
      }
      if (cardOpts.content !== undefined) card.dbContent = cardOpts.content;
      if (cardOpts.typeId !== undefined) card.typeId = cardOpts.typeId;
    }
    return card;
  }

  async cardish(mark: FetchArg): Promise<CardRecord | undefined> {
    if (isCardValue(mark)) return mark;
    return this.fetchWithOptions([mark], { new: {} });
  }

  async cardId(
    cardish: number | CardRecord | string | DeckoName | { codename: string },
  ): Promise<number | undefined> {
    if (typeof cardish === "number") return cardish;
    if (cardish instanceof DeckoName) return this.lexicon.id(cardish);
    if (typeof cardish === "string") {
      const id = await this.lexicon.id(cardish);
      if (id !== undefined) return id;
      return (await this.quickFetch(cardish))?.id;
    }
    if ("typeId" in cardish) return cardish.id;
    return this.codenames.id((cardish as { codename: string }).codename);
  }

  async fetchTypeId(...marks: readonly FetchArg[]): Promise<number | undefined> {
    return (await this.fetchWithOptions(marks, { skipModules: true }))?.typeId;
  }

  writeToCache(card: CardRecord, localOnly = false): void {
    if (card.key === undefined) return;
    if (localOnly) {
      this.writeToTempCache(card);
    } else if (this.cardCache) {
      this.cardCache.write(card.key, card);
    }
  }

  writeToTempCache(card: CardRecord): void {
    if (card.key === undefined) return;
    this.cardCache.temp.write(card.key, card);
  }

  pinStaleCard(card: CardRecord): void {
    if (card.key === undefined || card.key === "") return;
    this.stalenessKeeper.set(card.key, card);
  }

  peekStaleCard(key: string): CardRecord | undefined {
    return this.stalenessKeeper.get(key);
  }

  expireName(name: Nameish): void {
    const key = DeckoName.parse(name ?? "").key;
    const card = this.cardCache.read(key) ?? this.stalenessKeeper.get(key);
    if (isCardValue(card)) this.expireCard(card);
  }

  expireCard(card: CardRecord): void {
    this.expireNames(card);
    this.expireId(card);
    this.expireLeft(card);
  }

  private expireNames(card: CardRecord): void {
    const versions = [card.name, card.nameBeforeAct];
    const seen = new Set<string>();
    for (const version of versions) {
      if (version === undefined) continue;
      const key = version.key;
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      this.cardCache.delete(key);
      this.stalenessKeeper.delete(key);
    }
  }

  private expireId(card: CardRecord): void {
    const idStr = idString(card);
    if (idStr !== undefined) this.cardCache.delete(idStr);
  }

  private expireLeft(card: CardRecord): void {
    if (card.name === undefined || !card.name.isCompound) return;
    const leftKey = card.name.leftName?.key;
    if (leftKey === undefined) return;
    const left = this.cardCache.read(leftKey);
    if (isCardValue(left)) this.expireCard(left);
  }

  holdTemporaryCaches(): () => void {
    const releaseCards = this.cardCache.temp.hold();
    const releaseLexicon = this.lexiconCache.temp.hold();
    return () => {
      releaseCards();
      releaseLexicon();
    };
  }

  purgeNegatives(): number {
    return (
      this.cardCache.temp.purge((_k, v) => !isCardValue(v) || v.id === undefined) +
      this.lexiconCache.temp.purge((_k, v) => v === undefined || v === null)
    );
  }

  resetCaches(): void {
    this.cardCache.reset();
    this.lexiconCache.reset();
    this.codenames.resetCache();
    this.replayRouter.disarmRenderPlan();
  }

  async reprimeBootState(): Promise<void> {
    await this.codenames.ensureLoaded();
    this.installNameEnvironment();
  }

  private writeLexiconTemp(card: CardRecord): void {
    if (card.id === undefined) return;
    let lex: string | [number, number] | undefined;
    if (card.leftId !== undefined && card.rightId !== undefined) {
      lex = [card.leftId, card.rightId];
    } else if (card.name !== undefined) {
      lex = card.name.s;
    }
    this.lexicon.writeTemp(card.id, card.name ?? undefined, lex);
  }

  installNameEnvironment(): void {
    const engine = this;
    const environment: NameEnvironment = {
      ...(getNameEnvironment()?.mainName !== undefined
        ? { mainName: getNameEnvironment()!.mainName }
        : {}),
      session: "Anonymous",
      lexicon: {
        name(id: number): string | undefined {
          return engine.peekLexiconName(id) ??
            engine.lexicon.peekDurableName(id) ??
            engine.codenames.peekRegisteredName(id);
        },
        id(key: string): number | undefined {
          return engine.peekLexiconId(key);
        },
      },
      codename: {
        id(codename: string): number | undefined {
          return engine.codenames.peekId(codename);
        },
        name(codename: string): string | undefined {
          return engine.codenames.peekName(codename);
        },
        nameForId(id: number): string | undefined {
          return engine.codenames.peekNameForId(id);
        },
      },
    };
    setNameEnvironment(environment);
  }

  async warmLexicon(ids: readonly number[]): Promise<void> {
    for (const id of ids) await this.lexicon.name(id);
    await this.codenames.ensureLoaded();
  }

  peekNameForId(id: number): string | undefined {
    return this.peekLexiconName(id) ?? this.lexicon.peekDurableName(id) ?? this.codenames.peekRegisteredName(id);
  }

  private peekLexiconName(id: number): string | undefined {
    const lex = this.peekLex(id);
    if (lex === undefined) return undefined;
    if (lex instanceof DeckoName) {
      return lex.s === "" ? undefined : lex.s;
    }
    if (typeof lex === "string") {
      const name = DeckoName.parse(lex);
      return name.s === "" ? undefined : name.s;
    }
    const sides: string[] = [];
    for (const sideId of lex) {
      if (sideId === undefined) return undefined;
      const side = this.peekLexiconName(sideId);
      if (side === undefined) return undefined;
      sides.push(side);
    }
    return sides.join(DeckoName.JOINT);
  }

  private peekLexiconId(key: string): number | undefined {
    const parsed = DeckoName.parse(key);
    const value = this.readLexiconCache(lexiconCacheKey(parsed.s));
    if (typeof value === "number") return value;
    return this.lexicon.peekDurableId(parsed.s);
  }

  private peekLex(id: number): string | DeckoName | [number, number] | undefined {
    const value = this.readLexiconCache(String(id));
    if (typeof value === "string") return value;
    if (value instanceof DeckoName) return value;
    if (Array.isArray(value) && value.length === 2) return value as [number, number];
    return undefined;
  }

  private readLexiconCache(key: string): unknown {
    if (this.lexiconCache.temp.exist(key)) return this.lexiconCache.temp.read(key);
    return this.lexiconCache.shared ? this.lexiconCache.shared.read(key) : undefined;
  }

  peekCodehash(): { c2i: Map<string, number>; i2c: Map<number, string> } | undefined {
    return this.cardCache.read(CODENAMES_CACHE_KEY) as
      | { c2i: Map<string, number>; i2c: Map<number, string> }
      | undefined;
  }
}

interface MarkWithName extends Extract<FetchMark, { kind: "name" }> {}

export async function fetchFromCast(
  engine: FetchEngine,
  cast: FetchCast,
): Promise<CardRecord | undefined> {
  if (cast.id !== undefined && cast.id !== null) return engine.fetchById(Number(cast.id));
  return engine.fetch(cast.name as FetchArg, { new: cast });
}

export interface FetchCast extends NewCardOptions {
  id?: number | string | null;
  name?: Nameish;
}

export async function fetchName(
  engine: FetchEngine,
  ...marks: readonly FetchArg[]
): Promise<DeckoName | undefined> {
  const card = await engine.quickFetch(...marks);
  return card?.name;
}

export async function typeIdFromNewOpts(
  newOpts: NewCardOptions,
  codenames: DbCodenameRegistry,
  lexicon: DbLexicon,
): Promise<number | undefined> {
  if (newOpts.typeId !== undefined) return newOpts.typeId;
  if (newOpts.typeCode !== undefined) return codenames.id(newOpts.typeCode);
  const typeName = newOpts.typeName;
  if (typeof typeName === "string" || typeName instanceof DeckoName) {
    return lexicon.id(typeName);
  }
  return undefined;
}

export function isCardValue(value: unknown): value is CardRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "key" in value &&
    "typeId" in value &&
    "trash" in value &&
    !(value instanceof DeckoName)
  );
}

function splitArgs(args: readonly (FetchArg | FetchOptions)[]): {
  marks: FetchArg[];
  opts: FetchOptions;
} {
  if (args.length > 0) {
    const last = args[args.length - 1];
    if (isOptionsObject(last)) {
      return { marks: args.slice(0, -1) as FetchArg[], opts: last as FetchOptions };
    }
  }
  return { marks: args as FetchArg[], opts: {} };
}

function isOptionsObject(value: unknown): value is FetchOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof DeckoName) &&
    !("codename" in value) &&
    !("key" in value)
  );
}
