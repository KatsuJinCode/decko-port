import type { CardRecord } from "../fetch/card-record.js";
import type { FetchEngine } from "../fetch.js";
import type { RenderCard } from "../render/format.js";
import type { ReadViewer } from "../permissions/read-rules.js";
import { DeckoName } from "../name.js";
import { cardBelongsToSet } from "../render/content-overrides.js";
import { FOLLOW_OPTION_ALL } from "./follow-options.js";
import { followRuleContent, resolveFollowers } from "../notify/follower-resolver.js";
import {
  followRuleNameFor,
  followRuleOptionFor,
  followSetCardName,
  followWalkContext,
} from "./follow-rule-walk.js";

export const FOLLOWERS_SET_PATH = "right/followers";
export const USER_FOLLOW_SET_PATH = "type_plus_right/user/follow";
export const FOLLOWING_SET_PATH = "right/following";

export function isFollowersJunction(card: RenderCard): boolean {
  return cardBelongsToSet(card, FOLLOWERS_SET_PATH);
}

export function isUserFollowDashboard(card: RenderCard): boolean {
  return cardBelongsToSet(card, USER_FOLLOW_SET_PATH);
}

export function isFollowingJunction(card: RenderCard): boolean {
  return cardBelongsToSet(card, FOLLOWING_SET_PATH);
}

export function followSeamRootNeeded(card: RenderCard): boolean {
  return (
    isFollowersJunction(card) || isUserFollowDashboard(card) || isFollowingJunction(card)
  );
}

export const FOLLOW_SEAM_VIEWS: ReadonlySet<string> = new Set([
  "follow_button",
  "follow_tab",
  "ignore_tab",
  "content",
  "core",
  "titled",
  "open",
  "link_with_checkbox",
  "closure",
  "follow_section",
  "engage_tab",
  "rule_editor",
]);

export interface FollowActorSession {
  readonly actorId: number;
  readonly actorName: string;
}

export interface FollowTabRow {
  readonly ruleCardName: string;
  readonly option: string;
  readonly ruleSetName: string;
}

export interface FollowRenderBundle {
  readonly session: FollowActorSession | undefined;
  readonly followed: boolean;
  readonly followMark: string | undefined;
  readonly followLabel: string;
  readonly followerCount: number;
  readonly followerNames: readonly string[];
  readonly followPreferenceNames: readonly string[];
  readonly followTabRows: readonly FollowTabRow[];
  readonly ignoreTabRows: readonly FollowTabRow[];
  readonly closureDeletions: readonly { readonly name: string }[];
  readonly leftFollowPreference: string | undefined;
  readonly ruleEditorPreferenceName: string | undefined;
  readonly ruleEditorTargetName: string | undefined;
}

async function anonymousActorName(
  fetch: FetchEngine,
): Promise<string> {
  const anonId = await fetch.codenames.id("anon");
  if (anonId !== undefined) {
    const name = (await fetch.fetchById(anonId))?.name?.s;
    if (name !== undefined) return name;
  }
  return "Anonymous";
}

async function closureDeletions(
  fetch: FetchEngine,
  userId: number,
): Promise<{ readonly name: string }[]> {
  const accountId = await fetch.codenames.id("account");
  const r = await fetch.driver.query<{ id: number }>(
    `SELECT id FROM cards
      WHERE left_id = ? AND trash = 0
        AND (right_id IS NULL OR right_id != ?)
      ORDER BY id`,
    [userId, accountId ?? -1],
  );
  const out: { readonly name: string }[] = [];
  for (const row of r.rows) {
    const name = (await fetch.fetchById(row.id))?.name?.s;
    if (name !== undefined) out.push({ name });
  }
  return out;
}

export interface FollowEditorRowsOptions {
  readonly sessionId?: number;
  readonly trunkId?: number;
}

export async function followEditorRows(
  fetch: FetchEngine,
  userName: string,
  opts: FollowEditorRowsOptions = {},
): Promise<{ following: FollowTabRow[]; ignoring: FollowTabRow[] }> {
  const following: FollowTabRow[] = [];
  const ignoring: FollowTabRow[] = [];
  const userId = await fetch.lexicon.id(DeckoName.parse(userName));
  if (userId === undefined) return { following, ignoring };

  const [setId, followSettingId] = await Promise.all([
    fetch.codenames.id("set"),
    fetch.codenames.id("follow"),
  ]);
  if (setId === undefined || followSettingId === undefined) {
    return { following, ignoring };
  }
  const r = await fetch.driver.query<{
    id: number;
    content: string | null;
    set_id: number;
  }>(
    `SELECT p.id AS id, p.db_content AS content, set_card.id AS set_id
       FROM cards p
       JOIN cards user_set ON p.left_id  = user_set.id
       JOIN cards set_card ON user_set.left_id = set_card.id
      WHERE p.right_id       = ?
        AND set_card.type_id = ?
        AND user_set.right_id = ?
        AND p.trash = 0 AND user_set.trash = 0 AND set_card.trash = 0
      ORDER BY set_card.id, p.id`,
    [followSettingId, setId, userId],
  );

  const never = DeckoName.parse("*never").key;
  for (const row of r.rows) {
    const ruleCardName = (await fetch.fetchById(row.id))?.name?.s;
    const ruleSetName = (await fetch.fetchById(row.set_id))?.name?.s;
    if (ruleCardName === undefined) continue;
    const items = (row.content ?? "")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^\[\[/, "").replace(/\]\]$/, ""));
    const isIgnoreRule = items.some((item) => DeckoName.parse(item).key === never);
    if (isIgnoreRule) {
      ignoring.push({
        ruleCardName,
        option: "*never",
        ruleSetName: ruleSetName ?? "",
      });
    } else {
      for (const option of items) {
        following.push({
          ruleCardName,
          option,
          ruleSetName: ruleSetName ?? "",
        });
      }
    }
  }

  if (
    opts.sessionId !== undefined &&
    opts.trunkId !== undefined &&
    opts.sessionId === opts.trunkId
  ) {
    const suggested = await suggestedFollowingRuleOptions(fetch, userName);
    mergeOptionHashes(following, suggested);
  }
  return { following, ignoring };
}

interface SuggestedOption {
  readonly option: string;
  readonly setName: string;
}
type SuggestedOptions = Map<string, SuggestedOption>;

async function suggestedFollowingRuleOptions(
  fetch: FetchEngine,
  trunkName: string,
): Promise<SuggestedOptions> {
  const hash: SuggestedOptions = new Map();
  const suggestionsId = await fetch.codenames.id("follow_suggestions");
  if (suggestionsId === undefined) return hash;
  const r = await fetch.driver.query<{ db_content: string | null }>(
    `SELECT db_content FROM cards WHERE id = ? AND trash = 0`,
    [suggestionsId],
  );
  const content = r.rows[0]?.db_content;
  if (content === undefined || content === null || content === "") return hash;

  for (const line of content.split("\n")) {
    const sug = line.replace(/^\[\[/, "").replace(/\]\]$/, "");
    if (sug.length === 0) continue;
    const sugName = DeckoName.parse(sug);
    const setName = sugName.leftName?.s;
    const optName = sugName.rightName?.s;
    if (setName === undefined || optName === undefined) continue;
    const [setCard, setTypeId] = await Promise.all([
      fetch.fetchByName(setName),
      fetch.codenames.id("set"),
    ]);
    if (setCard === undefined || setCard.name === undefined) continue;
    if (setTypeId === undefined || setCard.typeId !== setTypeId) continue;
    const option = await suggestedFollowOption(fetch, optName);
    const ruleKey = DeckoName.parse(
      followRuleNameFor(setCard.name.s, trunkName),
    ).key;
    hash.set(ruleKey, { option, setName: setCard.name.s });
  }
  return hash;
}

async function suggestedFollowOption(
  fetch: FetchEngine,
  optName: string,
): Promise<string> {
  let card = await fetch.fetchByName(optName);
  if (card === undefined) {
    const codenameId = await fetch.codenames.id(optName);
    if (codenameId !== undefined) {
      card = await fetch.fetchById(codenameId);
    }
  }
  const codename = card?.codename;
  if (card === undefined || codename === undefined || codename === null) {
    return "*always";
  }
  return FOLLOW_OPTION_ALL.includes(codename)
    ? (card?.name?.s ?? "*always")
    : "*always";
}

function mergeOptionHashes(
  following: FollowTabRow[],
  suggested: SuggestedOptions,
): void {
  const seenRules = new Set<string>();
  for (const row of following) {
    const key = DeckoName.parse(row.ruleCardName).key;
    const hit = suggested.get(key);
    if (hit === undefined) continue;
    suggested.delete(key);
    if (seenRules.has(key)) continue;
    seenRules.add(key);
    if (
      !following.some(
        (r) =>
          DeckoName.parse(r.ruleCardName).key === key && r.option === hit.option,
      )
    ) {
      following.push({
        ruleCardName: row.ruleCardName,
        option: hit.option,
        ruleSetName: row.ruleSetName,
      });
    }
  }
  for (const [ruleKey, hit] of suggested) {
    following.push({
      ruleCardName: ruleKey,
      option: hit.option,
      ruleSetName: hit.setName,
    });
  }
}

async function resolveSession(
  fetch: FetchEngine,
  pageSession: ReadViewer | undefined,
): Promise<FollowActorSession | undefined> {
  if (pageSession?.signedIn !== true || pageSession.actorId === undefined) {
    return undefined;
  }
  const actor = await fetch.fetchById(pageSession.actorId, { skipVirtual: true });
  const name = actor?.name?.s;
  if (name === undefined || name === "") return undefined;
  return { actorId: pageSession.actorId, actorName: name };
}

function needsRootRecord(view: string): boolean {
  return (
    view === "follow_button" ||
    view === "follow_tab" ||
    view === "ignore_tab" ||
    view === "closure" ||
    view === "rule_editor"
  );
}

export async function prepareFollowRender(
  fetch: FetchEngine,
  pageSession: ReadViewer | undefined,
  rootCard: RenderCard,
  view: string,
): Promise<FollowRenderBundle> {
  const session = await resolveSession(fetch, pageSession);

  const followLabel = rootCard.name.s;

  let followed = false;
  let followMark: string | undefined;
  let followerCount = 0;
  let followerNames: readonly string[] = [];
  let followPreferenceNames: readonly string[] = [];
  let followTabRows: readonly FollowTabRow[] = [];
  let ignoreTabRows: readonly FollowTabRow[] = [];
  let deletions: readonly { readonly name: string }[] = [];
  let leftFollowPreference: string | undefined;
  let ruleEditorPreferenceName: string | undefined;
  let ruleEditorTargetName: string | undefined;

  let recordPromise: Promise<CardRecord | undefined> | undefined;
  const rootRecord = (): Promise<CardRecord | undefined> => {
    recordPromise ??= fetch.fetchByName(rootCard.name.s);
    return recordPromise;
  };
  const record: CardRecord | undefined = needsRootRecord(view)
    ? await rootRecord()
    : undefined;

  if (view === "content" || view === "core" || view === "titled" || view === "open") {
    const tag = rootCard.name.rightName?.key;
    if (tag === "*follower" || rootCard.name.rightName?.s === "*followers") {
      const leftName = rootCard.name.leftName?.s;
      if (leftName !== undefined) {
        followerNames = await followerNamesFor(fetch, leftName);
      }
    }
  }

  if (view === "content" || view === "core" || view === "titled" || view === "open") {
    const leftName = rootCard.name.leftName?.s;
    if (leftName !== undefined && rootCard.name.rightName?.s === "*follow") {
      followPreferenceNames = await followPreferenceNamesFor(fetch, leftName);
    }
  }

  if (view === "follow_section" || view === "engage_tab") {
    const setName = `${rootCard.name.s}+*self`;
    const users = new Set<number>();
    await followerCountInto(fetch, rootCard, users);
    if (session !== undefined) {
      followed = users.has(session.actorId);
      followMark = followRuleNameFor(setName, session.actorName);
    }
    followerCount = users.size;
  }

  if (view === "follow_button") {
    const setName = record ? `${record.name?.s ?? rootCard.name.s}+*self` : `${rootCard.name.s}+*self`;
    if (session !== undefined && record !== undefined) {
      followed = (await followRuleOptionFor(fetch, record, session.actorId)) !== null;
      followMark = followRuleNameFor(setName, session.actorName);
    } else {
      followMark = followRuleNameFor(setName, await anonymousActorName(fetch));
    }
  }

  if (
    (view === "follow_tab" || view === "ignore_tab" || isUserFollowDashboard(rootCard)) &&
    session !== undefined
  ) {
    const trunkName = rootCard.name.leftName?.s ?? rootCard.name.s;
    const rows = await followEditorRows(fetch, trunkName, {
      sessionId: session.actorId,
      trunkId: record?.leftId,
    });
    followTabRows = rows.following;
    ignoreTabRows = rows.ignoring;
  }

  if (isFollowersJunction(rootCard) || isFollowingJunction(rootCard)) {
    const leftName = rootCard.name.leftName?.s;
    if (leftName !== undefined) {
      followerNames = await followerNamesFor(fetch, leftName);
    }
  }

  if (view === "closure" && record !== undefined && record.leftId !== undefined) {
    deletions = await closureDeletions(fetch, record.leftId);
  }

  if ((view === "rule_editor" || isFollowingJunction(rootCard)) && session !== undefined) {
    const leftName = rootCard.name.leftName?.s;
    if (leftName !== undefined) {
      const leftRecord = await fetch.fetchByName(leftName);
      const leftTypeCard =
        leftRecord?.typeId !== undefined
          ? await fetch.fetchById(leftRecord.typeId)
          : undefined;
      const setName = followSetCardName(leftName, leftTypeCard?.codename);
      ruleEditorPreferenceName = followRuleNameFor(setName, session.actorName);
      leftFollowPreference = await appliedFollowPreferenceContent(
        fetch,
        leftName,
        session.actorId,
      );
      ruleEditorTargetName = leftFollowPreference ?? ruleEditorPreferenceName;
    }
  }

  return {
    session,
    followed,
    followMark,
    followLabel,
    followerCount,
    followerNames,
    followPreferenceNames,
    followTabRows,
    ignoreTabRows,
    closureDeletions: deletions,
    leftFollowPreference,
    ruleEditorPreferenceName,
    ruleEditorTargetName,
  };
}

async function appliedFollowPreferenceContent(
  fetch: FetchEngine,
  leftName: string,
  actorId: number,
): Promise<string | undefined> {
  const card = await fetch.fetchByName(leftName);
  if (card === undefined) return undefined;
  const walk = await followWalkContext(fetch, card);
  return (await followRuleContent(fetch, walk.index, walk.patterns, actorId, walk.allId)) ?? undefined;
}

async function followerCountInto(
  fetch: FetchEngine,
  rootCard: RenderCard,
  users: Set<number>,
): Promise<void> {
  const refs = await resolveFollowers(fetch, rootCard.id ?? null);
  for (const ref of refs) users.add(ref.followerId);
}

async function followerNamesFor(
  fetch: FetchEngine,
  leftName: string,
): Promise<readonly string[]> {
  const left = await fetch.fetchByName(leftName);
  if (left === undefined || left.id === undefined) return [];
  const refs = await resolveFollowers(fetch, left.id);
  const names: string[] = [];
  const seen = new Set<number>();
  for (const ref of refs) {
    if (seen.has(ref.followerId)) continue;
    seen.add(ref.followerId);
    const card = await fetch.fetchById(ref.followerId);
    const name = card?.name?.s;
    if (name !== undefined) names.push(name);
  }
  return names;
}

async function followPreferenceNamesFor(
  fetch: FetchEngine,
  userName: string,
): Promise<readonly string[]> {
  const userId = await fetch.lexicon.id(DeckoName.parse(userName));
  if (userId === undefined) return [];
  const [setId, followSettingId] = await Promise.all([
    fetch.codenames.id("set"),
    fetch.codenames.id("follow"),
  ]);
  if (setId === undefined || followSettingId === undefined) return [];
  const r = await fetch.driver.query<{ id: number }>(
    `SELECT p.id AS id
       FROM cards p
       JOIN cards user_set ON p.left_id  = user_set.id
       JOIN cards set_card ON user_set.left_id = set_card.id
      WHERE p.right_id       = ?
        AND set_card.type_id = ?
        AND user_set.right_id = ?
        AND p.trash = 0 AND user_set.trash = 0 AND set_card.trash = 0
      ORDER BY set_card.id, p.id`,
    [followSettingId, setId, userId],
  );
  const names: string[] = [];
  for (const row of r.rows) {
    const name = (await fetch.fetchById(row.id))?.name?.s;
    if (name !== undefined) names.push(name);
  }
  return names;
}
