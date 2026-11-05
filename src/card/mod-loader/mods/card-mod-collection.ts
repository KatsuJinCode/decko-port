import { searchPagingQuerySuffix } from "../../render/search-paging.js";
import type { ViewContext, ViewFn } from "../../render/format.js";
import { NoMethodError, rubyDefaultInspect, stableIdentity } from "../../render/format.js";
import type {
  DeckoModManifest,
  ModEventCard,
  ModSetModuleFile,
} from "../mod-manifest.js";

const MAX_PAGES = 100;

class PagingLinks {
  readonly totalPages: number;
  readonly currentPage: number;
  private windowStart = 0;
  private windowEnd = 0;
  private renderItem:
    | ((
        text: string,
        page: number | null,
        status: LinkStatus,
        options: LinkOptions,
      ) => string)
    | undefined;

  constructor(totalPages: number, currentPage: number) {
    this.totalPages = totalPages;
    this.currentPage = currentPage;
  }

  build(
    window: number,
    block: (
      text: string,
      page: number | null,
      status: LinkStatus,
      options: LinkOptions,
    ) => string,
  ): string[] {
    this.renderItem = block;
    return this.links(window);
  }

  private links(window: number): string[] {
    this.windowStart = Math.max(this.currentPage - window, 0);
    this.windowEnd = Math.min(this.currentPage + window, this.totalPages);
    const flat: (string | null)[] = [
      ...this.leftPart(),
      ...this.windowPart(),
      ...this.rightPart(),
    ];
    return flat.filter((s): s is string => s !== null);
  }

  private windowPart(): string[] {
    const out: string[] = [];
    for (let page = this.windowStart; page <= this.windowEnd; page++) {
      const link = this.directPageLink(page);
      if (link !== null) out.push(link);
    }
    return out;
  }

  private leftPart(): (string | null)[] {
    return [
      this.previousPageLink(),
      this.windowStart > 0 ? this.directPageLink(0) : null,
      this.windowStart > 1 ? this.ellipse() : null,
    ];
  }

  private rightPart(): string[] {
    const parts: (string | null)[] = [];
    if (this.totalPages > this.windowEnd + 1) parts.push(this.ellipse());
    if (this.addFinalPage()) parts.push(this.directPageLink(this.totalPages));
    parts.push(this.nextPageLink());
    return parts.filter((p): p is string => p !== null);
  }

  private addFinalPage(): boolean {
    return this.totalPages <= MAX_PAGES && this.totalPages > this.windowEnd;
  }

  private previousPageLink(): string {
    return this.pagingItem(
      '<span aria-hidden="true">&laquo;</span>',
      this.previousPage(),
      { "aria-label": "Previous", status: "previous" },
    );
  }

  private nextPageLink(): string {
    return this.pagingItem(
      '<span aria-hidden="true">&raquo;</span>',
      this.nextPage(),
      { "aria-label": "Next", status: "next" },
    );
  }

  private directPageLink(page: number): string | null {
    if (page < 0 || page > this.totalPages) return null;
    return this.pagingItem(String(page + 1), page, {});
  }

  private ellipse(): string {
    return this.pagingItem("<span>...</span>", null, { status: "ellipses" });
  }

  private pagingItem(
    text: string,
    page: number | null,
    options: LinkOptions,
  ): string {
    let status: LinkStatus;
    if (page === this.currentPage) status = "current";
    else status = (options.status ?? null) as LinkStatus | null;
    const cleaned: LinkOptions = { ...options };
    delete cleaned.status;
    const cb = this.renderItem;
    if (cb === undefined) throw new Error("paging_links: render block missing");
    return cb(text, page, status as LinkStatus, cleaned);
  }

  private previousPage(): number | null {
    return this.currentPage > 0 ? this.currentPage - 1 : null;
  }

  private nextPage(): number | null {
    return this.currentPage < this.totalPages ? this.currentPage + 1 : null;
  }
}

type LinkStatus = "current" | "next" | "previous" | "ellipses" | null;

interface LinkOptions {
  status?: LinkStatus;
  "aria-label"?: string;
  [key: string]: unknown;
}

const PAGE_LI_CLASS: Record<string, string> = {
  ellipses: "disabled",
  current: "active",
};

function rawItemStrings(content: string): string[] {
  if (content === "") return [];
  return content
    .split(/\n+/)
    .map((item) => item.replace(/^\[\[|\]\]$/g, "").trim())
    .filter((item) => item !== "");
}

function itemCount(ctx: ViewContext): number {
  const count = ctx.fmt.engine?.searchItemCount?.(ctx.fmt);
  if (count !== undefined) return count;
  return rawItemStrings(ctx.fmt.card.dbContent).length;
}

function searchResultItemCount(ctx: ViewContext): number {
  if (ctx.fmt.engine?.searchItemCount?.(ctx.fmt) !== undefined) {
    return ctx.fmt.engine.executeSearch(ctx.fmt).length;
  }
  return itemCount(ctx);
}

function formatWithDelimiter(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

const countView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  throw new NoMethodError(
    `undefined method 'count' for ${rubyDefaultInspect("Card", card.id ?? stableIdentity(card.name.s))}`,
  );
};

function readNumericOpt(ctx: ViewContext, key: "limit" | "offset"): number {
  const fromOpts = ctx.voo.opts[key];
  if (typeof fromOpts === "number") return fromOpts;
  if (typeof fromOpts === "string" && fromOpts !== "") {
    const n = Number(fromOpts);
    return Number.isFinite(n) ? n : 0;
  }
  return key === "limit" ? defaultLimit(ctx) : 0;
}

function defaultLimit(ctx: ViewContext): number {
  const fmt = ctx.fmt;
  const card = fmt.card;
  if (card.typeCode === "search" || card.typeName === "Search") {
    let cql: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(card.dbContent);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        cql = parsed as Record<string, unknown>;
      }
    } catch {
      cql = undefined;
    }
    const raw = cql?.["limit"];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw !== "") {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 20;
    }
  }
  return 20;
}

function totalPages(ctx: ViewContext): number {
  const limit = readNumericOpt(ctx, "limit");
  if (limit === 0) return 1;
  const count = itemCount(ctx);
  return Math.floor((count - 1) / limit);
}

function currentPage(ctx: ViewContext): number {
  const limit = readNumericOpt(ctx, "limit");
  if (limit === 0) return 1;
  const offset = readNumericOpt(ctx, "offset");
  return Math.floor(offset / limit);
}

function lastItemOnPage(ctx: ViewContext): number {
  const limit = readNumericOpt(ctx, "limit");
  const offset = readNumericOpt(ctx, "offset");
  return Math.min(itemCount(ctx), offset + limit);
}

function showPaging(ctx: ViewContext): boolean {
  const limit = readNumericOpt(ctx, "limit");
  if (limit < 1) return false;
  if (fewerResultsThanLimit(ctx)) return false;
  return limit < itemCount(ctx);
}

function fewerResultsThanLimit(ctx: ViewContext): boolean {
  const offset = readNumericOpt(ctx, "offset");
  if (offset !== 0) return false;
  return readNumericOpt(ctx, "limit") > offset + searchResultItemCount(ctx);
}

function pageLinkLiClass(status: LinkStatus): string {
  const parts: string[] = ["page-item"];
  const cls = status !== null ? PAGE_LI_CLASS[status] : undefined;
  if (cls !== undefined) parts.push(cls);
  return parts.join(" ");
}

function pageLink(
  text: string,
  page: number | null,
  options: LinkOptions,
  urlPath: string,
  limit: number,
  query?: Readonly<Record<string, string>>,
): string {
  if (page === null) {
    return `<div class="page-link">${text}</div>`;
  }
  const ariaLabel = options["aria-label"];
  const ariaAttr = typeof ariaLabel === "string" ? ` aria-label="${ariaLabel}"` : "";
  return (
    `<a${ariaAttr} class="card-paging-link slotter page-link"` +
    ` href="${urlPath}?limit=${limit}&amp;offset=${page * limit}${searchPagingQuerySuffix(query)}" data-remote="true">${text}</a>`
  );
}

function pagingLinks(ctx: ViewContext): string[] {
  const tp = totalPages(ctx);
  const cp = currentPage(ctx);
  const limit = readNumericOpt(ctx, "limit");
  const urlPath = `/${ctx.fmt.card.name.urlKey}`;
  return new PagingLinks(tp, cp).build(5, (text, page, status, options) => {
    const liClass = pageLinkLiClass(status);
    const link = pageLink(text, page, options, urlPath, limit, ctx.fmt.engine?.searchResultPaging?.(ctx.fmt)?.query);
    return `<li class="${liClass}">${link}</li>`;
  });
}

const pagingView: ViewFn = (ctx) => {
  if (!showPaging(ctx)) return "";
  const context = [
    String(readNumericOpt(ctx, "offset") + 1),
    "-",
    String(lastItemOnPage(ctx)),
    "of",
    String(itemCount(ctx)),
  ].join("\n");
  return (
    `<nav class='nav justify-content-between align-items-center'>\n` +
    `<ul class='pagination paging'>\n${pagingLinks(ctx).join("")}\n</ul>\n` +
    `<div class='paging-context'>\n${context}\n</div>\n` +
    `</nav>\n`
  );
};

function pagingUrlsHash(ctx: ViewContext): Record<string, string> {
  const hash: Record<string, string> = {};
  const limit = readNumericOpt(ctx, "limit");
  const urlKey = ctx.fmt.card.name.urlKey;
  new PagingLinks(totalPages(ctx), currentPage(ctx)).build(2, (_text, page, status) => {
    if (page === null) return "";
    if (status !== "next" && status !== "previous") return "";
    hash[status] = `/${urlKey}.json?limit=${limit}&offset=${page * limit}&item=name`;
    return "";
  });
  return hash;
}

const pagingUrlsJsonView: ViewFn = (ctx) => {
  if (!showPaging(ctx)) return {};
  return { paging: pagingUrlsHash(ctx) };
};

const pagingUrlsJsonldView: ViewFn = (ctx) => {
  if (!showPaging(ctx)) return {};
  const phash = pagingUrlsHash(ctx);
  const view: Record<string, string> = {
    "@type": "hydra:PartialCollectionView",
    "@id": `/${ctx.fmt.card.name.urlKey}`,
  };
  if (phash["previous"] !== undefined) view["hydra:previous"] = phash["previous"];
  if (phash["next"] !== undefined) view["hydra:next"] = phash["next"];
  return { "hydra:view": view };
};

const setModules: ModSetModuleFile[] = [
  {
    setPath: "all/item",
    formats: {
      html: {
        views: [{ view: "count", viewFn: countView }],
      },
    },
  },
  {
    setPath: "all/item_assignment",
    formats: { html: { views: [] } },
  },
  {
    setPath: "all/recursed",
    formats: { html: { views: [] } },
  },
  {
    setPath: "abstract/items",
    formats: { html: { views: [] } },
  },
  {
    setPath: "abstract/paging",
    formats: { html: { views: [] } },
  },
  {
    setPath: "abstract/paging/paging_views",
    formats: {
      html: {
        views: [
          {
            view: "paging",
            viewFn: pagingView,
            config: { cache: "never" },
          },
        ],
      },
      json: {
        views: [
          { view: "paging_urls", viewFn: pagingUrlsJsonView, config: { cache: "never" } },
        ],
      },
      jsonld: {
        views: [
          { view: "paging_urls", viewFn: pagingUrlsJsonldView },
        ],
      },
    },
  },
];

export const collectionModEventPredicates = {
  "unique_items?": (card: ModEventCard): boolean => card.uniqueItems === true,
} as const;

const cardModCollection: DeckoModManifest = {
  name: "collection",
  gemName: "card-mod-collection",
  group: "gem-defaults",
  setModules,
};

export default cardModCollection;
