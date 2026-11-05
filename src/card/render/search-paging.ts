const MAX_PAGES = 100;

export interface SearchResultPaging {
  limit: number;
  offset: number;
  count: number;
  query?: Readonly<Record<string, string>>;
}

export function searchPagingQuerySuffix(query?: Readonly<Record<string, string>>): string {
  return Object.entries(query ?? {}).map(([key, value]) => `&amp;query%5B${encodeURIComponent(key)}%5D=${encodeURIComponent(value)}`).join("");
}

function cardUrlPath(name: { urlKey: string }): string {
  return `/${name.urlKey}`;
}

function pagingItem(
  text: string,
  page: number | false,
  status: "current" | "ellipses" | "previous" | "next" | undefined,
  ariaLabel: string | undefined,
  urlPath: string,
  limit: number,
  current: number,
  query?: Readonly<Record<string, string>>,
): string {
  const liClass =
    status === "current"
      ? "page-item active"
      : status === "ellipses"
        ? "page-item disabled"
        : "page-item";
  const inner =
    page === false
      ? `<div class="page-link">${text}</div>`
      : `<a${ariaLabel !== undefined ? ` aria-label="${ariaLabel}"` : ""} class="card-paging-link slotter page-link" href="${urlPath}?limit=${limit}&amp;offset=${page * limit}${searchPagingQuerySuffix(query)}" data-remote="true">${text}</a>`;
  return `<li class="${liClass}">${inner}</li>`;
}

function pagingLinks(
  total: number,
  current: number,
  urlPath: string,
  limit: number,
  query?: Readonly<Record<string, string>>,
): string {
  const window = 5;
  const item = (
    text: string,
    page: number | false,
    status: "current" | "ellipses" | "previous" | "next" | undefined,
    ariaLabel?: string,
  ): string => pagingItem(text, page, status, ariaLabel, urlPath, limit, current, query);
  const direct = (page: number): string | undefined =>
    page >= 0 && page <= total ? item(String(page + 1), page, page === current ? "current" : undefined) : undefined;
  const prev = current > 0 ? current - 1 : false;
  const next = current < total ? current + 1 : false;
  const windowStart = Math.max(current - window, 0);
  const windowEnd = Math.min(current + window, total);
  const left: string[] = [
    item('<span aria-hidden="true">&laquo;</span>', prev, prev === false ? "previous" : undefined, prev === false ? undefined : "Previous"),
  ];
  if (windowStart > 0) {
    const first = direct(0);
    if (first !== undefined) left.push(first);
  }
  if (windowStart > 1) left.push(item("<span>...</span>", false, "ellipses"));
  const middle: string[] = [];
  for (let page = windowStart; page <= windowEnd; page++) {
    const link = direct(page);
    if (link !== undefined) middle.push(link);
  }
  const right: string[] = [];
  if (total > windowEnd + 1) right.push(item("<span>...</span>", false, "ellipses"));
  if (total <= MAX_PAGES && total > windowEnd) {
    const last = direct(total);
    if (last !== undefined) right.push(last);
  }
  right.push(
    item('<span aria-hidden="true">&raquo;</span>', next, next === false ? "next" : undefined, next === false ? undefined : "Next"),
  );
  return [...left, ...middle, ...right].join("");
}

function totalPages(count: number, limit: number): number {
  return limit === 0 ? 1 : Math.floor((count - 1) / limit);
}

function currentPage(offset: number, limit: number): number {
  return limit === 0 ? 1 : Math.floor(offset / limit);
}

function lastItemOnPage(count: number, offset: number, limit: number): number {
  return Math.min(count, offset + limit);
}

export function searchPagingNav(name: { urlKey: string }, paging: SearchResultPaging): string {
  const { limit, offset, count } = paging;
  const total = totalPages(count, limit);
  const current = currentPage(offset, limit);
  const links = pagingLinks(total, current, cardUrlPath(name), limit, paging.query);
  return (
    `<nav class='nav justify-content-between align-items-center'>\n` +
    `<ul class='pagination paging'>\n` +
    links +
    `\n</ul>\n` +
    `<div class='paging-context'>\n` +
    [String(offset + 1), "-", String(lastItemOnPage(count, offset, limit)), "of", String(count)].join("\n") +
    `\n</div>\n` +
    `</nav>\n`
  );
}
