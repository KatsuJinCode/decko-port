import type { FetchEngine } from "../fetch.js";
import { DeckoName } from "../name.js";
import { parseSetName } from "../set-patterns/set-name.js";
import { followOptionDescription } from "../follow/follow-options.js";
import { followRuleNameFor } from "../follow/follow-rule-walk.js";

const FIELD_NAME = 0;
const FIELD_TYPE_ID = 1;
const FIELD_DB_CONTENT = 2;

const ACTION_TYPES = ["create", "update", "delete"] as const;
type ActionType = (typeof ACTION_TYPES)[number];

const RELEVANT_FIELDS: Record<ActionType, readonly ("name" | "cardtype" | "content")[]> = {
  create: ["cardtype", "content"],
  update: ["name", "cardtype", "content"],
  delete: ["content"],
};

const FIELD_CODE = { name: FIELD_NAME, cardtype: FIELD_TYPE_ID, content: FIELD_DB_CONTENT } as const;

export interface FollowMailViewInput {
  readonly origin: string;
  readonly actId: number;
  readonly actCardId: number;
  readonly canReadCard: (cardId: number) => Promise<boolean>;
  readonly actorId: number;
  readonly followerName: string;
  readonly followedSetName: string;
  readonly followOption: string;
}

export interface FollowMailViews {
  readonly text: Record<string, string>;
  readonly html: Record<string, string>;
}

interface ActionRow {
  readonly id: number;
  readonly cardId: number;
  readonly type: ActionType;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cgiEscape(s: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(s)) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.~-]/.test(ch)) out += ch;
    else if (ch === " ") out += "+";
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function followMailViews(
  fetch: FetchEngine,
  input: FollowMailViewInput,
): Promise<FollowMailViews> {
  const driver = fetch.driver;
  const nameOf = async (id: number): Promise<string> =>
    (await fetch.fetchById(id, { lookInTrash: true }))?.name?.s ?? "";
  const cardUrl = (name: string): string => `${input.origin}/${DeckoName.parse(name).urlKey}`;
  const linkHtml = (name: string): string => {
    const parts = DeckoName.parse(name).partNames.map((p) => escapeHtml(p.s));
    return `<a class="known-card" href="${cardUrl(name)}"><span class="card-title" title="${escapeHtml(name)}">` +
      `${parts.join("<span>+</span>")}</span></a>`;
  };

  const [actRows, _prelimNestees, lastOwnQuery] = await driver.batch([
    {
      sql: "SELECT id, card_id, action_type FROM card_actions WHERE card_act_id = ? ORDER BY id",
      params: [input.actId],
    },
    {
      sql: "SELECT referee_id FROM card_references WHERE referer_id = ? AND ref_type = 'I' AND referee_id IS NOT NULL",
      params: [input.actCardId],
    },
    {
      sql:
        "SELECT id, card_id, action_type FROM card_actions WHERE card_id = ? " +
        "AND draft IS NOT TRUE AND id IS NOT NULL ORDER BY id DESC LIMIT 1",
      params: [input.actCardId],
    },
  ]);
  const actions: ActionRow[] = ((actRows?.rows ?? []) as Array<{ id: number; card_id: number; action_type: number }>).map((r) => ({
    id: Number(r.id),
    cardId: Number(r.card_id),
    type: ACTION_TYPES[Number(r.action_type)] ?? "update",
  }));
  const prelimLastOwnId = ((lastOwnQuery?.rows ?? [])[0] as { id?: number } | undefined)?.id;
  const changeActionIds = [
    ...new Set([
      ...actions.map((a) => a.id),
      ...(prelimLastOwnId === undefined ? [] : [Number(prelimLastOwnId)]),
    ]),
  ];
  if (changeActionIds.length > 0) {
    await driver.batch(
      changeActionIds.map((actionId) => ({
        sql: "SELECT field, value FROM card_changes WHERE card_action_id = ? ORDER BY id",
        params: [actionId],
      })),
    );
  }
  const main = actions.find((a) => a.cardId === input.actCardId) ?? actions[0];

  const changeValue = async (action: ActionRow, field: "name" | "cardtype" | "content"): Promise<string | undefined> => {
    const rows = await driver.query<{ field: number; value: string | null }>(
      "SELECT field, value FROM card_changes WHERE card_action_id = ? ORDER BY id",
      [action.id],
    );
    let raw: string | null | undefined;
    if (rows.rows.length > 0) {
      const hit = rows.rows.find((r) => Number(r.field) === FIELD_CODE[field]);
      if (hit === undefined) return undefined;
      raw = hit.value;
    } else {
      let sole = action.type === "create";
      if (!sole) {
        const n = await driver.query<{ n: number }>(
          "SELECT count(*) AS n FROM card_actions WHERE card_id = ?",
          [action.cardId],
        );
        sole = Number(n.rows[0]?.n ?? 0) === 1;
      }
      if (!sole) return undefined;
      const card = await fetch.fetchById(action.cardId, { lookInTrash: true });
      if (card === undefined) return undefined;
      raw = field === "name" ? card.name?.s : field === "cardtype"
        ? (card.typeId === undefined ? undefined : String(card.typeId))
        : card.dbContent ?? "";
    }
    if (raw === null || raw === undefined) return undefined;
    if (field === "cardtype") return nameOf(Number(raw));
    return raw;
  };

  const previousValue = async (action: ActionRow, field: "name" | "cardtype" | "content"): Promise<string | undefined> => {
    if (action.type === "create") return undefined;
    const rows = await driver.query<{ value: string | null }>(
      "SELECT c.value FROM card_changes c JOIN card_actions a ON a.id = c.card_action_id " +
        "WHERE a.card_id = ? AND a.id < ? AND c.field = ? ORDER BY a.id DESC, c.id DESC LIMIT 1",
      [action.cardId, action.id, FIELD_CODE[field]],
    );
    const raw = rows.rows[0]?.value;
    if (raw === null || raw === undefined) return undefined;
    return field === "cardtype" ? nameOf(Number(raw)) : raw;
  };

  const listOfChanges = async (action: ActionRow, html: boolean): Promise<string> => {
    const label = action.type === "update" ? "new" : action.type === "delete" ? "deleted" : "";
    let out = "";
    for (const field of RELEVANT_FIELDS[action.type]) {
      let value = await changeValue(action, field);
      if (value === undefined) continue;
      if (action.type === "delete") value = (await previousValue(action, field)) ?? "";
      if (!html && field === "content") value = htmlToText(value);
      const item = `  ${label} ${field}: ${value}`;
      out += html ? `<li>${item}</li>\n` : `${item}\n`;
    }
    return out;
  };

  const nestees = await driver.query<{ referee_id: number }>(
    "SELECT referee_id FROM card_references WHERE referer_id = ? AND ref_type = 'I' AND referee_id IS NOT NULL",
    [input.actCardId],
  );
  const nesteeIds = new Set(nestees.rows.map((r) => Number(r.referee_id)));
  const subeditActions = actions.filter((a) => a.cardId !== input.actCardId && nesteeIds.has(a.cardId));
  const subedits = async (html: boolean): Promise<string> => {
    let items = "";
    for (const action of subeditActions) {
      if (!(await input.canReadCard(action.cardId))) continue;
      const newName = await changeValue(action, "name");
      const before = newName !== undefined ? await previousValue(action, "name") : undefined;
      const name = before ?? (await nameOf(action.cardId));
      const body = `${name} ${action.type}d\n${await listOfChanges(action, html)}`;
      items += html ? `<li>${body}</li>
` : `
${body}`;
    }
    if (items === "") return "";
    const list = html ? `<ul>${items}</ul>\n` : `${items}\n\n`;
    return `\nThis update included the following changes:\n${list}`;
  };

  const mainRename = main !== undefined && main.cardId === input.actCardId && main.type === "delete"
    ? await changeValue(main, "name")
    : undefined;
  const actCardName = (mainRename !== undefined ? await previousValue(main!, "name") : undefined) ??
    await nameOf(input.actCardId);
  const userName = await nameOf(input.actorId);
  const url = cardUrl(actCardName);

  const setParsed = parseSetName(input.followedSetName);
  const setLabel = setParsed.spec ? setParsed.spec.shortLabel(setParsed.anchorName?.s) : input.followedSetName;
  const followed = input.followedSetName !== "" && input.followOption !== ""
    ? followOptionDescription(input.followOption.replace(/^\*/, ""), setLabel)
    : "*followed set of cards*";

  const dashboardMark = DeckoName.parse(`${input.followerName}+*follow`).urlKey;
  const ruleName = followRuleNameFor(input.followedSetName, input.followerName);
  const unfollowUrl = input.followedSetName === ""
    ? ""
    : `${input.origin}/update/${dashboardMark}` +
      `?${cgiEscape(`card[subcards][${ruleName}]`)}=${cgiEscape("*never")}`;

  const canReadActCard = await input.canReadCard(input.actCardId);
  const verb = canReadActCard ? `${main?.type ?? "edite"}d` : "";
  const ownAction = actions.find((a) => a.cardId === input.actCardId);
  const htmlVerb = !canReadActCard || ownAction === undefined
    ? ""
    : ownAction.type === "create"
      ? "added"
      : ownAction.type === "delete"
        ? "deleted"
        : `<a rel="nofollow" class="last-edited slotter" href="${url}/history" data-remote="true">edited</a>`;

  const lastOwnRow = canReadActCard ? (await driver.query<{
    id: number; card_id: number; action_type: number;
  }>("SELECT id, card_id, action_type FROM card_actions WHERE card_id = ? " +
    "AND draft IS NOT TRUE AND id IS NOT NULL ORDER BY id DESC LIMIT 1", [input.actCardId])).rows[0] : undefined;
  const lastOwn = lastOwnRow === undefined ? undefined : {
    id: Number(lastOwnRow.id), cardId: Number(lastOwnRow.card_id),
    type: ACTION_TYPES[Number(lastOwnRow.action_type)] ?? "update",
  };
  const changesOf = async (html: boolean): Promise<string> =>
    lastOwn === undefined ? "" : listOfChanges(lastOwn, html);

  return {
    text: {
      "_|name": actCardName,
      "_|url": url,
      "_|link": actCardName,
      "_|last_action_verb": verb,
      "_|list_of_changes": await changesOf(false),
      "_|subedits": await subedits(false),
      "_|followed": followed,
      "_|unfollow_url": unfollowUrl,
      "_user|name": userName,
      "_user|link": userName,
    },
    html: {
      "_|name": escapeHtml(actCardName),
      "_|url": url,
      "_|link": linkHtml(actCardName),
      "_|last_action_verb": htmlVerb,
      "_|list_of_changes": await changesOf(true),
      "_|subedits": await subedits(true),
      "_|followed": escapeHtml(followed),
      "_|unfollow_url": unfollowUrl,
      "_user|name": escapeHtml(userName),
      "_user|link": linkHtml(userName),
    },
  };
}
