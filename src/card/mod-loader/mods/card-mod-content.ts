import { str, type ViewContext, type ViewFn } from "../../render/format.js";
import type {
  DeckoModManifest,
  ModEventCard,
  ModEventFn,
  ModEventRegistration,
  ModSetModuleFile,
} from "../mod-manifest.js";
import { superView, viewWrapInherited } from "../mod-view-helpers.js";
import { numberToHumanSize } from "./rails-number-to-human-size.js";
import type { ModEventContext } from "../mod-event-dispatch.js";
import type { FetchEngine } from "../../fetch.js";
import { DeckoName } from "../../name.js";
import { executeQuery, parseOptionsWithLexicon } from "../../../cql/execute.js";
import { CqlBadQuery } from "../../../cql/ast.js";
import { refreshReferencesOut } from "../../actions/refresh-references-out.js";
import { composeCardRecord } from "../../fetch/card-record.js";
import type { CardsRow } from "../../../server/schema.js";
import { findPattern } from "../../set-patterns/registry.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

export async function resetCacheToUseNewStructureEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const fetch: FetchEngine | undefined = ctx.fetch;
  if (fetch === undefined) return;
  fetch.cardCache.reset();
  fetch.lexiconCache.reset();
}

async function structureeQueryRows(
  ctx: ModEventContext,
  ruleCardName: string,
  extraArgs: Record<string, unknown>,
): Promise<CardsRow[] | undefined> {
  const fetch: FetchEngine | undefined = ctx.fetch;
  if (fetch === undefined) return undefined;
  const setCardName = DeckoName.parse(ruleCardName).trunkName;
  const setTypeId = (
    await ctx.driver
      .query<{ id: number }>("SELECT id FROM cards WHERE codename = ? AND trash = 0", ["set"])
      .catch(() => undefined)
  )?.rows[0]?.id;
  if (setTypeId === undefined) return undefined;
  const setCardId = await ctx.lexicon.id(setCardName);
  if (setCardId === undefined) return undefined;
  const setRow = (
    await ctx.driver.query<CardsRow>("SELECT * FROM cards WHERE id = ? AND trash = 0 LIMIT 1", [
      setCardId,
    ])
  ).rows[0];
  if (setRow === undefined || setRow.type_id !== setTypeId) return undefined;
  const raw = setRow.db_content ?? "";
  if (raw.length === 0) throw new CqlBadQuery("can't run search with empty content");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CqlBadQuery(`Invalid JSON search query: ${raw}`);
  }
  const statement: Record<string, unknown> = {
    ...(parsed as Record<string, unknown>),
    ...extraArgs,
    context: setCardName.s,
  };
  const result = await executeQuery(ctx.driver, statement, {
    parse: parseOptionsWithLexicon(fetch.lexicon),
  });
  return "rows" in result ? (result.rows as CardsRow[]) : [];
}

export async function updateStructureesReferencesEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const rows = await structureeQueryRows(ctx, card.name, {});
  if (rows === undefined) return;
  const fetch: FetchEngine | undefined = ctx.fetch;
  if (fetch === undefined) return;
  for (const row of rows) {
    const record = await composeCardRecord(row, fetch.lexicon);
    if (record.id === undefined || record.name === undefined) continue;
    await refreshReferencesOut(ctx.driver, ctx.lexicon, record.id, record.name, record.dbContent);
  }
}

export async function updateStructureesTypeEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const rows = await structureeQueryRows(ctx, card.name, { return: "id" });
  if (rows === undefined) return;
  const ids = rows
    .map((row) => row.id)
    .filter((id): id is number => typeof id === "number");
  for (let slice = 0; slice < ids.length; slice += 100) {
    const batch = ids.slice(slice, slice + 100);
    const placeholders = batch.map(() => "?").join(", ");
    await ctx.driver.query(
      `UPDATE cards SET type_id = ? WHERE id IN (${placeholders})`,
      [card.typeId ?? null, ...batch],
    );
  }
}

const codeContentInputView: ViewFn = (ctx) =>
  superView(ctx, "Abstract::CodeContent", "input")
    || "Content is stored in file and can't be edited.";

function codeContentShortContent(): string {
  return (
    `<i class="notranslate material-icons text-muted pe-2">warning</i>` +
    `<span class="text-muted">file</span>`
  );
}

const codeContentBarMiddleView: ViewFn = () => codeContentShortContent();

const fileSizeView: ViewFn = ({ fmt }: ViewContext) => {
  const card = fmt.card;
  const raw = card.dbContent ?? "";
  const name = card.name.s;
  return `${name}: ${numberToHumanSize(Buffer.byteLength(raw, "utf8"))}`;
};

const hamlFileInputView: ViewFn = (ctx) =>
  superView(ctx, "Abstract::HamlFile", "input")
    || "Content is managed by code and cannot be edited";

const readOnlyInputView: ViewFn = () => "Content can't be edited.";

const defaultOneLineContentView: ViewFn = (ctx: ViewContext) => {
  const card = ctx.fmt.card;
  const typeName = card.typeName ?? "Card";
  const raw = card.dbContent ?? "";
  const body = raw.trim() === "" ? `${typeName} : <em>empty</em>` : `${typeName} : ${raw}`;
  return viewWrapInherited(ctx, "one_line_content", body);
};

const structureOneLineContentView: ViewFn = (ctx: ViewContext) => {
  const card = ctx.fmt.card;
  const raw = card.dbContent ?? "";
  const typeLink = str(ctx.fmt.renderView("type"));
  return viewWrapInherited(ctx, "one_line_content", `${typeLink} : ${raw}`);
};

const setModules: ModSetModuleFile[] = [
  { setPath: "abstract/00_sources" },
  {
    setPath: "abstract/01_code_content",
    formats: {
      html: {
        views: [
          { view: "input", viewFn: codeContentInputView },
          { view: "bar_middle", viewFn: codeContentBarMiddleView },
        ],
      },
    },
  },
  {
    setPath: "abstract/02_code_file",
    formats: {
      html: {
        views: [{ view: "file_size", viewFn: fileSizeView }],
      },
    },
  },
  {
    setPath: "abstract/haml_file",
    formats: {
      html: {
        views: [{ view: "input", viewFn: hamlFileInputView }],
      },
    },
  },
  { setPath: "abstract/lock" },
  {
    setPath: "abstract/read_only",
    formats: {
      html: {
        views: [{ view: "input", viewFn: readOnlyInputView }],
      },
    },
  },
{ setPath: "abstract/templated_nests" },
  { setPath: "all/chunk" },
  { setPath: "all/contextual_content" },
  { setPath: "all/templating" },
  {
    setPath: "right/default",
    formats: {
      html: {
        views: [{ view: "one_line_content", viewFn: defaultOneLineContentView }],
      },
    },
  },
  {
    setPath: "right/structure",
    events: [
      event({
        event: "update_structurees_references",
        at: "integrate",
        when: "update_structurees_references?",
        fn: updateStructureesReferencesEvent,
      }),
      event({
        event: "reset_cache_to_use_new_structure",
        at: "integrate",
        fn: resetCacheToUseNewStructureEvent,
      }),
      event({
        event: "update_structurees_type",
        at: "finalize",
        changed: ["type_id"],
        when: "assigns_type?",
        fn: updateStructureesTypeEvent,
      }),
    ],
    formats: {
      html: {
        views: [
          { view: "one_line_content", viewFn: structureOneLineContentView },
        ],
      },
    },
  },
  {
    setPath: "self/default",
    settingOpts: {
      group: "templating",
      position: 2,
      ruleTypeEditable: true,
      shortHelpText: "type/content template for new cards",
    },
  },
  {
    setPath: "self/structure",
    settingOpts: {
      group: "templating",
      position: 2,
      ruleTypeEditable: true,
      shortHelpText: "control card's content / structure",
      helpText:
        "Controls cards' content / structure. " +
        "[[http://decko.org/formatting|more]]",
    },
  },
];

export const contentModEventPredicates = {
  "update_structurees_references?": (card: ModEventCard): boolean =>
    (card.changedFields ?? []).includes("db_content") || card.action === "delete",

  "assigns_type?": async (card: ModEventCard, ctx?: ModEventContext): Promise<boolean> => {
    if (ctx === undefined) return false;
    const tagKey = DeckoName.parse(card.name).trunkName.tagKey;
    const tagRow = (
      await ctx.driver.query<{ codename: string | null }>(
        "SELECT codename FROM cards WHERE key = ? AND trash = 0 LIMIT 1",
        [tagKey],
      ).catch(() => undefined)
    )?.rows[0];
    const patternCode = tagRow?.codename;
    if (patternCode === null || patternCode === undefined || patternCode === "") return false;
    return findPattern(patternCode)?.assignsType === true;
  },
} as const;

const cardModContent: DeckoModManifest = {
  name: "content",
  gemName: "card-mod-content",
  group: "gem",
  setModules,
};

export default cardModContent;