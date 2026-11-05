export function renderAddedChunk(text: string): string {
  return `<ins class='diffins diff-added'>${text}</ins>`;
}

export function renderDeletedChunk(text: string): string {
  return `<del class='diffdel diff-deleted'>${text}</del>`;
}

export interface ContentDiffOptions {
  diffFormat?: "html" | "text" | "pointer" | "raw";
  summary?: { length?: number; joint?: string };
}

type SummaryAction = "added" | "deleted" | "ellipsis" | string;

interface SummaryChunk {
  action: SummaryAction;
  text: string;
}

function summaryCharacterCount(text: string): number {
  let count = 0;
  for (const _character of text) count++;
  return count;
}

export class DiffSummary {
  private remainingChars: number;
  private readonly joint: string;
  private readonly jointCharacterCount: number;
  private readonly chunks: SummaryChunk[] = [];
  private contentOmitted: boolean | undefined;
  private renderedCache: string | undefined;

  constructor(opts?: { length?: number; joint?: string }) {
    this.remainingChars = opts?.length ?? 50;
    this.joint = opts?.joint ?? "...";
    this.jointCharacterCount = summaryCharacterCount(this.joint);
  }

  get rendered(): string {
    if (this.renderedCache === undefined) this.renderedCache = this.render();
    return this.renderedCache;
  }

  add(text: string): void {
    this.addChunk(text, "added");
  }

  delete(text: string): void {
    this.addChunk(text, "deleted");
  }

  omit(): void {
    if (this.chunks.length === 0 || this.chunks[this.chunks.length - 1]!.action !== "ellipsis") {
      this.addChunk(this.joint, "ellipsis");
    }
  }

  omitsContent(): boolean {
    return this.contentOmitted === true || this.remainingChars < 0;
  }

  private render(): string {
    this.truncateOverlap();
    const out = this.chunks.map((chunk) => {
      if (chunk.action === "ellipsis") this.contentOmitted = true;
      return this.renderChunk(chunk.action, chunk.text);
    });
    return out.join("");
  }

  private addChunk(text: string, action: SummaryAction): void {
    if (this.remainingChars <= 0) return;
    this.chunks.push({ action, text });
    this.remainingChars -= summaryCharacterCount(text);
  }

  private renderChunk(action: SummaryAction, text: string): string {
    if (action === "+" || action === "added") return renderAddedChunk(text);
    if (action === "-" || action === "deleted") return renderDeletedChunk(text);
    return text;
  }

  private truncateOverlap(): void {
    if (this.remainingChars >= 0) return;
    this.processEllipsis();
    let index = this.chunks.length - 1;
    while (this.processRemaining(index)) {
      if (this.processOverlap(index)) break;
      index -= 1;
    }
  }

  private processRemaining(index: number): boolean {
    return this.remainingChars < this.jointCharacterCount && index >= 0;
  }

  private processEllipsis(): void {
    if (this.chunks[this.chunks.length - 1]?.action !== "ellipsis") return;
    this.chunks.pop();
    this.contentOmitted = true;
    this.remainingChars += this.jointCharacterCount;
  }

  private processOverlap(index: number): boolean {
    if (this.overlapFinished(index)) return true;
    this.remainingChars += summaryCharacterCount(this.chunks[index]!.text);
    this.chunks.splice(index, 1);
    return false;
  }

  private overlapFinished(index: number): boolean {
    const overlapSize = this.remainingChars + summaryCharacterCount(this.chunks[index]!.text);
    if (overlapSize === this.jointCharacterCount) {
      this.replaceWithJoint(index);
    } else if (overlapSize > this.jointCharacterCount) {
      this.cutWithJoint(index);
    } else {
      return false;
    }
    return true;
  }

  private cutWithJoint(index: number): void {
    const cutEndFromEnd = -(this.remainingChars - this.jointCharacterCount - 1);
    const characters = Array.from(this.chunks[index]!.text);
    this.chunks[index]!.text =
      characters.slice(0, characters.length - cutEndFromEnd + 1).join("") +
      this.joint;
  }

  private replaceWithJoint(index: number): void {
    this.chunks.pop();
    if (index <= 0) return;
    const previousAction = this.chunks[index - 1]!.action;
    const replacement =
      previousAction === "added" ? "ellipis" : previousAction === "deleted" ? "added" : undefined;
    if (replacement === undefined) return;
    this.chunks.push({ action: replacement, text: this.joint });
  }
}

export class DiffResult {
  complete = "";
  delsCnt = 0;
  addsCnt = 0;
  private readonly summaryObj: DiffSummary;

  constructor(summaryOpts?: { length?: number; joint?: string }) {
    this.summaryObj = new DiffSummary(summaryOpts);
  }

  get summary(): string {
    return this.summaryObj.rendered;
  }

  get summaryOmitsContent(): boolean {
    return this.summaryObj.omitsContent();
  }

  writeAddedChunk(text: string): void {
    this.addsCnt += 1;
    this.complete += renderAddedChunk(text);
    this.summaryObj.add(text);
  }

  writeDeletedChunk(text: string): void {
    this.delsCnt += 1;
    this.complete += renderDeletedChunk(text);
    this.summaryObj.delete(text);
  }

  writeUnchangedChunk(text: string): void {
    this.complete += text;
    this.summaryObj.omit();
  }

  writeExcludedChunk(text: string): void {
    this.complete += text;
  }
}

type Link = [Link | null, number, number];

function positionHash(seq: string[], start: number, finish: number): Map<string, number[]> {
  const hash = new Map<string, number[]>();
  for (let i = start; i <= finish; i++) {
    const key = seq[i]!;
    const list = hash.get(key);
    if (list === undefined) hash.set(key, [i]);
    else list.push(i);
  }
  return hash;
}

function replaceNextLarger(enum_: number[], value: number, lastIndex: number | undefined): number | null {
  if (enum_.length === 0 || value > enum_[enum_.length - 1]!) {
    enum_.push(value);
    return enum_.length - 1;
  }
  let last = lastIndex ?? enum_.length - 1;
  let first = 0;
  while (first <= last) {
    const i = (first + last) >> 1;
    const found = enum_[i]!;
    if (value === found) return null;
    if (value > found) first = i + 1;
    else last = i - 1;
  }
  enum_[first] = value;
  return first;
}

function lcsVector(a: string[], b: string[]): (number | undefined)[] {
  let aStart = 0;
  let bStart = 0;
  let aFinish = a.length - 1;
  let bFinish = b.length - 1;
  const vector: (number | undefined)[] = [];

  while (aStart <= aFinish && bStart <= bFinish && a[aStart] === b[bStart]) {
    vector[aStart] = bStart;
    aStart += 1;
    bStart += 1;
  }
  while (aStart <= aFinish && bStart <= bFinish && a[aFinish] === b[bFinish]) {
    vector[aFinish] = bFinish;
    aFinish -= 1;
    bFinish -= 1;
  }

  const bMatches = positionHash(b, bStart, bFinish);
  const thresh: number[] = [];
  const links: (Link | undefined)[] = [];

  for (let i = aStart; i <= aFinish; i++) {
    const ai = a[i]!;
    const bm = bMatches.get(ai);
    let k: number | null = null;
    if (bm !== undefined) {
      for (let r = bm.length - 1; r >= 0; r--) {
        const j = bm[r]!;
        if (k !== null && thresh[k]! > j && thresh[k - 1]! < j) {
          thresh[k] = j;
        } else {
          k = replaceNextLarger(thresh, j, k ?? undefined);
        }
        if (k !== null) {
          links[k] = [k > 0 ? links[k - 1] ?? null : null, i, j] as Link;
        }
      }
    }
  }

  if (thresh.length > 0) {
    let link = links[thresh.length - 1];
    while (link !== undefined) {
      vector[link[1]] = link[2];
      link = link[0] ?? undefined;
    }
  }
  return vector;
}

export interface LcsEvent {
  action: "=" | "-" | "+" | "!";
  oldElement: string | undefined;
  newElement: string | undefined;
}

export function traverseBalanced(seq1: string[], seq2: string[], fn: (event: LcsEvent) => void): void {
  const matches = lcsVector(seq1, seq2);
  const aSize = seq1.length;
  const bSize = seq2.length;
  let ai = 0;
  let bj = 0;
  let mb = 0;
  let ma = -1;

  const at = (seq: string[], i: number): string | undefined => seq[i];

  for (;;) {
    for (;;) {
      ma += 1;
      if (!(ma < matches.length && matches[ma] === undefined)) break;
    }
    if (ma >= matches.length) break;
    mb = matches[ma]!;

    while (ai < ma || bj < mb) {
      const ax = at(seq1, ai);
      const bx = at(seq2, bj);
      if (ai < ma && bj < mb) {
        fn({ action: "!", oldElement: ax, newElement: bx });
        ai += 1;
        bj += 1;
      } else if (ai < ma) {
        fn({ action: "-", oldElement: ax, newElement: bx });
        ai += 1;
      } else {
        fn({ action: "+", oldElement: ax, newElement: bx });
        bj += 1;
      }
    }

    fn({ action: "=", oldElement: at(seq1, ai), newElement: at(seq2, bj) });
    ai += 1;
    bj += 1;
  }

  while (ai < aSize || bj < bSize) {
    const ax = at(seq1, ai);
    const bx = at(seq2, bj);
    if (ai < aSize && bj < bSize) {
      fn({ action: "!", oldElement: ax, newElement: bx });
      ai += 1;
      bj += 1;
    } else if (ai < aSize) {
      fn({ action: "-", oldElement: ax, newElement: bx });
      ai += 1;
    } else {
      fn({ action: "+", oldElement: ax, newElement: bx });
      bj += 1;
    }
  }
}

const SPLITTERS = ["<[^>]+>", "\\[\\[[^\\]]+\\]\\]", "\\{\\{[^}]+\\}\\}", "\\s+"];

function escapeHtmlRuby(word: string): string {
  return word
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitAndPreprocess(
  text: string,
  opts: { reject?: RegExp; preprocess?: (word: string) => string },
): string[] {
  const splitRegex = new RegExp(`(${SPLITTERS.join("|")})`, "g");
  let pieces = text.split(splitRegex);
  while (pieces.length > 0 && pieces[pieces.length - 1] === "") pieces.pop();
  pieces = pieces.filter((s) => s !== "" && (opts.reject === undefined || !opts.reject.test(s)));
  const preprocess = opts.preprocess;
  return preprocess !== undefined ? pieces.map((s) => preprocess(s)) : pieces;
}

interface LcsOpts {
  reject?: RegExp;
  exclude?: RegExp;
  preprocess?: (word: string) => string;
  postprocess?: (text: string) => string;
}

function lcsOptsForFormat(diffFormat: ContentDiffOptions["diffFormat"]): LcsOpts {
  const opts: LcsOpts = {};
  switch (diffFormat) {
    case "html":
      opts.exclude = /^</;
      break;
    case "text":
      opts.reject = /^</;
      opts.postprocess = (word) => word.replace(/\n/g, "<br>");
      break;
    case "pointer":
      opts.preprocess = (word) => word.replace(/\[\[/g, "").replace(/\]\]/g, "<br>");
      break;
    default:
      opts.preprocess = escapeHtmlRuby;
      break;
  }
  return opts;
}

class ExcludeeIterator {
  private index = 0;
  private chunkIndex = 0;

  constructor(private readonly list: { chunkIndex: number; element: string; type: "disjunction" | "excludee" }[]) {}

  wordStep(): void {
    this.chunkIndex += 1;
  }

  next(): { chunkIndex: number; element: string; type: "disjunction" | "excludee" } | undefined {
    if (this.index < this.list.length && this.list[this.index]!.chunkIndex === this.chunkIndex) {
      const res = this.list[this.index]!;
      this.index += 1;
      this.chunkIndex += 1;
      return res;
    }
    return undefined;
  }

  scanAndRecord(recordArray: string[], yieldFn: (element: string) => void): void {
    for (;;) {
      const ex = this.next();
      if (ex === undefined) break;
      if (ex.type === "disjunction") recordArray.push(ex.element);
      else yieldFn(ex.element);
    }
  }
}

function separateComparablesFromExcludees(
  text: string,
  opts: LcsOpts,
): { words: string[]; excludees: { chunkIndex: number; element: string; type: "disjunction" | "excludee" }[] } {
  const list = splitAndPreprocess(text, opts);
  if (opts.exclude === undefined) return { words: list, excludees: [] };
  const words: string[] = [];
  const excludees: { chunkIndex: number; element: string; type: "disjunction" | "excludee" }[] = [];
  const disjunction = /^\s/;
  list.forEach((element, index) => {
    if (disjunction.test(element)) excludees.push({ chunkIndex: index, element, type: "disjunction" });
    else if (opts.exclude!.test(element)) excludees.push({ chunkIndex: index, element, type: "excludee" });
    else words.push(element);
  });
  return { words, excludees };
}

class DiffProcessor {
  private adds: string[] = [];
  private dels: string[] = [];
  private readonly excludees: { old: ExcludeeIterator; new: ExcludeeIterator };

  constructor(
    private readonly result: DiffResult,
    oldWords: string[],
    newWords: string[],
    oldEx: { chunkIndex: number; element: string; type: "disjunction" | "excludee" }[],
    newEx: { chunkIndex: number; element: string; type: "disjunction" | "excludee" }[],
  ) {
    this.excludees = { old: new ExcludeeIterator(oldEx), new: new ExcludeeIterator(newEx) };
    this.oldWords = oldWords;
    this.newWords = newWords;
  }

  private readonly oldWords: string[];
  private readonly newWords: string[];

  run(): DiffResult {
    let prevAction: string | null = null;
    traverseBalanced(this.oldWords, this.newWords, (event) => {
      this.processWord(event, prevAction);
      prevAction = event.action;
    });
    this.writeAll();
    return this.result;
  }

  private processWord(event: LcsEvent, prevAction: string | null): void {
    if (prevAction !== null) this.interpretAction(prevAction, event.action);
    else this.writeExcludees();
    this.processElement(event);
  }

  private interpretAction(prevActn: string, wordActn: string): void {
    if (this.handleActionP(wordActn, prevActn)) this.handleAction(wordActn);
    else this.writeAll();
  }

  private handleActionP(wordAction: string, prevAction: string): boolean {
    return (
      prevAction === wordAction ||
      (prevAction === "-" && wordAction === "!") ||
      (prevAction === "!" && wordAction === "+")
    );
  }

  private handleAction(action: string): void {
    if (action === "-") this.delOldExcludees();
    else if (action === "+") this.addNewExcludees();
    else if (action === "!") {
      this.delOldExcludees();
      this.addNewExcludees();
    } else {
      this.writeExcludees();
    }
  }

  private writeAll(): void {
    this.writeDels();
    this.writeAdds();
    this.writeExcludees();
  }

  private writeDels(): void {
    if (this.dels.length === 0) return;
    this.result.writeDeletedChunk(this.dels.join(""));
    this.dels = [];
  }

  private writeAdds(): void {
    if (this.adds.length === 0) return;
    this.result.writeAddedChunk(this.adds.join(""));
    this.adds = [];
  }

  private writeExcludees(): void {
    for (;;) {
      const ex = this.excludees.new.next();
      if (ex === undefined) break;
      this.result.writeExcludedChunk(ex.element);
    }
  }

  private delOldExcludees(): void {
    this.excludees.old.scanAndRecord(this.dels, (element) => {
      this.writeDels();
      this.result.writeExcludedChunk(element);
    });
  }

  private addNewExcludees(): void {
    this.excludees.new.scanAndRecord(this.adds, (element) => {
      this.writeAdds();
      this.result.complete += element;
    });
  }

  private processElement(event: LcsEvent): void {
    switch (event.action) {
      case "-":
        this.minus(event.oldElement!);
        break;
      case "+":
        this.plus(event.newElement!);
        break;
      case "!":
        this.minus(event.oldElement!);
        this.plus(event.newElement!);
        break;
      default:
        this.result.writeUnchangedChunk(event.newElement!);
        this.excludees.new.wordStep();
        break;
    }
  }

  private plus(newElement: string): void {
    this.adds.push(newElement);
    this.excludees.new.wordStep();
  }

  private minus(oldElement: string): void {
    this.dels.push(oldElement);
    this.excludees.old.wordStep();
  }
}

export class ContentDiff {
  readonly result: DiffResult;
  private readonly lcsOpts: LcsOpts;

  constructor(
    oldVersion: string | null | undefined,
    newVersion: string | null | undefined,
    opts: ContentDiffOptions = {},
  ) {
    this.result = new DiffResult(opts.summary);
    this.lcsOpts = lcsOptsForFormat(opts.diffFormat);
    if (newVersion === null || newVersion === undefined) return;
    this.run(oldVersion, newVersion);
  }

  static complete(a: string | null | undefined, b: string, opts: ContentDiffOptions = {}): string {
    return new ContentDiff(a, b, opts).complete;
  }

  static summary(a: string | null | undefined, b: string, opts: ContentDiffOptions = {}): string {
    return new ContentDiff(a, b, opts).summary;
  }

  get complete(): string {
    const post = this.lcsOpts.postprocess;
    return post !== undefined ? post(this.result.complete) : this.result.complete;
  }

  get summary(): string {
    return this.result.summary;
  }

  get summaryOmitsContent(): boolean {
    return this.result.summaryOmitsContent;
  }

  get red(): boolean {
    return this.result.delsCnt > 0;
  }

  get green(): boolean {
    return this.result.addsCnt > 0;
  }

  private run(oldText: string | null | undefined, newText: string): void {
    if (oldText !== null && oldText !== undefined) {
      const oldSide = separateComparablesFromExcludees(oldText, this.lcsOpts);
      const newSide = separateComparablesFromExcludees(newText, this.lcsOpts);
      new DiffProcessor(this.result, oldSide.words, newSide.words, oldSide.excludees, newSide.excludees).run();
    } else {
      const list = splitAndPreprocess(newText, this.lcsOpts);
      this.result.writeAddedChunk(list.join(""));
    }
  }
}

