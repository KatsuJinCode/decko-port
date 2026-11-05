import { FetchEngine } from "../fetch.js";
import { DeckoName } from "../name.js";
import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import { patternsForCard } from "../set-patterns/card-patterns.js";
import { ruleName } from "../set-patterns/rule-names.js";
import { HEAD_READ_SET_KEYS } from "../render/head-views.js";
import { stripTags } from "../render/nest-syntax.js";
import {
  deriveReferenceEdges,
  deriveLinkEdges,
} from "./edge-deriver.js";
import { ONE_TRIP_SIDE_DDL } from "./side-db-schema.js";
import {
  DEFAULT_SEARCH_NEST_POSTURE,
  executeSearchNestNow,
  type SearchNestPosture,
} from "./search-nest-store.js";
import type {
  OneTripBuildReport,
  OneTripEdge,
  OneTripEdgeKind,
  RuleCandidateEnumerator,
} from "./types.js";

export type { OneTripBuildReport, OneTripEdgeKind };

export async function deriveDeckSettings(corpus: SQLDatabaseDriver): Promise<string[]> {
  const result = await corpus.query<{ name: string }>(
    `SELECT DISTINCT r.name AS name FROM cards j
       JOIN cards r ON r.id = j.right_id
      WHERE j.left_id IS NOT NULL AND j.trash = 0 AND r.name LIKE '*%'
      ORDER BY r.name`,
    [],
  );
  return result.rows.map((r) => r.name);
}

export function defaultRuleCandidateEnumerator(deckSettings: readonly string[]): RuleCandidateEnumerator {
  return {
    candidatesForCard(cardName: string): { settingCode: string; candidateKeys: string[] }[] {
      let setNames: string[];
      try {
        setNames = patternsForCard({ name: DeckoName.parse(cardName) }).map((p) => p.setName);
      } catch {
        return [];
      }
      return deckSettings.map((settingName) => ({
        settingCode: settingName.replace(/^\*/, ""),
        candidateKeys: setNames.map((setName) => ruleName(setName, settingName)),
      }));
    },
  };
}

export interface OneTripBuildOptions {
  corpus: SQLDatabaseDriver;
  side: SQLDatabaseDriver;
  pageNames: readonly string[];
  edgeDeriver?: {
    referenceEdges(content: string, referencingCardName: string): { key: string; view?: string }[];
    linkEdges(content: string, referencingCardName: string): { key: string }[];
  };
  ruleCandidates?: RuleCandidateEnumerator;
  searchNestPosture?: SearchNestPosture;
}

interface DeckCardRow {
  row: CardsRow;
  composedName: string | undefined;
}

export async function buildOneTripClosure(options: OneTripBuildOptions): Promise<OneTripBuildReport> {
  const { corpus, side, pageNames } = options;
  const deriver = options.edgeDeriver ?? {
    referenceEdges: deriveReferenceEdges,
    linkEdges: deriveLinkEdges,
  };
  const deckSettings = await deriveDeckSettings(corpus);
  const ruleSeam = options.ruleCandidates ?? defaultRuleCandidateEnumerator(deckSettings);
  const posture = options.searchNestPosture ?? DEFAULT_SEARCH_NEST_POSTURE;

  for (const statement of ONE_TRIP_SIDE_DDL) {
    await side.query(statement, []);
  }

  const bootstrap = new FetchEngine(corpus);
  await bootstrap.codenames.ensureLoaded();
  bootstrap.installNameEnvironment();

  const cardsResult = await corpus.query<CardsRow>("SELECT * FROM cards WHERE trash = 0", []);
  const liveRows = cardsResult.rows;
  const byId = new Map<number, DeckCardRow>();
  for (const row of liveRows) byId.set(row.id, { row, composedName: undefined });

  let composedCount = 0;
  {
    let pending = [...byId.values()];
    for (let pass = 0; pass < 64 && pending.length > 0; pass++) {
      const still: DeckCardRow[] = [];
      for (const entry of pending) {
        const { row } = entry;
        if (row.name !== null && row.name !== undefined) {
          entry.composedName = row.name;
        } else if (row.left_id !== null && row.left_id !== undefined && row.right_id !== null && row.right_id !== undefined) {
          const left = byId.get(row.left_id)?.composedName;
          const right = byId.get(row.right_id)?.composedName;
          if (left !== undefined && right !== undefined) entry.composedName = `${left}+${right}`;
        }
        if (entry.composedName !== undefined) composedCount += 1;
        else still.push(entry);
      }
      if (still.length === pending.length) break;
      pending = still;
    }
  }

  const keyToId = new Map<string, number>();
  for (const entry of byId.values()) {
    if (entry.composedName === undefined) continue;
    try {
      keyToId.set(DeckoName.parse(entry.composedName).key, entry.row.id);
    } catch {
    }
  }

  const edges = new Map<string, OneTripEdge>();
  const addEdge = (edge: OneTripEdge): void => {
    const mapKey = `${edge.refererId}->${edge.refereeKey}->${edge.kind}`;
    const existing = edges.get(mapKey);
    if (existing === undefined) {
      edges.set(mapKey, edge);
      return;
    }
    if (existing.refereeId === null && edge.refereeId !== null) existing.refereeId = edge.refereeId;
    if (edge.refView !== undefined && existing.refView !== edge.refView) {
      if (existing.refView === undefined) existing.refView = edge.refView;
    }
  };

  let parseDerived = 0;
  for (const entry of byId.values()) {
    const { row } = entry;
    const content = row.db_content;
    if (entry.composedName !== undefined && content !== null && content !== "") {
      for (const ref of deriver.referenceEdges(content, entry.composedName)) {
        if (ref.key === entry.composedName) continue;
        parseDerived += 1;
        addEdge({
          refererId: row.id,
          refereeKey: ref.key,
          refereeId: keyToId.get(ref.key) ?? null,
          kind: "include",
          refView: ref.view,
        });
      }
      for (const ref of deriver.linkEdges(content, entry.composedName)) {
        addEdge({
          refererId: row.id,
          refereeKey: ref.key,
          refereeId: keyToId.get(ref.key) ?? null,
          kind: "link",
        });
      }
    }
    for (const sideId of [row.left_id, row.right_id]) {
      if (sideId === null || sideId === undefined) continue;
      const sideEntry = byId.get(sideId);
      if (sideEntry === undefined || sideEntry.composedName === undefined) continue;
      const sideKey = DeckoName.parse(sideEntry.composedName).key;
      addEdge({ refererId: row.id, refereeKey: sideKey, refereeId: sideId, kind: "side" });
    }
    if (content !== null && content !== "" && entry.composedName !== undefined) {
      const typeEntry = row.type_id !== null && row.type_id !== undefined
        ? byId.get(row.type_id)
        : undefined;
      const typeCode = typeEntry?.row.codename ?? null;
      if (typeCode === "pointer" || typeCode === "list" || typeCode === "skin") {
        for (const rawLine of content.split("\n")) {
          const line = stripTags(rawLine.trim());
          if (line === "") continue;
          let itemKey: string | undefined;
          try {
            const parsed = DeckoName.parse(line);
            if (parsed.s === "" || parsed.isRelative) continue;
            itemKey = parsed.isAbsolute
              ? parsed.key
              : parsed.absoluteName(DeckoName.parse(entry.composedName)).key;
          } catch {
            continue;
          }
          if (itemKey === undefined || itemKey === "") continue;
          addEdge({
            refererId: row.id,
            refereeKey: itemKey,
            refereeId: keyToId.get(itemKey) ?? null,
            kind: "item",
          });
        }
      }
    }
    if (row.type_id !== null && row.type_id !== undefined && row.type_id > 0) {
      const typeEntry = byId.get(row.type_id);
      if (typeEntry !== undefined && typeEntry.composedName !== undefined) {
        addEdge({
          refererId: row.id,
          refereeKey: DeckoName.parse(typeEntry.composedName).key,
          refereeId: typeEntry.row.id,
          kind: "type",
        });
      }
    }
  }

  const storedResult = await corpus.query<{ referer_id: number; referee_key: string; ref_type: string }>(
    "SELECT referer_id, referee_key, ref_type FROM card_references",
    [],
  );
  const storedInclusion = storedResult.rows.filter((r) => r.ref_type === "I");
  const storedSet = new Set(storedInclusion.map((r) => `${r.referer_id}->${r.referee_key}`));
  const derivedIncludeSet = new Set(
    [...edges.values()].filter((e) => e.kind === "include").map((e) => `${e.refererId}->${e.refereeKey}`),
  );
  let parsedNotStored = 0;
  for (const key of derivedIncludeSet) if (!storedSet.has(key)) parsedNotStored += 1;
  let storedNotParsed = 0;
  for (const key of storedSet) if (!derivedIncludeSet.has(key)) storedNotParsed += 1;

  await side.query("DELETE FROM one_trip_edges", []);
  const edgeRows = [...edges.values()];
  for (let i = 0; i < edgeRows.length; i += 500) {
    const chunk = edgeRows.slice(i, i + 500);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    const params = chunk.flatMap((e) => [e.refererId, e.refereeKey, e.refereeId, e.kind, e.refView ?? null]);
    await side.query(
      `INSERT INTO one_trip_edges (referer_id, referee_key, referee_id, kind, ref_view) VALUES ${placeholders}`,
      params,
    );
  }

  await side.query("DELETE FROM one_trip_search_nests", []);
  await side.query("DELETE FROM one_trip_search_results", []);
  const searchResultsByNest = new Map<number, number[]>();
  const nests: { searchCardId: number; cqlText: string }[] = [];
  for (const entry of byId.values()) {
    const typeEntry = entry.row.type_id !== null && entry.row.type_id !== undefined
      ? byId.get(entry.row.type_id)
      : undefined;
    if (typeEntry?.row.codename !== "search_type") continue;
    if (entry.row.db_content === null || entry.row.db_content === "") continue;
    nests.push({ searchCardId: entry.row.id, cqlText: entry.row.db_content });
  }
  for (let i = 0; i < nests.length; i += 500) {
    const chunk = nests.slice(i, i + 500);
    const placeholders = chunk.map(() => "(?, ?)").join(", ");
    await side.query(
      `INSERT INTO one_trip_search_nests (search_card_id, cql_text) VALUES ${placeholders}`,
      chunk.flatMap((n) => [n.searchCardId, n.cqlText]),
    );
  }
  if (posture === "write-time") {
    for (const nest of nests) {
      const resultIds = await executeSearchNestNow(corpus, side, nest.searchCardId);
      searchResultsByNest.set(nest.searchCardId, resultIds);
    }
  }

  const adjacency = new Map<number, OneTripEdge[]>();
  for (const edge of edgeRows) {
    if (edge.refereeId === null) continue;
    const list = adjacency.get(edge.refererId);
    if (list === undefined) adjacency.set(edge.refererId, [edge]);
    else list.push(edge);
  }

  const SHELL_SEED_KEYS: readonly string[] = [...HEAD_READ_SET_KEYS, "Anonymous"];
  const shellSeedIds = (): number[] => {
    const ids: number[] = [];
    for (const seed of SHELL_SEED_KEYS) {
      try {
        const id = keyToId.get(DeckoName.parse(seed).key);
        if (id !== undefined) ids.push(id);
      } catch {
      }
    }
    return ids;
  };

  const pages: Record<string, { pageId: number; closureSize: number }> = {};
  const closureRows: { pageId: number; cardId: number; depth: number; views: string[] }[] = [];
  const ruleRows: {
    pageId: number;
    cardId: number;
    settingCode: string;
    candidateKey: string;
    candidateId: number | null;
  }[] = [];

  for (const pageName of pageNames) {
    let pageId: number | undefined;
    try {
      pageId = keyToId.get(DeckoName.parse(pageName).key);
    } catch {
      pageId = undefined;
    }
    if (pageId === undefined) {
      pages[pageName] = { pageId: -1, closureSize: 0 };
      continue;
    }
    await side.query("DELETE FROM one_trip_page_closure WHERE page_id = ?", [pageId]);
    await side.query("DELETE FROM one_trip_page_rules WHERE page_id = ?", [pageId]);

    const memberDepth = new Map<number, number>([[pageId, 0]]);
    const color = new Map<number, "white" | "gray">([[pageId, "white"]]);
    const worklist: number[] = [pageId];
    for (const seed of shellSeedIds().filter((id) => id !== pageId)) {
      if (!memberDepth.has(seed)) {
        memberDepth.set(seed, 1);
        color.set(seed, "white");
        worklist.push(seed);
      }
    }
    const viewsByCard = new Map<number, Set<string>>();

    const pushMember = (id: number, viaDepth: number, nodeColor: "white" | "gray"): void => {
      if (memberDepth.has(id)) return;
      memberDepth.set(id, viaDepth);
      color.set(id, nodeColor);
      worklist.push(id);
    };
    const recordCandidateTargets = (cardId: number, isPageCard: boolean): void => {
      if (!isPageCard) return;
      const cardName = byId.get(cardId)?.composedName;
      if (cardName === undefined) return;
      for (const group of ruleSeam.candidatesForCard(cardName)) {
        for (const candidateKey of group.candidateKeys) {
          let candidateLookupKey = candidateKey;
          try {
            candidateLookupKey = DeckoName.parse(candidateKey).key;
          } catch {
          }
          const candidateId = keyToId.get(candidateLookupKey) ?? null;
          if (candidateId !== null || isPageCard) {
            ruleRows.push({
              pageId,
              cardId,
              settingCode: group.settingCode,
              candidateKey,
              candidateId,
            });
          }
          if (candidateId !== null) {
            pushMember(candidateId, (memberDepth.get(cardId) ?? 0) + 1, "gray");
          }
        }
      }
    };
    const recordSearchResults = (cardId: number): void => {
      const ids = searchResultsByNest.get(cardId);
      if (ids === undefined) return;
      for (const resultId of ids) {
        pushMember(resultId, (memberDepth.get(cardId) ?? 0) + 1, "gray");
      }
    };

    while (worklist.length > 0) {
      const current = worklist.shift()!;
      const expands = color.get(current) === "white";
      if (expands) {
        recordCandidateTargets(current, current === pageId);
        recordSearchResults(current);
      }
      for (const edge of adjacency.get(current) ?? []) {
        if (edge.refereeId === null) continue;
        if (edge.refView !== undefined) {
          const set = viewsByCard.get(edge.refereeId);
          if (set === undefined) viewsByCard.set(edge.refereeId, new Set([edge.refView]));
          else set.add(edge.refView);
        }
        pushMember(
          edge.refereeId,
          (memberDepth.get(current) ?? 0) + 1,
          edge.kind === "item" ? "gray" : "white",
        );
      }
    }

    for (const [cardId, cardDepth] of memberDepth) {
      closureRows.push({
        pageId,
        cardId,
        depth: cardDepth,
        views: [...(viewsByCard.get(cardId) ?? [])],
      });
    }
    pages[pageName] = { pageId, closureSize: memberDepth.size };
  }

  for (let i = 0; i < closureRows.length; i += 500) {
    const chunk = closureRows.slice(i, i + 500);
    const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
    await side.query(
      `INSERT INTO one_trip_page_closure (page_id, card_id, depth, views) VALUES ${placeholders}`,
      chunk.flatMap((r) => [r.pageId, r.cardId, r.depth, JSON.stringify(r.views)]),
    );
  }
  for (let i = 0; i < ruleRows.length; i += 500) {
    const chunk = ruleRows.slice(i, i + 500);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    await side.query(
      `INSERT OR IGNORE INTO one_trip_page_rules (page_id, card_id, setting_code, candidate_key, candidate_id) VALUES ${placeholders}`,
      chunk.flatMap((r) => [r.pageId, r.cardId, r.settingCode, r.candidateKey, r.candidateId]),
    );
  }

  const dangling = edgeRows.filter((e) => e.refereeId === null).length;
  const meta: [string, string][] = [
    ["live_cards", String(liveRows.length)],
    ["composed_names", String(composedCount)],
    ["edges", String(edgeRows.length)],
    ["dangling_edges", String(dangling)],
    ["search_nests", String(nests.length)],
    ["stored_inclusion_rows", String(storedInclusion.length)],
    ["parsed_edges", String(derivedIncludeSet.size)],
    ["parsed_not_stored", String(parsedNotStored)],
    ["stored_not_parsed", String(storedNotParsed)],
    ["search_nest_posture", posture],
    ...Object.entries(pages)
      .filter(([, info]) => info.pageId > 0)
      .map(([name, info]) => [`page:${name}`, String(info.pageId)] as [string, string]),
  ];
  for (const [key, value] of meta) {
    await side.query(
      "INSERT INTO one_trip_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  const report: OneTripBuildReport = {
    liveCards: liveRows.length,
    composedNames: composedCount,
    edges: edgeRows.length,
    danglingEdges: dangling,
    searchNests: nests.length,
    pages,
    edgeAgreement: {
      storedInclusionRows: storedInclusion.length,
      parsedEdges: derivedIncludeSet.size,
      parsedNotStored,
      storedNotParsed,
    },
  };
  return report;
}

export async function readPageClosure(
  side: SQLDatabaseDriver,
  pageName: string,
): Promise<{ pageId: number; cardIds: number[] }> {
  const meta = await side.query<{ value: string }>(
    "SELECT value FROM one_trip_meta WHERE key = ?",
    [`page:${pageName}`],
  );
  const pageId = Number(meta.rows[0]?.value);
  if (!Number.isSafeInteger(pageId) || pageId <= 0) {
    return { pageId: -1, cardIds: [] };
  }
  const rows = await side.query<{ card_id: number }>(
    "SELECT card_id FROM one_trip_page_closure WHERE page_id = ? ORDER BY card_id",
    [pageId],
  );
  return { pageId, cardIds: rows.rows.map((r) => r.card_id) };
}
