import type { ViewResult } from "../../render/format.js";

import type { RenderCard, RequestTermSeat, ViewContext, ViewFn } from "../../render/format.js";
import { NoMethodError, RenderFormat, str, UnsupportedViewError } from "../../render/format.js";
import { formEscape } from "../../follow/follow-form-shapes.js";
import { DeckoName } from "../../name.js";
import { emitAttrs, h, newSlotId, slotOptionsJson } from "../../render/slot-html.js";
import { CqlBadQuery } from "../../../cql/ast.js";
import { parseCql } from "../../../cql/parser.js";
import { generateSql } from "../../../cql/sql.js";
import { getDefaultModLoader } from "../../mod-loader.js";
import type {
  DeckoModManifest,
  ModEngineHost,
} from "../mod-manifest.js";

function searchTypeCard(fmt: RenderFormat): boolean {
  if (fmt.card.typeName === "Search") return true;
  const typeId = fmt.card.record.typeId;
  return (
    typeId !== undefined && fmt.engine.peekCodenameById?.(typeId) === "search_type"
  );
}

function numberWithDelimiter(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const searchCounts = new Map<string, Map<number | null, number>>();
const searchCountFailures = new Map<string, string>();

interface SearchRow {
  id: number;
  left_id: number | null;
  right_id: number | null;
  name: string | null;
  type_id: number;
  db_content: string | null;
}

function rubyCqlContent(content: string | null): Record<string, unknown> {
  const query = content ?? "";
  if (query === "") {
    throw new CqlBadQuery("can't run search with empty content");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    throw new CqlBadQuery(`Invalid JSON search query: ${query}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`cql content is not a Hash: ${query}`);
  }
  return parsed as Record<string, unknown>;
}

export function searchCardsSidesStatement(searchTypeId: number): {
  sql: string;
  params: unknown[];
} {
  return {
    sql:
      "WITH RECURSIVE reached(id) AS (\n" +
      "  SELECT c.id FROM cards c WHERE c.type_id = ? AND c.trash = 0\n" +
      "  UNION\n" +
      "  SELECT s.id FROM reached r\n" +
      "    JOIN cards j ON j.id = r.id AND j.trash = 0\n" +
      "    JOIN cards s ON s.id IN (j.left_id, j.right_id) AND s.id IS NOT NULL\n" +
      "  UNION\n" +
      "  SELECT j.type_id FROM reached r JOIN cards j ON j.id = r.id\n" +
      "    WHERE j.type_id IS NOT NULL\n" +
      ")\n" +
      "SELECT c.* FROM cards c WHERE c.trash = 0 AND c.id IN (SELECT id FROM reached)",
    params: [searchTypeId],
  };
}

function deckKeysStatement(): { sql: string; params: unknown[] } {
  return {
    sql: "SELECT id, key FROM cards WHERE trash = 0 AND key IS NOT NULL",
    params: [],
  };
}

function mergedCountCql(
  cqlText: string | null,
  cardName: string,
  rowsByName: Map<string, SearchRow>,
  searchTypeId: number,
  typeNames: Map<number, string>,
  depth: number,
): Record<string, unknown> | undefined {
  if (depth > 5) return undefined;
  const cqlHash = { ...rubyCqlContent(cqlText) };
  const foundBy = cqlHash["found_by"];
  delete cqlHash["found_by"];
  const countArgs: Record<string, unknown> = { offset: 0, limit: 0, return: "count" };
  if (foundBy !== undefined && foundBy !== null) {
    if (foundBy !== "_left") return undefined;
    const parsed = DeckoName.parse(cardName);
    const leftName =
      parsed.leftName === undefined ? parsed.s : parsed.leftName.s;
    const leftRow = rowsByName.get(DeckoName.parse(leftName).key);
    const leftTypeName =
      leftRow === undefined
        ? "unknown"
        : (typeNames.get(leftRow.type_id) ?? "unknown");
    if (leftRow === undefined || leftRow.type_id !== searchTypeId) {
      throw new Error(
        `"found_by" value must be valid Search, but ${leftName} is a ${leftTypeName}`,
      );
    }
    const leftMerged = mergedCountCql(
      leftRow.db_content,
      leftName,
      rowsByName,
      searchTypeId,
      typeNames,
      depth + 1,
    );
    if (leftMerged === undefined) return undefined;
    const extraRestrictions = Object.keys(cqlHash).filter(
      (k) => !["return", "limit", "offset", "sort_by", "dir", "context"].includes(k),
    );
    if (extraRestrictions.length > 0) return undefined;
    let leftCql: Record<string, unknown>;
    try {
      leftCql = JSON.parse(leftRow.db_content ?? "") as Record<string, unknown>;
    } catch {
      throw new Error(`Invalid JSON search query: ${leftRow.db_content ?? ""}`);
    }
    delete leftCql["found_by"];
    return { ...leftCql, ...cqlHash, ...countArgs };
  }
  return { ...cqlHash, ...countArgs };
}

async function prepareSearchCounts(host: ModEngineHost): Promise<void> {
  searchCounts.clear();
  searchCountFailures.clear();
  await host.codenames.ensureLoaded();
  const searchTypeId = host.codenames.peekId("search_type");
  if (searchTypeId === undefined) return;
  const results = await host.batch([
    searchCardsSidesStatement(searchTypeId),
    deckKeysStatement(),
  ]);
  const rows = (results[0] as { rows: SearchRow[] } | undefined)?.rows ?? [];
  if (rows.length === 0) return;
  const nameToId = new Map<string, number>();
  for (const row of (results[1] as { rows: { id: number; key: string }[] } | undefined)
    ?.rows ?? []) {
    nameToId.set(row.key, row.id);
  }

  interface ComposedRecord {
    id?: number;
    name?: { s: string };
    key?: string;
  }
  const composedRecords = (await host.composeAndCacheRows(rows)) as ComposedRecord[];
  const rowById = new Map<number, SearchRow>();
  for (const row of rows) {
    if (!rowById.has(row.id)) rowById.set(row.id, row);
  }
  const rowByName = new Map<string, SearchRow>();
  const rowByKey = new Map<string, SearchRow>();
  const typeNames = new Map<number, string>();
  for (const record of composedRecords) {
    const id = record.id;
    const key = record.key;
    if (id === undefined || key === undefined || key === "") continue;
    const row = rowById.get(id);
    if (row === undefined) continue;
    rowByName.set(key, row);
    rowByKey.set(key, row);
    const display = record.name?.s;
    if (display !== undefined) typeNames.set(id, display);
  }
  const entries: { key: string }[] = [];
  const statements: { sql: string; params: unknown[] }[] = [];
  for (const [key, row] of rowByKey) {
    if (row.type_id !== searchTypeId) continue;
    const composed = typeNames.get(row.id) ?? "";
    let merged: Record<string, unknown> | undefined;
    try {
      merged = mergedCountCql(row.db_content, composed, rowByName, searchTypeId, typeNames, 0);
    } catch (e) {
      searchCountFailures.set(key, e instanceof Error ? e.message : String(e));
      continue;
    }
    if (merged === undefined) continue;
    try {
      const root = parseCql(merged, {
        context: composed,
        resolveCardId: (nameish: string) => nameToId.get(DeckoName.parse(nameish).key),
      });
      root.mods.return = "count";
      statements.push(generateSql(root, { countByReadRule: true }));
      entries.push({ key });
    } catch {
      continue;
    }
  }
  if (statements.length === 0) return;
  const countResults = await host.batch(statements);
  for (let i = 0; i < entries.length; i++) {
    const result = countResults[i] as
      | { rows: { read_rule_id: number | null; count: number | null }[] }
      | undefined;
    const byRule = new Map<number | null, number>();
    for (const row of result?.rows ?? []) {
      const rule = row.read_rule_id === null || row.read_rule_id === undefined ? null : Number(row.read_rule_id);
      const n = row.count === null || row.count === undefined ? 0 : Number(row.count);
      byRule.set(rule, (byRule.get(rule) ?? 0) + (Number.isNaN(n) ? 0 : n));
    }
    searchCounts.set(entries[i]!.key, byRule);
  }
}

function warmedCount(
  ctx: ViewContext,
): { count: number } | { failure: string } | undefined {
  const currentFailure = ctx.fmt.engine.searchQueryFailure?.(ctx.fmt);
  if (currentFailure !== undefined) return { failure: currentFailure };
  const currentCount = ctx.fmt.engine.searchItemCount?.(ctx.fmt) ?? ctx.fmt.engine.searchResultCount?.(ctx.fmt);
  if (currentCount !== undefined) return { count: currentCount };
  const key = ctx.fmt.card.key;
  const failure = searchCountFailures.get(key);
  if (failure !== undefined) return { failure };
  const byRule = searchCounts.get(key);
  if (byRule === undefined) return undefined;
  const scope = ctx.fmt.engine.cqlReadScope?.();
  if (scope === undefined) return undefined;
  const admitted = scope.readRuleIds.length > 0 ? scope.readRuleIds : [1];
  let count = 0;
  for (const [rule, n] of byRule) {
    if (scope.alwaysOk || (rule !== null && admitted.includes(rule))) count += n;
  }
  return { count };
}

function delegateCount(ctx: ViewContext): ViewResult {
  const chain = getDefaultModLoader()?.viewChain(ctx.fmt.card.setKeys, "count") ?? [];
  const next = chain.find((entry) => entry.setModule !== "Abstract::Search");
  if (next === undefined) {
    throw new UnsupportedViewError("count", ctx.fmt.card.name.s);
  }
  return next.viewFn(ctx);
}

function warmedCountBytes(ctx: ViewContext, delimiter: (n: number) => string): string {
  const warmed = warmedCount(ctx);
  if (warmed === undefined) {
    throw new Error(
      "search count not warmed (cql not executable through the CQL engine)",
    );
  }
  if ("failure" in warmed) throw new CqlBadQuery(warmed.failure);
  return delimiter(warmed.count);
}

const countBaseView: ViewFn = (ctx) => {
  if (!searchTypeCard(ctx.fmt)) return delegateCount(ctx);
  return warmedCountBytes(ctx, (n) => String(n));
};

const countHtmlView: ViewFn = (ctx) => {
  if (!searchTypeCard(ctx.fmt)) return delegateCount(ctx);
  return warmedCountBytes(ctx, numberWithDelimiter);
};

const searchCountView: ViewFn = (ctx) => {
  if (!searchTypeCard(ctx.fmt)) {
    throw new UnsupportedViewError("search_count", ctx.fmt.card.name.s);
  }
  const warmed = warmedCount(ctx);
  if (warmed !== undefined && "failure" in warmed) return warmed.failure;
  const content = ctx.fmt.card.dbContent;
  try {
    rubyCqlContent(content);
  } catch (e) {
    if (e instanceof CqlBadQuery) return e.message;
    throw e;
  }
  let cqlReturnCount = false;
  try {
    cqlReturnCount = rubyCqlContent(content)["return"] === "count";
  } catch {
  }
  if (cqlReturnCount) {
    if (warmed === undefined) {
      throw new Error(
        "search count not warmed (cql not executable through the CQL engine)",
      );
    }
    return String(warmed.count);
  }
  if (warmed !== undefined && warmed.count === 0) return "[]";
  const items = ctx.fmt.engine.executeSearch(ctx.fmt);
  if (items.length === 0 && ctx.fmt.engine.searchItemCount?.(ctx.fmt) === undefined) {
    throw new Error("search results not warmed (cql not executable through the CQL engine)");
  }
  return `[${items.map(cardInspect).join(", ")}]`;
};

function cardInspect(card: RenderCard): string {
  const tags: string[] = [];
  if (card.record.trash === true) tags.push("trash");
  if (card.id === undefined) tags.push("new");
  tags.push("set_mods_loaded");
  const debugType = `${card.typeCode ?? ""}:${card.typeId ?? ""}`;
  return `#<Card#${card.id ?? ""}[${debugType}](${card.name.s}){${tags.join(",")}}`;
}

const searchErrorView: ViewFn = (ctx) => {
  if (!searchTypeCard(ctx.fmt)) {
    throw new UnsupportedViewError("search_error", ctx.fmt.card.name.s);
  }
  const warmed = warmedCount(ctx);
  if (warmed === undefined) {
    throw new Error(
      "search_error bytes exist only for a warmed search result (Ruby's Integer/Array results crash .message with NoMethodError)",
    );
  }
  if ("failure" in warmed) {
    return `Card::Error::BadQuery :: ${warmed.failure} :: ${ctx.fmt.card.dbContent ?? ""}`;
  }
  let cqlReturnCount = false;
  try {
    cqlReturnCount = rubyCqlContent(ctx.fmt.card.dbContent ?? "")["return"] === "count";
  } catch {
  }
  const result: unknown = cqlReturnCount ? warmed.count : ctx.fmt.engine.executeSearch(ctx.fmt);
  const className = cqlReturnCount ? "Integer" : "Array";
  const message = (result as { message?: unknown } | null)?.message;
  if (message === undefined) {
    throw new NoMethodError(`undefined method 'message' for an instance of ${className}`);
  }
  return `${className} :: ${String(message)} :: ${ctx.fmt.card.dbContent ?? ""}`;
};

const oneLineContentView: ViewFn = ({ fmt }) => {
  if (!searchTypeCard(fmt)) {
    throw new UnsupportedViewError("one_line_content", fmt.card.name.s);
  }
  if (fmt.depth > fmt.maxDepth) return "...";
  const items = fmt.engine.executeSearch(fmt);
  if (items.length === 0) return fmt.renderView("no_search_results");
  const rendered = items.map(
    (item) =>
      `<div class="search-result-item item-link">${fmt.nestRecord(item, "link", { size: null })}</div>`,
  );
  return `<div class="card-list card-list-link search-result-list">${rendered.join("\n")}</div>\n`;
};

function autocompleteItem(type: string, icon: string, label: string): string {
  return (
    `<div class='autocomplete-item-${type} autocomplete-item'>\n` +
    `<div class='autocomplete-icon'>\n${icon}\n</div>\n` +
    `<div class='autocomplete-label'>\n${h(label)}\n</div>\n` +
    `</div>\n`
  );
}

function materialIconTag(icon: string): string {
  return `<i class="notranslate material-icons">${h(icon)}</i>`;
}

function gotoAutocompleteIcon(fmt: RenderFormat): string {
  if (fmt.card.typeCode === "image") return str(fmt.renderView("core", { size: "small" }));
  const image = fmt.engine.fetchRenderCard(`${fmt.card.name.s}+image`);
  if (image !== undefined) {
    return fmt.nestRecord(image, "core", { size: "small" });
  }
  return materialIconTag("arrow_forward");
}

const gotoAutocompleteItemView: ViewFn = ({ fmt }) =>
  autocompleteItem("goto", gotoAutocompleteIcon(fmt), fmt.card.name.s);

const addAutocompleteItemView: ViewFn = ({ fmt }) =>
  autocompleteItem("add", materialIconTag("add"), fmt.card.name.s);

const select2OptionView: ViewFn = ({ fmt }) => {
  const id = `~${fmt.card.id ?? ""}`;
  return { id, text: fmt.card.name.s };
};

const completeView: ViewFn = ({ fmt }) => {
  const seat = fmt.engine.searchBoxCompleteSeat?.(fmt.card);
  if (seat === undefined) throw new Error("complete rendered without its prepare seat");
  if (seat.failure !== undefined) throw new CqlBadQuery(seat.failure);
  return seat.goto.map(card => {
    const html = new RenderFormat(card, fmt.engine, {
      parent: fmt, formatName: "html", maxDepth: fmt.maxDepth, nestQuietErrors: fmt.nestQuietErrors,
    });
    return str(html.renderView("goto_autocomplete_item", {}));
  });
};

const searchBoxCompleteView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (fmt.card.key !== "*search") {
    throw new UnsupportedViewError("search_box_complete", fmt.card.name.s);
  }
  const seat = fmt.engine.searchBoxCompleteSeat?.(fmt.card);
  if (seat === undefined) {
    throw new Error(
      "search_box_complete rendered without its prepare seat (the engine's view-keyed prepare hook never ran for this render)",
    );
  }
  if (seat.failure !== undefined) throw new CqlBadQuery(seat.failure);
  const renderHtmlView = (card: RenderCard, view: string): string => {
    const sub = new RenderFormat(card, fmt.engine, {
      parent: fmt,
      maxDepth: fmt.maxDepth,
      nestQuietErrors: fmt.nestQuietErrors,
      formatName: "html",
    });
    return str(sub.renderView(view, {}));
  };
  const term = seat.term;
  type CompleteItem = {
    url: string;
    action: string;
    value: string | null;
    label: string;
  };
  const items: CompleteItem[] = [];
  items.push({
    url: fmt.cardUrl(
      `*search?query%5Bkeyword%5D=${formEscape(term ?? "")}`,
    ),
    action: "search",
    value: term ?? null,
    label: autocompleteItem("search", materialIconTag("search"), term ?? ""),
  });
  if (seat.exact !== undefined && !seat.exactKnown) {
    const creatable =
      fmt.engine.unknownCardCreatable?.(seat.exact) ??
      fmt.engine.taskAllowed?.(seat.exact, "create") === true;
    if (seat.exact.name.isValid && creatable) {
      items.push({
        url: fmt.cardUrl(seat.exact.name.urlKey),
        action: "add",
        value: term ?? null,
        label: renderHtmlView(seat.exact, "add_autocomplete_item"),
      });
    }
  }
  const emitted = new Set<string>();
  const pushGoto = (card: RenderCard): void => {
    if (emitted.has(card.name.key)) return;
    emitted.add(card.name.key);
    items.push({
      url: fmt.cardUrl(card.name.urlKey),
      action: "goto",
      value: card.name.s,
      label: renderHtmlView(card, "goto_autocomplete_item"),
    });
  };
  if (seat.exactKnown && seat.exact !== undefined) pushGoto(seat.exact);
  for (const card of seat.goto) pushGoto(card);
  return items;
};

function checkboxItem(fmt: RenderFormat, item: RenderCard): string {
  const name = item.name;
  const unsaved = item.record === undefined || item.record.isNew === true;
  const cardname = unsaved && name.isCompound ? name.urlKey : name.s;
  const classes = ["card-slot", "-view", item.setKeys].filter((s) => s !== "").join(" ");
  const attrs = emitAttrs({
    id: `${name.safeKey}--view`,
    class: classes,
    "data-card-id": item.id === undefined ? undefined : String(item.id),
    "data-card-name": cardname,
    "data-card-type-id": item.typeId === undefined ? undefined : String(item.typeId),
    "data-card-type-name": item.typeName,
    "data-card-link-name": name.urlKey,
    "data-slot-id": newSlotId(),
    "data-slot": slotOptionsJson({ view: null }),
  });
  const hostItemType = fmt.engine.hostItemTypeName?.(fmt.card);
  const nest = fmt.nestRecord(item, "bar", {
    ...(hostItemType !== undefined ? { type: hostItemType.typeName } : {}),
  });
  const inner =
    `<div class='w-100 d-flex align-items-center'>\n` +
    `${checkBoxTag(name.s, name.key, false, "_checkbox-list-checkbox p-1 me-3")}\n` +
    `<label class='p-2 w-100'>\n` +
    `${nest}\n` +
    `</label>\n` +
    `</div>\n`;
  const hamlComment = `<!-- /- id = "${fmt.card.key}-_-${item.key}" -->\n`;
  return `<div${attrs}>${hamlComment}${inner}</div>`;
}

function checkBoxTag(
  name: string,
  value: string,
  checked: boolean,
  extraClass: string,
): string {
  const checkedAttr = checked ? ` checked="checked"` : "";
  return (
    `<input type="checkbox" name="${h(name)}" id="${h(name.replace(/ /g, "_"))}" value="${h(value)}"` +
    ` class="${h(extraClass)}"${checkedAttr} />`
  );
}

const checkboxListView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (!searchTypeCard(fmt)) {
    throw new UnsupportedViewError("checkbox_list", fmt.card.name.s);
  }
  const items = fmt.engine.executeSearch(fmt);
  if (items.length === 0) return fmt.renderView("no_search_results");
  const rendered = items.map((item) => checkboxItem(fmt, item));
  return `<div class="_search-checkbox-list pe-2">${rendered.join("\n")}</div>\n`;
};

const resultsForKeywordView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (fmt.card.key !== "*search") {
    throw new UnsupportedViewError("results_for_keyword", fmt.card.name.s);
  }
  const keyword = fmt.engine.searchKeyword?.(fmt.card);
  if (keyword === undefined || keyword === "") return "";
  return (
    `<div class='my-3 p-2 bg-light'>\n` +
    `  Results for\n` +
    `  <span class='search-keyword'>\n` +
    `    ${h(keyword)}\n` +
    `  </span>\n` +
    `</div>\n`
  );
};

export const searchBarOverrideView: ViewFn = (ctx) => {
  ctx.voo?.hide("one_line_content");
  return ctx.fmt.renderView("bar");
};

const requestTermSeatOrThrow = (
  fmt: ViewContext["fmt"],
  view: string,
): RequestTermSeat => {
  const seat = fmt.engine.requestTermSeat?.(fmt.card);
  if (seat === undefined) {
    throw new Error(
      `${view} rendered without its prepare seat (the engine's view-keyed prepare hook never ran for this render)`,
    );
  }
  return seat;
};

const formatJsonSearch = (
  ctx: ViewContext,
  cards: readonly RenderCard[],
): string => {
  const itemView = (ctx.voo.items as { view?: string } | undefined)?.view;
  if (itemView === "name") {
    return JSON.stringify(cards.map((c) => c.name.s));
  }
  const molecules = cards.map((card) => {
    const sub = new RenderFormat(card, ctx.fmt.engine, {
      parent: ctx.fmt,
      maxDepth: ctx.fmt.maxDepth,
      nestQuietErrors: ctx.fmt.nestQuietErrors,
      formatName: "json",
    });
    const rendered = sub.renderView("molecule", {});
    return typeof rendered === "string"
      ? (JSON.parse(rendered) as Record<string, unknown>)
      : (rendered as Record<string, unknown>);
  });
  return JSON.stringify(molecules);
};

const nameCompleteView: ViewFn = (ctx) => {
  const seat = requestTermSeatOrThrow(ctx.fmt, "name_complete");
  if (seat.failure !== undefined) throw new CqlBadQuery(seat.failure);
  return formatJsonSearch(ctx, seat.complete);
};

const nameMatchView: ViewFn = (ctx) => {
  const seat = requestTermSeatOrThrow(ctx.fmt, "name_match");
  if (seat.failure !== undefined) throw new CqlBadQuery(seat.failure);
  return formatJsonSearch(ctx, [...seat.complete, ...seat.match]);
};

const cardModSearch: DeckoModManifest = {
  name: "search",
  gemName: "card-mod-search",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/0_search",
      formats: {
        base: {
          views: [
            { view: "count", viewFn: countBaseView, config: { cache: "never" } },
          ],
        },
        html: {
          views: [
            { view: "count", viewFn: countHtmlView, config: { cache: "never" } },
          ],
        },
      },
    },
    {
      setPath: "abstract/0_search/views",
      formats: {
        base: {
          views: [
            { view: "search_count", viewFn: searchCountView, config: { cache: "never" } },
            { view: "search_error", viewFn: searchErrorView, config: { cache: "never" } },
            { view: "checkbox_list", viewFn: checkboxListView, config: { cache: "never" } },
          ],
        },
        json: {
          views: [
            { view: "name_complete", viewFn: nameCompleteView, config: { cache: "never" } },
            { view: "name_match", viewFn: nameMatchView, config: { cache: "never" } },
          ],
        },
      },
    },
    {
      setPath: "abstract/search_views",
      formats: {
        html: {
          views: [
            { view: "one_line_content", viewFn: oneLineContentView, config: { cache: "never" } },
          ],
        },
      },
    },
    {
      setPath: "self/search",
      formats: {
        html: {
          views: [
            { view: "results_for_keyword", viewFn: resultsForKeywordView, config: { cache: "never" } },
            {
              view: "core",
              viewFn: (ctx) =>
                [resultsForKeywordView(ctx), ctx.fmt.renderView("card_list")]
                  .filter((part) => part !== undefined && part !== null)
                  .map(str)
                  .join("\n"),
              config: { cache: "never" },
            },
          ],
        },
        json: {
          views: [
            {
              view: "search_box_complete",
              viewFn: searchBoxCompleteView,
              config: { cache: "never", perms: "none" },
            },
            { view: "complete", viewFn: completeView, config: { cache: "never", perms: "none" } },
          ],
        },
      },
    },
    {
      setPath: "all/autocomplete",
      formats: {
        html: {
          views: [
            { view: "goto_autocomplete_item", viewFn: gotoAutocompleteItemView },
            {
              view: "add_autocomplete_item",
              viewFn: addAutocompleteItemView,
              config: { unknown: true },
            },
          ],
        },
        json: {
          views: [
            { view: "select2_option", viewFn: select2OptionView, config: { perms: "none" } },
          ],
        },
      },
    },
  ],
  prepareEngine: prepareSearchCounts,
};

export default cardModSearch;
