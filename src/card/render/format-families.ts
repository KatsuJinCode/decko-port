import { referencedNames } from "./nest-syntax.js";
import type { RenderCard } from "./format.js";

export interface FormatEngineSurface {
  fetchRenderCard(name: string): RenderCard | undefined;
  prepareItemForRender(name: string): Promise<RenderCard | undefined>;
  render(name: string, view: string): Promise<string>;
  codenameById(typeId: number): Promise<string | undefined>;
}

export type CodenameMarkResolver = (
  mark: string,
) => Promise<string | undefined>;

export interface FormatShowOptions {
  urlBase?: string;
  rssEnabled?: boolean;
  now?: () => Date;
  resolveCodenameMark?: CodenameMarkResolver;
}

export type NonHtmlFormatName = "csv" | "rss" | "json";

interface FormatCard {
  id: number | undefined;
  name: string;
  typeName: string | undefined;
  typeCode: string | undefined;
  codename: string | undefined;
  dbContent: string;
  createdAt: Date | undefined;
  updatedAt: Date | undefined;
  unknown: boolean;
}

function formatCardOf(card: RenderCard): FormatCard {
  const rec = card.record as unknown as Record<string, unknown>;
  const asDate = (v: unknown): Date | undefined => {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
    if (typeof v !== "string") return undefined;
    const d = v.includes("T")
      ? new Date(v)
      : new Date(`${v.replace(" ", "T")}${v.includes(".") ? "" : ".000"}Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return {
    id: card.id,
    name: card.name.s,
    typeName: card.typeName,
    typeCode: card.typeCode,
    codename:
      typeof rec["codename"] === "string" ? (rec["codename"] as string) : undefined,
    dbContent: card.dbContent,
    createdAt: asDate(rec["createdAt"]),
    updatedAt: asDate(rec["updatedAt"]),
    unknown: card.unknown === true,
  };
}

async function withTypeCode(
  card: FormatCard,
  renderCard: RenderCard | undefined,
  engine: FormatEngineSurface,
): Promise<FormatCard> {
  if (card.typeCode === undefined && renderCard?.typeId !== undefined) {
    card.typeCode = await engine.codenameById(renderCard.typeId);
  }
  return card;
}

function itemNamesOf(card: FormatCard): string[] {
  return card.dbContent
    .split(/\n+/)
    .map((s) => s.replace(/\[\[|\]\]/g, "").trim())
    .filter((s) => s !== "");
}

const LIST_FAMILY_TYPE_CODES = new Set(["list", "pointer"]);

function cardPath(name: string): string {
  return `/${name.replace(/ /g, "_")}`;
}

export function csvGenerateLine(row: unknown): string {
  if (!Array.isArray(row)) {
    throw new Error("undefined method `each' for an instance of String");
  }
  const fields = (row as unknown[]).map((field) => {
    const s = field === null || field === undefined ? "" : String(field);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  });
  return `${fields.join(",")}\n`;
}

export function csvHeader(): unknown[] {
  return ["Name", "Type"];
}

export function csvRow(card: FormatCard): unknown[] {
  return [card.name, card.typeName ?? ""];
}

function csvItemRow(item: FormatCard): unknown {
  return item.unknown ? "" : csvRow(item);
}

export async function csvBody(
  engine: FormatEngineSurface,
  card: FormatCard,
  opts: FormatShowOptions,
): Promise<unknown[]> {
  const items = await resolveItems(engine, card, opts);
  const rows: unknown[] = [];
  for (const item of items) {
    rows.push(await csvItemTitled(engine, item, opts));
  }
  return rows;
}

async function csvItemTitled(
  engine: FormatEngineSurface,
  item: FormatCard,
  opts: FormatShowOptions,
): Promise<string> {
  if (item.unknown) return "";
  const items = await resolveItems(engine, item, opts);
  let out = csvGenerateLine(csvHeader());
  for (const sub of items) out += csvGenerateLine(csvItemRow(sub));
  return out;
}

export async function csvTitled(items: FormatCard[]): Promise<string> {
  const rows: unknown[] = [csvHeader()];
  for (const item of items) rows.push(csvItemRow(item));
  return rows.map((row) => csvGenerateLine(row)).join("");
}

export const RSS_DISABLED_BYTES = "RSS feeds disabled";

function xmlEscapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function rubyTimestamp(d: Date, ...args: unknown[]): string {
  if (args.length !== 0) {
    const error = new Error(`wrong number of arguments (given ${args.length}, expected 0)`);
    error.name = "ArgumentError";
    throw error;
  }
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

function pubDate(item: FormatCard, now: () => Date): string {
  return rubyTimestamp(item.updatedAt ?? now(), "rfc822");
}

export async function rssFeed(
  card: FormatCard,
  items: FormatCard[],
  globalTitle: string,
  openContent: (item: FormatCard) => Promise<string>,
  opts: FormatShowOptions,
): Promise<string> {
  const urlBase = opts.urlBase ?? "";
  const feedTitle = `${globalTitle} : ${card.name.replace(/^\*/, "")}`;

  const head =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">` +
    `<channel>` +
    `<title>${xmlEscapeText(feedTitle)}</title>` +
    `<description></description>` +
    `<link>${xmlEscapeText(urlBase + cardPath(card.name))}</link>`;

  let body = "";
  for (const item of items) {
    body += `<item><title>${xmlEscapeText(item.name)}</title>`;
    try {
      const description = item.unknown ? "" : await openContent(item);
      body += `<description>${xmlEscapeText(description)}</description>`;
      const date = pubDate(item, opts.now ?? (() => new Date()));
      const url = xmlEscapeText(`${urlBase}${cardPath(item.name)}`);
      body += `<pubDate>${xmlEscapeText(date)}</pubDate><link>${url}</link><guid>${url}</guid>`;
    } catch (error) {
      return rssErrorFeed(head, body, error);
    }
    body += "</item>";
  }
  return `${head}${body}</channel></rss>`;
}

function rssErrorFeed(head: string, body: string, error: unknown): string {
  const message = error instanceof Error ? `#<${error.name}: ${error.message}>` : String(error);
  const backtrace = error instanceof Error ? (error.stack?.split("\n").slice(1) ?? []) : [];
  return (
    `${head}${body}</item></channel></rss>` +
    `<error>\n\nERROR rendering RSS: ${xmlEscapeText(message)}\n\n ${xmlEscapeText(JSON.stringify(backtrace))}</error>`
  );
}

function jsonNucleus(card: FormatCard, urlBase: string): Record<string, unknown> {
  const nucleus: Record<string, unknown> = {
    id: card.id ?? null,
    name: card.name,
    type: card.typeName ?? "",
    url: `${urlBase}${cardPath(card.name)}.json`,
  };
  if (card.codename !== undefined) nucleus["codename"] = card.codename;
  return nucleus;
}

function jsonContent(card: FormatCard): unknown {
  if (card.typeCode !== undefined && LIST_FAMILY_TYPE_CODES.has(card.typeCode)) {
    return itemNamesOf(card);
  }
  return card.dbContent;
}

function jsonAtom(card: FormatCard, urlBase: string): Record<string, unknown> {
  const atom = jsonNucleus(card, urlBase);
  if (!card.unknown) atom["content"] = jsonContent(card);
  return atom;
}

function jsonMolecule(parts: {
  card: FormatCard;
  items: FormatCard[];
  ancestors: FormatCard[];
  urlBase: string;
  now: () => Date;
  typeCard: FormatCard | undefined;
}): string {
  const { card, items, ancestors, urlBase, now, typeCard } = parts;
  const molecule = jsonAtom(card, urlBase);
  molecule["items"] = items.map((item) => jsonAtom(item, urlBase));
  molecule["links"] = [];
  molecule["ancestors"] = ancestors.map((a) => jsonNucleus(a, urlBase));
  molecule["html_url"] = urlBase + cardPath(card.name);
  if (typeCard !== undefined) molecule["type"] = jsonNucleus(typeCard, urlBase);
  if (card.createdAt !== undefined) molecule["created_at"] = rubyTimestamp(card.createdAt);
  if (card.updatedAt !== undefined) molecule["updated_at"] = rubyTimestamp(card.updatedAt);
  molecule["url"] = urlBase + cardPath(card.name);
  molecule["requested_at"] = rubyTimestamp(now());
  return JSON.stringify(molecule, null, 2);
}

async function resolveCard(
  engine: FormatEngineSurface,
  cardName: string,
): Promise<FormatCard> {
  await engine.prepareItemForRender(cardName);
  const card = engine.fetchRenderCard(cardName);
  if (card === undefined) {
    const err = new Error(`invalid card name: ${cardName}`) as Error & {
      notFound?: boolean;
    };
    err.notFound = true;
    throw err;
  }
  return withTypeCode(formatCardOf(card), card, engine);
}

async function resolveItem(
  engine: FormatEngineSurface,
  name: string,
): Promise<FormatCard> {
  const known = await engine.prepareItemForRender(name);
  if (known !== undefined) {
    return withTypeCode(formatCardOf(known), known, engine);
  }
  return {
    id: undefined,
    name,
    typeName: undefined,
    typeCode: undefined,
    codename: undefined,
    dbContent: "",
    createdAt: undefined,
    updatedAt: undefined,
    unknown: true,
  };
}

async function resolveItems(
  engine: FormatEngineSurface,
  card: FormatCard,
  opts: FormatShowOptions,
): Promise<FormatCard[]> {
  const out: FormatCard[] = [];
  for (const name of itemNamesOf(card)) {
    out.push(await resolveItem(engine, name));
  }
  void opts;
  return out;
}

async function resolveJsonItems(
  engine: FormatEngineSurface,
  card: FormatCard,
  opts: FormatShowOptions,
): Promise<FormatCard[]> {
  if (card.typeCode !== undefined && LIST_FAMILY_TYPE_CODES.has(card.typeCode)) {
    return resolveItems(engine, card, opts);
  }
  const out: FormatCard[] = [];
  for (const ref of referencedNames(card.dbContent)) {
    let name = ref.name;
    if (name.startsWith(":")) {
      const resolved = await opts.resolveCodenameMark?.(
        name.slice(1).replace(/ /g, "_"),
      );
      if (resolved === undefined) continue;
      name = resolved;
    }
    const known = await engine.prepareItemForRender(name);
    if (known === undefined) continue;
    out.push(await withTypeCode(formatCardOf(known), known, engine));
  }
  return out;
}

async function resolveAncestors(
  engine: FormatEngineSurface,
  card: FormatCard,
): Promise<FormatCard[]> {
  const parts = card.name.split("+");
  if (parts.length < 2) return [];
  const out: FormatCard[] = [];
  for (const part of parts) out.push(await resolveItem(engine, part));
  return out;
}

async function readGlobalTitle(engine: FormatEngineSurface): Promise<string> {
  const rule = await engine.prepareItemForRender("*all+*title");
  return rule?.dbContent ?? "";
}

async function openContent(
  engine: FormatEngineSurface,
  item: FormatCard,
): Promise<string> {
  if (item.unknown) return "";
  try {
    return await engine.render(item.name, "open_content");
  } catch {
    return "";
  }
}

export async function renderFormatShow(
  engine: FormatEngineSurface,
  cardName: string,
  format: NonHtmlFormatName,
  opts: FormatShowOptions = {},
): Promise<string> {
  const now = opts.now ?? (() => new Date());
  const card = await resolveCard(engine, cardName);
  if (format === "csv") {
    const items = await resolveItems(engine, card, opts);
    return csvTitled(items);
  }
  if (format === "rss") {
    if (opts.rssEnabled !== true) return RSS_DISABLED_BYTES;
    const globalTitle = await readGlobalTitle(engine);
    const feedItems =
      card.typeCode !== undefined && LIST_FAMILY_TYPE_CODES.has(card.typeCode)
        ? await resolveItems(engine, card, opts)
        : [card];
    return rssFeed(
      card,
      feedItems,
      globalTitle,
      (item) => openContent(engine, item),
      opts,
    );
  }
  const items = await resolveJsonItems(engine, card, opts);
  const ancestors = await resolveAncestors(engine, card);
  const typeCard =
    card.typeName === undefined
      ? undefined
      : await resolveItem(engine, card.typeName);
  return jsonMolecule({ card, items, ancestors, urlBase: opts.urlBase ?? "", now, typeCard });
}
