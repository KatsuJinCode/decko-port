import {
  onDeckInflectionsChanged,
  pluralize,
  regexpQuote,
  rubyCapitalize,
  rubySucc,
  singularize,
  titleize,
  underscore,
} from "./name/inflect.js";
import { decodeHtmlEntities } from "./name/entities.js";
import {
  CodenameNotFoundError,
  NameNotFoundError,
  UnsupportedIdentifierError,
} from "./name/errors.js";
import { getNameEnvironment } from "./name/environment.js";
import { currentRequestContext, type NameScopeState } from "./request-context.js";

export type Nameish = DeckoName | string | number | null | undefined;

export interface CodenameMark {
  readonly codename: string;
}

export type Cardish =
  | Nameish
  | CodenameMark
  | readonly Cardish[];

const RELATIVE_REGEXP_SOURCE = "\\b_(?:left|right|whole|self|user|main|\\d+|L*R?)\\b";
const RELATIVE_REGEXP = new RegExp(RELATIVE_REGEXP_SOURCE);
const RELATIVE_REGEXP_GLOBAL = new RegExp(RELATIVE_REGEXP_SOURCE, "g");
const RELATIVE_FRAGMENT_REGEXP = new RegExp(`^${RELATIVE_REGEXP_SOURCE}$`);

const RUBY_WHITESPACE = " \t\n\v\f\r";
const RUBY_SPLIT_AROUND_JOINT = new RegExp(`[${RUBY_WHITESPACE}]*\\+[${RUBY_WHITESPACE}]*`);
const RUBY_BLANK = new RegExp(`^[${RUBY_WHITESPACE}]*$`);
const RUBY_EDGE_WHITESPACE = new RegExp(`^[${RUBY_WHITESPACE}]+|[${RUBY_WHITESPACE}]+$`, "g");
const RUBY_STRIP_EDGES = new RegExp(`^[${RUBY_WHITESPACE}\0]+|[${RUBY_WHITESPACE}\0]+$`, "g");
const URL_KEY_MEMO = new WeakMap<object, string>();

const ID_MARK_REGEXP = /^~(\d+)$/;
const CODENAME_MARK_REGEXP = /^:(\w+)$/;

const OK_FOR_KEY_CLASS = "\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}";
const NOT_OK_FOR_KEY = new RegExp(`[^${OK_FOR_KEY_CLASS}\\*]+`, "gu");

function rubyStrip(str: string): string {
  return str.replace(RUBY_STRIP_EDGES, "");
}

function rubyLength(str: string): number {
  return Array.from(str).length;
}

function rubyBlank(value: string | undefined | null): boolean {
  return value == null || RUBY_BLANK.test(value);
}

function stableKey(word: string): string {
  const keyOne = singularize(word);
  const keyTwo = singularize(keyOne);
  if (keyOne === keyTwo) return keyOne;
  return DeckoName.stabilize ? stableKey(keyTwo) : word;
}

const simpleKeyMemo = new Map<string, string>();
const SIMPLE_KEY_MEMO_LIMIT = 100_000;
const BASE_PARSE_CACHE_LIMIT = 50_000;
onDeckInflectionsChanged(() => simpleKeyMemo.clear());

function simpleKey(body: string): string {
  if (body === "") return "";
  const known = simpleKeyMemo.get(body);
  if (known !== undefined) return known;
  if (simpleKeyMemo.size >= SIMPLE_KEY_MEMO_LIMIT) simpleKeyMemo.clear();
  const key = simpleKeyUncached(body);
  simpleKeyMemo.set(body, key);
  return key;
}

function simpleKeyUncached(body: string): string {
  return underscore(body)
    .replace(NOT_OK_FOR_KEY, "_")
    .split(/_+/)
    .filter((piece) => piece !== "")
    .map(stableKey)
    .join("_");
}

export class DeckoName {
  static readonly JOINT = "+";

  static stabilize = false;

  private static cache = new Map<string, DeckoName>();

  static {
    onDeckInflectionsChanged(() => DeckoName.clearParseMemo());
  }

  static bannedCharacters: readonly string[] = [];

  readonly s: string;

  readonly key: string;

  readonly decoded: string;

  private readonly nameParts: readonly DeckoName[];
  private readonly simpleFlag: boolean;

  private constructor(raw: string) {
    this.s = rubyStrip(raw);
    this.decoded = decodeHtmlEntities(this.s);

    if (this.s === "") {
      this.nameParts = [];
      this.simpleFlag = true;
    } else {
      const split = DeckoName.splitParts(this.s);
      this.simpleFlag = split.length <= 1;
      this.nameParts = this.simpleFlag ? [this] : split.map((part) => DeckoName.baseParse(part));
    }

    this.key = this.simpleFlag
      ? simpleKey(this.decoded)
      : this.nameParts.map((part) => part.key).join(DeckoName.JOINT);

    this.freeze();
  }

  private freeze(): void {
    Object.freeze(this);
  }

  static parse(obj: string | number | null | undefined | DeckoName): DeckoName {
    if (obj instanceof DeckoName) return obj;
    let str = obj == null ? "" : String(obj);
    const scope = DeckoName.scopeState();
    const parseMemo = scope.parseMemo as Map<string, DeckoName> | undefined;
    if (parseMemo !== undefined) {
      const memo = parseMemo.get(str);
      if (memo !== undefined) return memo;
      if (!str.includes("~") && !str.includes(":")) {
        const parsed = DeckoName.parseUncached(str);
        parseMemo.set(str, parsed);
        return parsed;
      }
    }
    const markMemo = scope.markMemo as Map<string, DeckoName> | undefined;
    if (markMemo !== undefined) {
      const marked = markMemo.get(str);
      if (marked !== undefined) return marked;
      const parsed = DeckoName.parseUncached(str);
      markMemo.set(str, parsed);
      return parsed;
    }
    return DeckoName.parseUncached(str);
  }

  private static readonly globalScope: NameScopeState = { depth: 0 };
  private static scopeState(): NameScopeState {
    return currentRequestContext()?.nameScope ?? DeckoName.globalScope;
  }

  static beginRequestScope(): void {
    const sc = DeckoName.scopeState();
    sc.depth += 1;
    if (sc.depth > 1) return;
    sc.parseMemo?.clear();
    sc.markMemo?.clear();
    sc.markMemo = new Map();
    sc.parseMemo = new Map();
    sc.scopedMemos = new WeakMap();
  }

  static endRequestScope(): void {
    const sc = DeckoName.scopeState();
    if (sc.depth === 0) return;
    sc.depth -= 1;
    if (sc.depth > 0) return;
    sc.markMemo = undefined;
    sc.parseMemo = undefined;
    sc.scopedMemos = undefined;
  }

  static requestMemo<V>(owner: object): Map<string, V> | undefined {
    const memos = DeckoName.scopeState().scopedMemos;
    if (memos === undefined) return undefined;
    let memo = memos.get(owner);
    if (memo === undefined) {
      memo = new Map();
      memos.set(owner, memo);
    }
    return memo as Map<string, V>;
  }

  static requestScopeIsClosed(): boolean {
    const sc = DeckoName.scopeState();
    return sc.depth === 0 && sc.parseMemo === undefined && sc.markMemo === undefined && sc.scopedMemos === undefined;
  }

  static clearParseMemo(): void {
    simpleKeyMemo.clear();
    const sc = DeckoName.scopeState();
    sc.parseMemo?.clear();
    DeckoName.cache.clear();
    DeckoName.leftNameMemo = new WeakMap();
    sc.markMemo?.clear();
  }

  private static parseUncached(str: string): DeckoName {
    if (str.includes(DeckoName.JOINT)) {
      const joined = DeckoName.splitParts(str)
        .map((part) => DeckoName.parse(part).s)
        .join(DeckoName.JOINT);
      return DeckoName.baseParse(joined);
    }

    const id = DeckoName.idFromString(str);
    if (id !== undefined) {
      const lexiconName = getNameEnvironment()?.lexicon?.name(id);
      if (rubyBlank(lexiconName)) DeckoName.badMark(str);
      return DeckoName.baseParse(lexiconName as string);
    }
    return DeckoName.baseParse(str);
  }

  private static baseParse(raw: string): DeckoName {
    const cached = DeckoName.cache.get(raw);
    if (cached !== undefined) return cached;
    const name = new DeckoName(raw);
    if (DeckoName.cache.size >= BASE_PARSE_CACHE_LIMIT) DeckoName.cache.clear();
    DeckoName.cache.set(raw, name);
    return name;
  }

  static of(...cardish: readonly Cardish[]): DeckoName {
    const single: Cardish = cardish.length <= 1 ? (cardish[0] ?? null) : cardish;
    const resolved = DeckoName.fromCardish(single);
    if (resolved === undefined) {
      throw new UnsupportedIdentifierError(
        `${describeCardish(single)} not supported as name identifier`,
      );
    }
    return resolved;
  }

  private static fromCardish(cardish: Cardish): DeckoName | undefined {
    if (cardish == null) return DeckoName.parse("");
    if (cardish instanceof DeckoName) return cardish;
    if (typeof cardish === "number") {
      if (!Number.isInteger(cardish)) return undefined;
      const lexiconName = getNameEnvironment()?.lexicon?.name(cardish);
      return lexiconName === undefined ? undefined : DeckoName.baseParse(lexiconName);
    }
    if (typeof cardish === "string") return DeckoName.parse(cardish);
    if (Array.isArray(cardish)) return DeckoName.compose(cardish);
    if (typeof cardish === "object" && "codename" in cardish) {
      const codenameName = getNameEnvironment()?.codename?.name(cardish.codename);
      if (codenameName === undefined) {
        throw new CodenameNotFoundError(`unknown codename: ${cardish.codename}`);
      }
      return DeckoName.baseParse(codenameName);
    }
    return undefined;
  }

  static compose(parts: readonly Cardish[]): DeckoName {
    const resolved = flattenCardish(parts).map((part) => DeckoName.of(part));
    return DeckoName.baseParse(resolved.map((part) => part.s).join(DeckoName.JOINT));
  }

  static splitParts(str: string): string[] {
    return str.split(RUBY_SPLIT_AROUND_JOINT);
  }

  static idFromString(str: string): number | undefined {
    const idMatch = ID_MARK_REGEXP.exec(str);
    if (idMatch !== null) return parseInt(idMatch[1] as string, 10);
    const codenameMatch = CODENAME_MARK_REGEXP.exec(str);
    if (codenameMatch !== null) {
      const codename = codenameMatch[1] as string;
      const id = getNameEnvironment()?.codename?.id(codename);
      if (id === undefined) {
        throw new CodenameNotFoundError(`codename doesn't exist: ${codename}`);
      }
      return id;
    }
    return undefined;
  }

  static idFromStringStrict(str: string): number | undefined {
    const id = DeckoName.idFromString(str);
    if (id === undefined) return undefined;
    if (rubyBlank(getNameEnvironment()?.lexicon?.name(id))) DeckoName.badMark(str);
    return id;
  }

  private static badMark(str: string): never {
    if (ID_MARK_REGEXP.test(str)) {
      throw new NameNotFoundError(`id doesn't exist: ${(ID_MARK_REGEXP.exec(str) as RegExpExecArray)[1]}`);
    }
    if (CODENAME_MARK_REGEXP.test(str)) {
      throw new CodenameNotFoundError(
        `codename doesn't exist: ${(CODENAME_MARK_REGEXP.exec(str) as RegExpExecArray)[1]}`,
      );
    }
    throw new UnsupportedIdentifierError(`invalid mark: ${str}`);
  }

  toString(): string {
    return this.s;
  }

  toName(): DeckoName {
    return this;
  }

  get numParts(): number {
    return this.parts.length;
  }

  get isSimple(): boolean {
    return this.simpleFlag;
  }

  equals(other: Nameish): boolean {
    if (other instanceof DeckoName) return this.key === other.key;
    return this.key === DeckoName.parse(other).key;
  }

  get(start: number, length?: number): DeckoName {
    const len = this.nameParts.length;
    const from = start < 0 ? len + start : start;
    if (length === undefined) {
      return from >= 0 && from < len ? (this.nameParts[from] as DeckoName) : DeckoName.parse("");
    }
    if (length < 0 || from < 0 || from > len) return DeckoName.parse("");
    const count = Math.min(length, len - from);
    return DeckoName.baseParse(this.sliceParts(from, count));
  }

  getRange(start: number, endInclusive: number): DeckoName {
    const len = this.nameParts.length;
    const from = start < 0 ? len + start : start;
    const to = endInclusive < 0 ? len + endInclusive : endInclusive;
    if (from < 0 || to < 0 || from > to || from >= len) return DeckoName.parse("");
    return DeckoName.baseParse(this.sliceParts(from, to - from + 1));
  }

  private sliceParts(from: number, count: number): string {
    return this.nameParts
      .slice(from, from + count)
      .map((part) => part.s)
      .join(DeckoName.JOINT);
  }

  get parts(): string[] {
    return this.nameParts.map((part) => part.s);
  }

  get partKeys(): string[] {
    return this.nameParts.map((part) => part.key);
  }

  get partNames(): readonly DeckoName[] {
    return this.nameParts;
  }

  get left(): string | undefined {
    return this.leftName?.s;
  }

  get leftKey(): string | undefined {
    return this.leftName?.key;
  }

  get leftName(): DeckoName | undefined {
    if (this.isSimple) return undefined;
    const memo = DeckoName.leftNameMemo.get(this);
    if (memo !== undefined) return memo;
    const left = this.getRange(0, -2);
    DeckoName.leftNameMemo.set(this, left);
    return left;
  }

  private static leftNameMemo = new WeakMap<DeckoName, DeckoName>();

  get parents(): string[] {
    return this.parentNames.map((parent) => parent.s);
  }

  get parentKeys(): string[] {
    return this.parentNames.map((parent) => parent.key);
  }

  get parentNames(): DeckoName[] {
    if (this.isSimple) return [];
    const left = this.leftName;
    const right = this.rightName as DeckoName;
    return left === undefined ? [right] : [left, right];
  }

  get trunk(): string {
    return this.trunkName.s;
  }

  get trunkKey(): string {
    return this.trunkName.key;
  }

  get trunkName(): DeckoName {
    return this.isSimple ? this : (this.leftName as DeckoName);
  }

  get tag(): string {
    return this.tagName.s;
  }

  get tagKey(): string {
    return this.tagName.key;
  }

  get tagName(): DeckoName {
    return this.isSimple ? this : (this.rightName as DeckoName);
  }

  get right(): string | undefined {
    return this.rightName?.s;
  }

  get rightKey(): string | undefined {
    return this.rightName?.key;
  }

  get rightName(): DeckoName | undefined {
    if (this.isSimple) return undefined;
    return this.nameParts[this.nameParts.length - 1] ?? undefined;
  }

  get pieces(): string[] {
    if (this.isSimple) return [this.s];
    const compound: string[] = [];
    const split = this.parts;
    let left = split[0] as string;
    for (let i = 1; i < split.length; i++) {
      left = [left, split[i]].join(DeckoName.JOINT);
      compound.push(left);
    }
    return [...split, ...compound];
  }

  get pieceNames(): DeckoName[] {
    return this.pieces.map((piece) => DeckoName.parse(piece));
  }

  get ancestors(): string[] {
    return this.pieces.filter((piece) => !this.equals(piece));
  }

  get ancestorPieces(): DeckoName[] {
    return this.ancestors.map((ancestor) => DeckoName.parse(ancestor));
  }

  get isCompound(): boolean {
    return !this.isSimple;
  }

  get isValid(): boolean {
    if (DeckoName.bannedCharacters.length === 0) return true;
    const banned = [...DeckoName.bannedCharacters, DeckoName.JOINT]
      .map((c) => regexpQuote(c))
      .join("");
    const bannedRe = new RegExp(`[${banned}]`);
    return !this.parts.some((part) => bannedRe.test(part));
  }

  get startsWithJoint(): boolean {
    return this.isCompound && this.parts[0] === "";
  }

  startsWithParts(...prefix: readonly Nameish[]): boolean {
    const startName = DeckoName.compose(prefix.map((p) => p ?? ""));
    return startName.equals(this.get(0, startName.numParts));
  }

  endsWithParts(...suffix: readonly Nameish[]): boolean {
    const endName = DeckoName.compose(suffix.map((p) => p ?? ""));
    return endName.equals(this.getRange(-endName.numParts, -1));
  }

  includes(subname: Nameish): boolean {
    const subkey = DeckoName.parse(subname ?? "").key;
    const escaped = regexpQuote(subkey);
    return new RegExp(`(^|\\+)${escaped}($|\\+)`).test(this.key);
  }

  get isStar(): boolean {
    return this.isSimple && this.s.charAt(0) === "*";
  }

  get isRStar(): boolean {
    return this.right !== undefined && this.right.charAt(0) === "*";
  }

  get urlKey(): string {
    const known = URL_KEY_MEMO.get(this);
    if (known !== undefined) return known;
    const key = this.nameParts
      .map((part) => {
        const stripped = decodeHtmlEntities(part.s)
          .replace(NOT_OK_FOR_KEY, " ")
          .replace(RUBY_EDGE_WHITESPACE, "");
        return stripped.replace(/[ \t\r\n\f\v_]+/g, "_");
      })
      .join(DeckoName.JOINT);
    URL_KEY_MEMO.set(this, key);
    return key;
  }

  get safeKey(): string {
    return this.key.replace(/\*/g, "X").split(DeckoName.JOINT).join("-");
  }

  get stripped(): DeckoName {
    return DeckoName.parse(this.s.replace(RELATIVE_REGEXP_GLOBAL, ""));
  }

  get fullyStripped(): DeckoName {
    return DeckoName.compose(this.stripped.parts.filter((part) => !rubyBlank(part)));
  }

  childOf(context: Nameish): boolean {
    if (!this.isCompound) return false;
    const contextName = DeckoName.parse(context ?? "");
    return contextName !== undefined && this.absoluteName(context).parentKeys.includes(contextName.key);
  }

  get isRelative(): boolean {
    return this.startsWithJoint || RELATIVE_REGEXP.test(this.s);
  }

  get isSimpleRelative(): boolean {
    return this.startsWithJoint && !RELATIVE_REGEXP.test(this.s);
  }

  get isRelativeFragment(): boolean {
    return RELATIVE_FRAGMENT_REGEXP.test(this.s);
  }

  get isAbsolute(): boolean {
    return !this.isRelative;
  }

  from(...from: readonly Nameish[]): string {
    return this.nameFrom(...from).s;
  }

  nameFrom(...from: readonly Nameish[]): DeckoName {
    const compactFrom = from.filter((f): f is Exclude<Nameish, null | undefined> => f != null);
    if (compactFrom.length === 0) return this;

    const remaining = this.partsMinus(
      DeckoName.compose(compactFrom).partKeys,
    );
    if (remaining.every((part) => part === null)) return this;
    if (nameArraysEqual(remaining, this.parts)) return this;

    const compacted = remaining.filter((part): part is string => part !== null);
    const compressed = DeckoName.baseParse(
      [null, ...compacted].join(DeckoName.JOINT),
    );
    return this.key === compressed.absoluteName(DeckoName.compose(compactFrom)).key
      ? compressed
      : this;
  }

  absolute(context?: Nameish): string {
    const contextName = DeckoName.parse(context ?? "");
    const memo = DeckoName.requestMemo<string>(ABSOLUTE_MEMO);
    if (memo === undefined || this.parts.some((part) => ENV_PART.test(part))) {
      return this.absoluteUncached(contextName);
    }
    const memoKey = `${this.s}\n${contextName.s}`;
    const hit = memo.get(memoKey);
    if (hit !== undefined) return hit;
    const resolved = this.absoluteUncached(contextName);
    memo.set(memoKey, resolved);
    return resolved;
  }

  private absoluteUncached(contextName: DeckoName): string {
    const newParts = this.parts.map((part) =>
      absolutizeContextualPart(part, contextName),
    );
    if (newParts.length === 0) return "";
    absolutizeExtremes(newParts, contextName);
    return newParts.join(DeckoName.JOINT);
  }

  absoluteName(context?: Nameish): DeckoName {
    return DeckoName.parse(this.absolute(context));
  }

  nthLeftName(n: number): DeckoName {
    if (n >= rubyLength(this.s)) {
      return DeckoName.parse(this.parts[0] ?? "");
    }
    const count = this.nameParts.length - n;
    return count > 0
      ? DeckoName.baseParse(this.sliceParts(0, count))
      : DeckoName.parse("");
  }

  private partsMinus(keysToIgnore: readonly string[]): (string | null)[] {
    return this.parts.map((part) => {
      if (part === "") return null;
      if (/^_/.test(part)) return null;
      if (keysToIgnore.includes(DeckoName.parse(part).key)) return null;
      return part;
    });
  }

  field(tag: string | number): string {
    return this.fieldName(tag).s;
  }

  fieldName(tag: string | number): DeckoName;
  fieldName(tag: Cardish): DeckoName;
  fieldName(tag: Cardish): DeckoName {
    if (
      typeof tag === "object" &&
      tag !== null &&
      !Array.isArray(tag) &&
      !(tag instanceof DeckoName) &&
      "codename" in tag
    ) {
      return DeckoName.compose([this, tag]);
    }
    const tagStr = String(tag);
    const stripped = tagStr.charAt(0) === "+" ? tagStr.slice(1) : tagStr;
    return DeckoName.compose([this, stripped]);
  }

  fieldOf(context?: string | null): boolean {
    if (!this.isCompound) return false;
    if (!rubyBlank(context)) {
      const contextName = DeckoName.parse(context);
      return this.absoluteName(context).leftName?.key === contextName.key;
    }
    return /^[ \t\r\n\f\v]*\+[^+]+$/.test(this.s);
  }

  get fieldOnly(): boolean {
    if (!this.isRelative) return false;
    const firstNonBlank = this.stripped.parts.find((part) => !rubyBlank(part));
    return firstNonBlank === this.parts[this.parts.length - 1];
  }

  relativeFieldName(tag: string | number): DeckoName {
    return this.fieldName(tag).nameFrom(this);
  }

  withPartAt(index: number, value: Nameish): DeckoName {
    const parts = [...this.parts];
    const at = index < 0 ? parts.length + index : index;
    parts[at] = DeckoName.parse(value ?? "").s;
    return DeckoName.baseParse(parts.join(DeckoName.JOINT));
  }

  append(value: Nameish): DeckoName {
    return DeckoName.baseParse(
      [...this.parts, DeckoName.parse(value ?? "").s].join(DeckoName.JOINT),
    );
  }

  swap(oldValue: Nameish, newValue: Nameish): DeckoName {
    const oldName = DeckoName.parse(oldValue ?? "");
    const newName = DeckoName.parse(newValue ?? "");
    if (oldName.numParts > this.numParts) return this;
    if (oldName.isSimple) {
      return DeckoName.baseParse(
        this.parts
          .map((part) => (oldName.equals(part) ? newName.s : part))
          .join(DeckoName.JOINT),
      );
    }
    if (this.includes(oldName)) {
      return DeckoName.baseParse(this.swapAllSubsequences(oldName, newName).join(DeckoName.JOINT));
    }
    return this;
  }

  get prependJoint(): string {
    return this.s.startsWith(DeckoName.JOINT) ? this.s : DeckoName.JOINT + this.s;
  }

  subIn(str: string, withValue: Nameish): string {
    const withName = DeckoName.parse(withValue ?? "").s;
    let result = str;
    for (const caseMethod of ["capitalize", "downcase"] as const) {
      for (const inflectMethod of ["pluralize", "singularize"] as const) {
        const from = applyCaseAndInflection(this.s, caseMethod, inflectMethod);
        const to = applyCaseAndInflection(withName, caseMethod, inflectMethod);
        result = result.replace(
          new RegExp(`\\b${regexpQuote(from)}\\b`, "g"),
          to,
        );
      }
    }
    return result;
  }

  private swapAllSubsequences(oldName: DeckoName, newName: DeckoName): string[] {
    const result: string[] = [];
    const oldKeys = oldName.partKeys;
    const allKeys = this.partKeys;
    let i = 0;
    while (i <= this.numParts - oldName.numParts) {
      if (
        oldKeys[0] === allKeys[i] &&
        arraysEqual(oldKeys, allKeys.slice(i, i + oldName.numParts))
      ) {
        result.push(...newName.parts);
        i += oldName.numParts;
      } else {
        result.push(this.parts[i] as string);
        i += 1;
      }
    }
    if (i < this.numParts) result.push(...this.parts.slice(i));
    return result;
  }

  vary(variants: string): DeckoName {
    const result = variants
      .split(/[ \t\r\n\f\v,]+/)
      .filter((variant) => variant !== "")
      .reduce((name, variant) => applyVariant(name, variant), this.s);
    return DeckoName.baseParse(result);
  }

  get standard(): DeckoName {
    if (this.isSimple) {
      const id = getNameEnvironment()?.lexicon?.id(this.key);
      const std = id === undefined ? undefined : getNameEnvironment()?.lexicon?.name(id);
      return rubyBlank(std) ? this : DeckoName.baseParse(std as string);
    }
    return DeckoName.compose(this.parts.map((part) => DeckoName.parse(part).standard));
  }

  get cardId(): number | undefined {
    return getNameEnvironment()?.lexicon?.id(this.key);
  }

  get codename(): string | undefined {
    const id = this.cardId;
    if (id === undefined) return undefined;
    return getNameEnvironment()?.codename?.nameForId(id);
  }

  get codenameOrString(): string {
    return this.codename ?? this.s;
  }

  succ(): DeckoName {
    return DeckoName.baseParse(rubySucc(this.s));
  }
}

const ABSOLUTE_MEMO = {};
const ENV_PART = /^_(user|main)$/i;

function absolutizeContextualPart(part: string, context: DeckoName): string {
  let resolved: string | undefined;
  if (/^_user$/i.test(part)) {
    resolved = getNameEnvironment()?.session ?? part;
  } else if (/^_main$/i.test(part)) {
    resolved = getNameEnvironment()?.mainName;
  } else if (/^(_self|_whole|_)$/i.test(part)) {
    resolved = context.s;
  } else if (/^_left$/i.test(part)) {
    resolved = context.trunk;
  } else if (/^_right$/i.test(part)) {
    resolved = context.tag;
  } else if (/^_(\d+)$/i.test(part)) {
    const pos = parseInt((/^_(\d+)$/i.exec(part) as RegExpExecArray)[1] as string, 10);
    resolved = ordinalPart(pos, context);
  } else if (/^_(L*)(R?)$/i.test(part)) {
    const match = /^_(L*)(R?)$/i.exec(part) as RegExpExecArray;
    resolved = partmapPart((match[1] as string).length, (match[2] as string) !== "", context);
  } else {
    resolved = part;
  }
  return rubyStrip(resolved ?? "");
}

function ordinalPart(pos: number, context: DeckoName): string | undefined {
  const clamped = pos > rubyLength(context.s) ? rubyLength(context.s) : pos;
  return context.parts[clamped - 1];
}

function partmapPart(leftCount: number, withRight: boolean, context: DeckoName): string {
  const leftPart = context.nthLeftName(leftCount);
  return withRight ? leftPart.tag : leftPart.s;
}

function absolutizeExtremes(newParts: string[], context: DeckoName): void {
  for (const index of [0, newParts.length - 1]) {
    const extreme = newParts[index];
    if (rubyBlank(extreme)) {
      const guarded =
        index === 0
          ? DeckoName.parse(newParts.join(DeckoName.JOINT)).startsWithParts(context.s)
          : DeckoName.parse(newParts.join(DeckoName.JOINT)).endsWithParts(context.s);
      if (!guarded) newParts[index] = context.s;
    }
  }
}

function applyVariant(name: string, variant: string): string {
  switch (variant) {
    case "capitalized":
    case "capitalize":
      return rubyCapitalize(name);
    case "singular":
    case "singularize":
      return singularize(name);
    case "plural":
    case "pluralize":
      return pluralize(name);
    case "title":
    case "titleize":
      return titleize(name);
    case "downcase":
      return name.toLowerCase();
    case "upcase":
      return name.toUpperCase();
    case "swapcase":
      return Array.from(name)
        .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
        .join("");
    case "reverse":
      return Array.from(name).reverse().join("");
    case "succ":
      return rubySucc(name);
    default:
      return name;
  }
}

function applyCaseAndInflection(
  name: string,
  caseMethod: "capitalize" | "downcase",
  inflectMethod: "pluralize" | "singularize",
): string {
  const cased = caseMethod === "capitalize" ? rubyCapitalize(name) : name.toLowerCase();
  return inflectMethod === "pluralize" ? pluralize(cased) : singularize(cased);
}

function nameArraysEqual(left: readonly (string | null)[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, i) => part === right[i]);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, i) => part === right[i]);
}

function flattenCardish(parts: readonly Cardish[]): Exclude<Cardish, readonly Cardish[]>[] {
  const out: Exclude<Cardish, readonly Cardish[]>[] = [];
  for (const part of parts) {
    if (Array.isArray(part)) {
      out.push(...(flattenCardish(part) as Exclude<Cardish, readonly Cardish[]>[]));
    } else {
      out.push(part as Exclude<Cardish, readonly Cardish[]>);
    }
  }
  return out;
}

function describeCardish(cardish: Cardish): string {
  if (cardish === null) return "NilClass";
  if (typeof cardish === "boolean") return "Boolean";
  if (typeof cardish === "number") return "Integer";
  if (typeof cardish === "string") return "String";
  if (cardish instanceof DeckoName) return "Card::Name";
  if (Array.isArray(cardish)) return "Array";
  if (typeof cardish === "object" && "codename" in cardish) return "Symbol";
  return String(cardish);
}

export function name(...cardish: readonly Cardish[]): DeckoName {
  return DeckoName.of(...cardish);
}
