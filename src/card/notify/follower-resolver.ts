import type { CardRecord } from "../fetch/card-record.js";
import {
  CARD_DB_CONTENT_BY_JUNCTION_SQL,
  CARD_ID_BY_JUNCTION_ORDERED_SQL,
  CARD_ID_BY_JUNCTION_SQL,
  CARD_IDS_BY_TYPE_SQL,
  CARD_NAME_TRIPLE_BY_ID_SQL,
  LIVE_CARD_ROW_BY_ID_SQL,
} from "../fetch/card-read-shapes.js";
import type { FetchEngine } from "../fetch.js";
import { DeckoName } from "../name.js";
import type { SQLStatement } from "../../server/driver.js";
import type { SavePathEvent } from "./types.js";
import { deckEmailTemplateResolver } from "./deck-resolvers.js";
import { followMailViews } from "./follow-mail-views.js";
import {
  readPermissionStatements,
  readPermissionStateFromViewerResults,
  canReadByStoredRule,
  canReadByRuleLookup,
} from "../permissions/read-rules.js";
import { readPermissionOverride } from "../permissions/read-override.js";
import { ruleWalkPatternInput } from "../actions/rule-content-walk.js";
import type { EmailTemplateResolver, FollowNotifyDeps, FollowerRef, FollowerResolver } from "./follow-notify.js";

interface PreferenceRow {
  rule_id: number;
  set_id: number;
  set_left_id: number | null;
  set_own_codename: string | null;
  set_right_codename: string | null;
  setting_codename: string | null;
  user_id: number;
  content: string | null;
}

interface CardSetPattern {
  readonly setName: string;
  readonly lookupKey: string;
}

const OPTION_ALWAYS = "always";
const OPTION_NEVER = "never";
const OPTION_CREATED = "created";
const OPTION_EDITED = "edited";

async function followerCandidateIds(
  fetch: FetchEngine,
  card: CardRecord,
  optionCode: string | null,
): Promise<readonly number[]> {
  if (optionCode === OPTION_CREATED) return [card.creatorId ?? -1];
  if (optionCode === OPTION_EDITED) return editorIds(fetch, card.id);
  return [];
}

async function editorIds(fetch: FetchEngine, cardId: number | undefined): Promise<number[]> {
  if (cardId === undefined) return [];
  const r = await fetch.driver.query<{ actor_id: number }>(
    `SELECT DISTINCT ca.actor_id AS actor_id
       FROM card_actions a
       JOIN card_acts ca ON ca.id = a.card_act_id
      WHERE a.card_id = ?`,
    [cardId],
  );
  return r.rows.map((row) => Number(row.actor_id));
}

function optionApplies(
  optionCode: string | null,
  followerId: number,
  candidateIds: readonly number[],
): boolean {
  if (optionCode === OPTION_ALWAYS) return true;
  if (optionCode === OPTION_NEVER) return false;
  return candidateIds.includes(followerId);
}

async function setPatternsOf(fetch: FetchEngine, card: CardRecord): Promise<CardSetPattern[]> {
  const name = card.name;
  if (name === undefined) return [];
  const patterns: CardSetPattern[] = [];

  patterns.push({ setName: "*all", lookupKey: "all" });
  if (!name.isSimple) patterns.push({ setName: "*all plus", lookupKey: "all_plus" });

  if (card.typeId !== undefined) {
    if (
      !name.isSimple &&
      card.rightId !== undefined &&
      card.rightId !== null &&
      typeof fetch.driver?.batch === "function"
    ) {
      const statements: SQLStatement[] = [
        { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [card.typeId] },
        { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [card.typeId] },
        { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [card.rightId] },
        { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [card.rightId] },
      ];
      if (card.leftId !== undefined && card.leftId !== null) {
        statements.push(
          { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [card.leftId] },
          { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [card.leftId] },
        );
      }
      await fetch.driver.batch(statements);
    }
    const typeName = (await fetch.fetchById(card.typeId))?.name;
    if (typeName !== undefined) {
      patterns.push({ setName: `${typeName.s}+*type`, lookupKey: `${card.typeId}+type` });
    }
  }

  if (name.isSimple && name.s.startsWith("*")) {
    patterns.push({ setName: "*star", lookupKey: "star" });
  }
  const rightName = name.rightName;
  if (!name.isSimple && rightName !== undefined && rightName.s.startsWith("*")) {
    patterns.push({ setName: "*rstar", lookupKey: "rstar" });
  }

  if (await isRuleCard(fetch, card)) {
    patterns.push({ setName: "*rule", lookupKey: "rule" });
  }

  if (!name.isSimple && rightName !== undefined) {
    const tagId = await fetch.lexicon.id(rightName);
    if (tagId !== undefined) {
      patterns.push({ setName: `${rightName.s}+*right`, lookupKey: `${tagId}+right` });
    }
    const leftName = name.leftName;
    if (leftName !== undefined) {
      const leftType = await typeOfCard(fetch, leftName);
      if (leftType !== undefined) {
        const anchorName = DeckoName.parse(`${leftType}+${rightName.s}`);
        const anchorId = await fetch.lexicon.id(anchorName);
        if (anchorId !== undefined) {
          patterns.push({
            setName: `${leftType}+${rightName.s}+*type plus right`,
            lookupKey: `${anchorId}+type_plus_right`,
          });
        }
      }
    }
  }

  patterns.push({ setName: `${name.s}+*self`, lookupKey: `${card.id}+self` });
  return patterns.reverse();
}

async function isRuleCard(fetch: FetchEngine, card: CardRecord): Promise<boolean> {
  const name = card.name;
  if (name === undefined || name.isSimple) return false;
  const [settingId, setId, userId] = await Promise.all([
    fetch.codenames.id("setting"),
    fetch.codenames.id("set"),
    fetch.codenames.id("user"),
  ]);
  if (settingId === undefined) return false;

  const right = card.rightId !== undefined && card.rightId !== null
    ? await fetch.fetchById(card.rightId)
    : await fetch.fetchByName(name.tagName);
  if (right?.typeId !== settingId) return false;

  const left = card.leftId !== undefined && card.leftId !== null
    ? await fetch.fetchById(card.leftId)
    : await fetch.fetchByName(name.leftName as DeckoName);
  if (setId !== undefined && left?.typeId === setId) return true;

  const parts = name.partNames;
  if (parts.length <= 2 || setId === undefined) return false;
  const prefererName = parts[parts.length - 2];
  const setPartName = parts.length > 2 ? name.getRange(0, -3) : undefined;
  if (setPartName === undefined || prefererName === undefined) return false;
  const setPart = await fetch.fetchByName(setPartName);
  if (setPart?.typeId !== setId) return false;
  const preferer = await fetch.fetchByName(prefererName);
  if (preferer === undefined) return false;
  const allId = await fetch.codenames.id("all");
  const prefererIsUser = (userId !== undefined && preferer.typeId === userId) ||
    (allId !== undefined && preferer.id === allId);
  return prefererIsUser;
}

async function typeOfCard(fetch: FetchEngine, name: DeckoName): Promise<string | undefined> {
  const card = await fetch.fetchByName(name);
  if (card?.typeId === undefined) return undefined;
  return (await fetch.fetchById(card.typeId))?.name?.s;
}

async function preferenceRows(fetch: FetchEngine): Promise<PreferenceRow[]> {
  const [setId, settingId, userId] = await Promise.all([
    fetch.codenames.id("set"),
    fetch.codenames.id("setting"),
    fetch.codenames.id("user"),
  ]);
  if (setId === undefined || settingId === undefined || userId === undefined) return [];

  const r = await fetch.driver.query<PreferenceRow>(
    `SELECT preferences.id AS rule_id,
            sets.id AS set_id,
            sets.left_id AS set_left_id,
            sets.codename AS set_own_codename,
            set_right.codename AS set_right_codename,
            settings.codename AS setting_codename,
            users.id AS user_id,
            preferences.db_content AS content
       FROM cards preferences
       JOIN cards user_sets ON preferences.left_id  = user_sets.id
       JOIN cards settings  ON preferences.right_id = settings.id
       JOIN cards users     ON user_sets.right_id   = users.id
       JOIN cards sets      ON user_sets.left_id    = sets.id
       LEFT JOIN cards set_right ON set_right.id = sets.right_id
      WHERE sets.type_id     = ?
        AND settings.type_id = ?
        AND (users.type_id = ? OR users.codename = 'all')
        AND sets.trash        = 0
        AND settings.trash    = 0
        AND users.trash       = 0
        AND user_sets.trash   = 0
        AND preferences.trash = 0`,
    [setId, settingId, userId],
  );
  return r.rows;
}

function setRowKeyBase(row: PreferenceRow): string | null {
  if (row.set_left_id !== null && row.set_left_id !== undefined) {
    const rightCode = row.set_right_codename;
    return rightCode === null || rightCode === undefined
      ? null
      : `${row.set_left_id}+${rightCode}`;
  }
  const ownCode = row.set_own_codename;
  return ownCode === null || ownCode === undefined ? null : ownCode;
}

interface PreferenceIndex {
  readonly userIdsBySet: Map<string, number[]>;
  readonly ruleContentByUser: Map<string, string>;
}

function indexPreferenceRows(rows: readonly PreferenceRow[]): PreferenceIndex {
  const userIdsBySet = new Map<string, number[]>();
  const ruleContentByUser = new Map<string, string>();
  for (const row of rows) {
    const base = setRowKeyBase(row);
    if (base === null) continue;
    const setting = row.setting_codename;
    if (setting === null || setting === undefined) continue;
    const setKey = `${base}+${setting}`;
    const users = userIdsBySet.get(setKey);
    if (users === undefined) userIdsBySet.set(setKey, [row.user_id]);
    else if (!users.includes(row.user_id)) users.push(row.user_id);
    ruleContentByUser.set(`${setKey}+${row.user_id}`, row.content ?? "");
  }
  return { userIdsBySet, ruleContentByUser };
}

interface FollowerResolutionScope {
  preferenceIndex(): Promise<PreferenceIndex>;
  userTypeIds(): Promise<readonly number[]>;
}

function oncePreferenceIndex(
  fetch: FetchEngine,
): () => Promise<PreferenceIndex> {
  let pending: Promise<PreferenceIndex> | undefined;
  return () => {
    pending ??= (async () => indexPreferenceRows(await preferenceRows(fetch)))();
    return pending;
  };
}

async function enumeratedUserIds(
  fetch: FetchEngine,
  index: PreferenceIndex,
  lookupKey: string,
  userTypeIds?: () => Promise<readonly number[]>,
): Promise<readonly number[]> {
  const userIds = index.userIdsBySet.get(`${lookupKey}+follow`);
  if (userIds === undefined) return [];
  const allId = await fetch.codenames.id("all");
  if (allId === undefined || !userIds.includes(allId)) return userIds;
  const userId = await fetch.codenames.id("user");
  if (userId === undefined) return userIds;
  if (userTypeIds !== undefined) return userTypeIds();
  const r = await fetch.driver.query<{ id: number }>(
    CARD_IDS_BY_TYPE_SQL,
    [userId],
  );
  return r.rows.map((row) => Number(row.id));
}

function onceUserTypeIds(
  fetch: FetchEngine,
): () => Promise<readonly number[]> {
  let pending: Promise<readonly number[]> | undefined;
  return () => {
    pending ??= (async () => {
      const userId = await fetch.codenames.id("user");
      if (userId === undefined) return [];
      const r = await fetch.driver.query<{ id: number }>(
        CARD_IDS_BY_TYPE_SQL,
        [userId],
      );
      return r.rows.map((row) => Number(row.id));
    })();
    return pending;
  };
}

async function followRuleContent(
  fetch: FetchEngine,
  index: PreferenceIndex,
  patterns: readonly CardSetPattern[],
  followerId: number,
  allId: number | undefined,
): Promise<string | null> {
  for (const pattern of patterns) {
    const own = index.ruleContentByUser.get(`${pattern.lookupKey}+follow+${followerId}`);
    if (own !== undefined) return own;
    if (allId !== undefined) {
      const fallback = index.ruleContentByUser.get(`${pattern.lookupKey}+follow+${allId}`);
      if (fallback !== undefined) return fallback;
    }
  }
  return null;
}

async function optionCodeOfLine(
  fetch: FetchEngine,
  line: string,
): Promise<string | null> {
  const bare = line.replace(/[[\]]/g, "").trim();
  const id = await fetch.lexicon.id(DeckoName.parse(bare));
  if (id === undefined) return null;
  if (typeof fetch.codenames.nameForId === "function") {
    const code = await fetch.codenames.nameForId(id);
    if (code !== undefined) return code;
  }
  const card = await fetch.fetchById(id);
  return card?.codename ?? null;
}

async function followRuleOption(
  fetch: FetchEngine,
  card: CardRecord,
  index: PreferenceIndex,
  patterns: readonly CardSetPattern[],
  followerId: number,
  allId: number | undefined,
): Promise<string | null> {
  const content = await followRuleContent(fetch, index, patterns, followerId, allId);
  if (content === null || content === "") return null;
  for (const line of content.split("\n")) {
    const optionCode = await optionCodeOfLine(fetch, line);
    const candidates = await followerCandidateIds(fetch, card, optionCode);
    if (optionApplies(optionCode, followerId, candidates)) {
      return line.replace(/[[\]]/g, "");
    }
  }
  return null;
}

async function followerEmail(fetch: FetchEngine, followerId: number): Promise<string | null> {
  const follower = await fetch.fetchById(followerId);
  const followerName = follower?.name;
  if (followerName === undefined) return null;
  const emailCard = await fetch.fetchByName(`${followerName.s}+*account+*email`);
  const email = emailCard?.dbContent;
  return email === undefined || email === "" ? null : email;
}

export async function resolveFollowers(
  fetch: FetchEngine,
  cardId: number | null,
  event?: Pick<SavePathEvent, "isDeletePath">,
  scope?: FollowerResolutionScope,
): Promise<readonly FollowerRef[]> {
  if (cardId === null) return [];
  const deletePath = event?.isDeletePath === true;
  const card = await fetch.fetchById(cardId, deletePath ? { lookInTrash: true } : {});
  if (card === undefined || (card.trash && !deletePath)) return [];

  const seen = new Set<number>();
  const refs: FollowerRef[] = [];
  const shared = scope ?? followerResolutionScope(fetch);
  await stashDirectFollowers(fetch, card, seen, refs, shared);
  await stashFieldFollowers(fetch, card, seen, refs, shared);
  return refs;
}

export function followerResolutionScope(fetch: FetchEngine): FollowerResolutionScope {
  const preferenceIndex = oncePreferenceIndex(fetch);
  const userTypeIds = onceUserTypeIds(fetch);
  return {
    preferenceIndex: () => preferenceIndex(),
    userTypeIds: () => userTypeIds(),
  };
}

async function stashDirectFollowers(
  fetch: FetchEngine,
  card: CardRecord,
  seen: Set<number>,
  refs: FollowerRef[],
  scope: FollowerResolutionScope,
): Promise<void> {
  const patterns = await setPatternsOf(fetch, card);
  const index = await scope.preferenceIndex();
  const allId = await fetch.codenames.id("all");

  for (const pattern of patterns) {
    const userIds = await enumeratedUserIds(fetch, index, pattern.lookupKey, scope.userTypeIds);
    for (const followerId of userIds) {
      if (seen.has(followerId)) continue;
      const option = await followRuleOption(fetch, card, index, patterns, followerId, allId);
      if (option === null) continue;
      seen.add(followerId);
      const accountTagId = await fetch.lexicon.id("*account");
      const emailTagId = await fetch.lexicon.id("*email");
      const followerStatements: SQLStatement[] = [
        { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [followerId] },
        { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [followerId] },
      ];
      if (accountTagId !== undefined) {
        followerStatements.push({ sql: CARD_ID_BY_JUNCTION_SQL, params: [followerId, accountTagId] });
      }
      const followerBatch = await fetch.driver.batch(followerStatements);
      const accountCardId =
        accountTagId !== undefined
          ? (followerBatch[2]?.rows[0] as { id?: number } | undefined)?.id
          : undefined;
      if (accountCardId !== undefined && emailTagId !== undefined) {
        const emailIdRes = await fetch.driver.query<{ id: number }>(
          CARD_ID_BY_JUNCTION_SQL,
          [accountCardId, emailTagId],
        );
        const emailCardId = emailIdRes.rows[0]?.id;
        if (emailCardId !== undefined) {
          await fetch.driver.query(LIVE_CARD_ROW_BY_ID_SQL, [emailCardId]);
        }
      }
      const follower = await fetch.fetchById(followerId);
      if (follower === undefined) continue;
      refs.push({
        followerId,
        followerName: follower.name?.s ?? "",
        followerEmail: await followerEmail(fetch, followerId),
        followedSetName: pattern.setName,
        followOption: option,
      });
    }
  }
}

async function stashFieldFollowers(
  fetch: FetchEngine,
  card: CardRecord,
  seen: Set<number>,
  refs: FollowerRef[],
  scope: FollowerResolutionScope,
): Promise<void> {
  let leftName = card.name?.leftName;
  while (leftName !== undefined) {
    const left = await fetch.fetchByName(leftName);
    if (left === undefined || left.trash) break;
    if (await followedField(fetch, left, card)) {
      await stashDirectFollowers(fetch, left, seen, refs, scope);
    }
    leftName = left.name?.leftName;
  }
}

async function followedField(
  fetch: FetchEngine,
  left: CardRecord,
  field: CardRecord,
): Promise<boolean> {
  const { content, nested } = await followFieldsRuleContent(
    fetch,
    left,
    nestedCardStatement(left, field),
  );
  if (content === null || content === "") return false;
  for (const item of content.split("\n")) {
    const itemKey = DeckoName.parse(item.trim()).key;
    if (field.name !== undefined && itemKey === field.name.key) return true;
    if (itemKey === NESTS_KEY && nested) return true;
  }
  return false;
}

const NESTS_KEY = "*nest";

export const NEST_COUNT_SQL =
  "SELECT COUNT(*) AS n FROM card_references WHERE referer_id = ? AND ref_type = 'I' AND referee_id = ?";

function nestedCardStatement(
  left: CardRecord,
  field: CardRecord,
): SQLStatement | undefined {
  if (left.id === undefined || field.id === undefined) return undefined;
  return { sql: NEST_COUNT_SQL, params: [left.id, field.id] };
}

function nestedCardAnswer(rows: unknown): boolean {
  const row = (rows as Array<{ n?: unknown }> | undefined)?.[0];
  return Number(row?.n ?? 0) > 0;
}

async function followFieldsRuleContent(
  fetch: FetchEngine,
  left: CardRecord,
  companion?: SQLStatement,
): Promise<{ content: string | null; nested: boolean }> {
  const settingId = await fetch.codenames.id("follow_fields");
  if (settingId === undefined) return { content: null, nested: false };
  const patterns = await setPatternsOf(fetch, left);
  const setIds = await setCardIdsForPatterns(fetch, patterns);
  const wanted: number[] = [];
  for (let i = 0; i < patterns.length; i += 1) {
    if (setIds[i] !== undefined) wanted.push(i);
  }
  if (wanted.length === 0) return { content: null, nested: false };
  const statements: SQLStatement[] = wanted.map((i) => ({
    sql: CARD_DB_CONTENT_BY_JUNCTION_SQL,
    params: [setIds[i], settingId],
  }));
  const companionIndex = companion === undefined ? -1 : statements.length;
  if (companion !== undefined) statements.push(companion);
  const results =
    statements.length === 1
      ? [
          await fetch.driver.query<{ db_content: string | null }>(
            statements[0]?.sql as string,
            statements[0]?.params ?? [],
          ),
        ]
      : await fetch.driver.batch(statements);
  let content: string | null = null;
  for (let k = 0; k < wanted.length; k += 1) {
    const row = results[k]?.rows[0] as { db_content: string | null } | undefined;
    const value = row?.db_content;
    if (value !== undefined && value !== null) {
      content = value;
      break;
    }
  }
  const nested = companionIndex < 0 ? false : nestedCardAnswer(results[companionIndex]?.rows);
  return { content, nested };
}

async function setCardIdsForPatterns(
  fetch: FetchEngine,
  patterns: readonly CardSetPattern[],
): Promise<(number | undefined)[]> {
  const ids: (number | undefined)[] = patterns.map(() => undefined);
  const anchored: Array<{ index: number; anchorId: number; patternCardId: number }> = [];
  for (let i = 0; i < patterns.length; i += 1) {
    const lookupKey = patterns[i]?.lookupKey ?? "";
    const plus = lookupKey.lastIndexOf("+");
    if (plus === -1) continue;
    const anchorId = Number(lookupKey.slice(0, plus));
    const code = lookupKey.slice(plus + 1);
    const patternCardId = await fetch.codenames.id(code);
    if (patternCardId === undefined || Number.isNaN(anchorId)) continue;
    anchored.push({ index: i, anchorId, patternCardId });
  }
  if (anchored.length > 0) {
    const statements = anchored.map((entry) => ({
      sql: CARD_ID_BY_JUNCTION_ORDERED_SQL,
      params: [entry.anchorId, entry.patternCardId],
    }));
    const results =
      statements.length === 1
        ? [
            await fetch.driver.query<{ id: number }>(
              statements[0]?.sql as string,
              statements[0]?.params ?? [],
            ),
          ]
        : await fetch.driver.batch(statements);
    for (let i = 0; i < anchored.length; i += 1) {
      const row = results[i]?.rows[0] as { id: number } | undefined;
      if (row?.id !== undefined) ids[anchored[i]?.index as number] = Number(row.id);
    }
  }
  for (let i = 0; i < patterns.length; i += 1) {
    if (ids[i] !== undefined) continue;
    const lookupKey = patterns[i]?.lookupKey ?? "";
    if (lookupKey.lastIndexOf("+") !== -1) continue;
    ids[i] = await fetch.codenames.id(lookupKey);
  }
  return ids;
}

export function defaultFollowerResolver(fetch: FetchEngine): FollowerResolver {
  const scope = followerResolutionScope(fetch);
  return async (cardId: number | null, event: SavePathEvent): Promise<readonly FollowerRef[]> => {
    const refs = await resolveFollowers(fetch, cardId, event, scope);
    return refs.filter((ref) => ref.followerId !== event.actor.id);
  };
}

async function cardReaderForViewer(fetch: FetchEngine, viewerId: number) {
  const viewer = { signedIn: true, actorId: viewerId };
  const state = readPermissionStateFromViewerResults(
    await fetch.driver.batch([
      ...readPermissionStatements(viewer),
      { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [viewerId] },
      { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [viewerId] },
    ]),
    viewer,
  );
  const viewerKey = (await fetch.fetchById(viewerId))?.key ?? undefined;
  const allowed = async (card: CardRecord | undefined, depth = 0): Promise<boolean> => {
    if (card?.name === undefined) return false;
    if (state.alwaysOk) return true;
    const override = await readPermissionOverride(card.name, {
      viewerKey,
      fetchByKey: key => fetch.fetchByKey(key),
      fetchById: id => fetch.fetchById(id),
      leftReadVerdict: async (name, nextDepth) => allowed(await fetch.fetchByKey(name.key), nextDepth),
    }, depth);
    if (override !== undefined) return override;
    if (card.readRuleId != null) return canReadByStoredRule(card.readRuleId, state);
    return (await canReadByRuleLookup(fetch, await ruleWalkPatternInput(fetch, {
      name: card.name, id: card.id, typeId: card.typeId, isNew: false,
    }), state)) === true;
  };
  const memo = new Map<number, Promise<boolean>>();
  return (id: number): Promise<boolean> => {
    let verdict = memo.get(id);
    if (verdict === undefined) {
      verdict = fetch.fetchById(id, { lookInTrash: true }).then(card => allowed(card));
      memo.set(id, verdict);
    }
    return verdict;
  };
}

export function defaultFollowNotifyDeps(
  fetch: FetchEngine,
  opts: {
    followers?: FollowerResolver;
    template?: EmailTemplateResolver;
    mail?: { origin: string; deckoBotEmail: string };
  } = {},
): FollowNotifyDeps {
  const mail = opts.mail;
  return {
    ...(mail === undefined
      ? {}
      : {
          deckoBotEmail: mail.deckoBotEmail,
          actContext: async (act) => {
            const viewer = { signedIn: true, actorId: act.actor.id };
            const initialBatch = await fetch.driver.batch([
              { sql: "SELECT card_id FROM card_acts WHERE id = ?", params: [act.actId] },
              {
                sql:
                  "SELECT DISTINCT a.card_id FROM card_actions a WHERE a.card_act_id = ? " +
                  "AND (a.card_id = (SELECT card_id FROM card_acts WHERE id = ?) OR EXISTS (SELECT 1 FROM card_references r " +
                  "WHERE r.referer_id = (SELECT card_id FROM card_acts WHERE id = ?) AND r.referee_id = a.card_id AND r.ref_type = 'I'))",
                params: [act.actId, act.actId, act.actId],
              },
              ...readPermissionStatements(viewer),
              { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [act.actor.id] },
              { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [act.actor.id] },
            ]);
            const row = (initialBatch[0]?.rows ?? [])[0] as { card_id: number | null } | undefined;
            const cardId = row?.card_id ?? null;
            const card = cardId === null ? undefined : await fetch.fetchById(cardId, { lookInTrash: true });
            if (cardId === null || card?.name === undefined) {
              return { cardId, cardName: null, changesVisible: false };
            }
            const actionRows = (initialBatch[1]?.rows ?? []) as Array<{ card_id: number }>;
            const canRead = await cardReaderForViewer(fetch, act.actor.id);
            let changesVisible = false;
            for (const action of actionRows) {
              if (await canRead(Number(action.card_id))) { changesVisible = true; break; }
            }
            return { cardId, cardName: card.name.s, changesVisible };
          },
          views: async ({ act, actCardId, ref }) =>
            followMailViews(fetch, {
              canReadCard: await cardReaderForViewer(fetch, ref.followerId),
              origin: mail.origin,
              actId: act.actId,
              actCardId,
              actorId: act.actor.id,
              followerName: ref.followerName,
              followedSetName: ref.followedSetName,
              followOption: ref.followOption,
            }),
        }),
    followers: opts.followers ?? defaultFollowerResolver(fetch),
    template: opts.template ?? deckEmailTemplateResolver(fetch),
    authAs: (id: number, name: string) => ({ id, name, email: null }),
    defaultFrom: "",
  };
}

export {
  followerCandidateIds,
  optionApplies,
  setPatternsOf,
  preferenceRows,
  indexPreferenceRows,
  enumeratedUserIds,
  followRuleContent,
  followRuleOption,
  optionCodeOfLine,
};
export type { CardSetPattern, PreferenceIndex, PreferenceRow };
