import type { FetchEngine } from "../fetch.js";
import {
  CARD_ID_BY_JUNCTION_ORDERED_SQL,
  CARD_NAME_TRIPLE_BY_ID_SQL,
  CARD_ROW_BY_KEY_SQL,
  LIVE_CARD_ROW_BY_ID_SQL,
} from "../fetch/card-read-shapes.js";
import { DeckoName } from "../name.js";
import type { SQLStatement } from "../../server/driver.js";
import { findRule } from "../rules/lookup.js";
import { ruleWalkPatternInput } from "../actions/rule-content-walk.js";
import { interpolateTemplate, resolveFromAddress, addressOf } from "./mail.js";
import type { MailMessage, NotifyTransport } from "./types.js";

export interface ObserverInput {
  readonly card: { id: number; name: string; typeId: number | undefined };
  readonly action: "create" | "update" | "delete";
  readonly transport: NotifyTransport;
  readonly origin: string;
  readonly deckoBotEmail: string;
  readonly actorName: string;
  readonly logger?: (line: string) => void;
}

export interface ObserverOutcome {
  readonly failed: boolean;
  readonly delivered: number;
}

const EMAIL_LIST = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+(\s*[,\n]\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/;

function itemNames(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("[") && !trimmed.startsWith("[[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter((s) => s !== "");
    } catch {
    }
  }
  return trimmed.split("\n").map((l) => l.trim().replace(/^\[\[|\]\]$/g, "")).filter((s) => s !== "");
}

export async function runObserverEvents(fetch: FetchEngine, input: ObserverInput): Promise<ObserverOutcome> {
  const setting = `*on ${input.action}`;
  const codenamesMissing = fetch.codenames.peekId("set") === undefined;
  const parsedName = DeckoName.parse(input.card.name);
  const warmStatements: SQLStatement[] = [];
  if (codenamesMissing) {
    warmStatements.push(fetch.codenames.codehashStatement());
  }
  warmStatements.push(
    { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [input.card.id] },
    { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [input.card.id] },
    { sql: CARD_ROW_BY_KEY_SQL, params: ["follower_notification_email"] },
  );
  if (input.card.typeId !== undefined) {
    warmStatements.push(
      { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [input.card.typeId] },
      { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [input.card.typeId] },
    );
  }
  if (parsedName.isCompound && parsedName.leftName !== undefined) {
    for (const part of parsedName.leftName.partNames) {
      if (part.isSimple) {
        warmStatements.push({ sql: CARD_ROW_BY_KEY_SQL, params: [part.key] });
      }
    }
  }
  const appendFollowWarmStatements = (target: SQLStatement[]) => {
    const setId = fetch.codenames.peekId("set");
    const settingId = fetch.codenames.peekId("setting");
    const userId = fetch.codenames.peekId("user");
    const selfId = fetch.codenames.peekId("self");
    const typePatternId = fetch.codenames.peekId("type");
    const basicId = fetch.codenames.peekId("basic");
    if (setId !== undefined && settingId !== undefined && userId !== undefined) {
      target.push({
        sql: `SELECT preferences.id AS rule_id,
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
        params: [setId, settingId, userId],
      });
    }
    if (basicId !== undefined) {
      target.push(
        { sql: LIVE_CARD_ROW_BY_ID_SQL, params: [basicId] },
        { sql: CARD_NAME_TRIPLE_BY_ID_SQL, params: [basicId] },
      );
    }
    if (selfId !== undefined) {
      target.push({
        sql: CARD_ID_BY_JUNCTION_ORDERED_SQL,
        params: [input.card.id, selfId],
      });
    }
    if (input.card.typeId !== undefined && typePatternId !== undefined) {
      target.push({
        sql: CARD_ID_BY_JUNCTION_ORDERED_SQL,
        params: [input.card.typeId, typePatternId],
      });
    }
  };
  if (!codenamesMissing) {
    appendFollowWarmStatements(warmStatements);
  }
  if (typeof fetch.driver?.batch === "function") {
    try {
      const results = await fetch.driver.batch(warmStatements);
      if (codenamesMissing && results[0] !== undefined) {
        fetch.codenames.foldCodehashResults(results[0]);
        const followWarm: SQLStatement[] = [];
        appendFollowWarmStatements(followWarm);
        if (followWarm.length > 0) {
          await fetch.driver.batch(followWarm);
        }
      }
    } catch {
    }
  }
  const pattern = await ruleWalkPatternInput(fetch, {
    name: parsedName,
    id: input.card.id,
    isNew: false,
    typeId: input.card.typeId ?? null,
  });
  const found = await findRule(fetch, pattern, setting);
  if (found === undefined) return { failed: false, delivered: 0 };
  const field = async (template: string, right: string): Promise<string> =>
    (await fetch.fetchByName(`${template}+${right}`))?.dbContent ?? "";
  const title = (await fetch.fetchByName("*title"))?.dbContent ?? "";
  let delivered = 0;
  for (const template of itemNames(found.rule.dbContent ?? "")) {
    const to = (await field(template, "*to")).trim();
    if (to === "") {
      input.logger?.(`[observer] ${setting} ${template} for ${input.card.name}: SMTP To address may not be blank`);
      return { failed: true, delivered };
    }
    if (!EMAIL_LIST.test(to)) {
      input.logger?.(`[observer] ${setting} ${template}: recipient field "${to}" names cards; address rendering is not ported, not delivered`);
      continue;
    }
    const vars: Record<string, string> = {
      "_|name": input.card.name,
      "_|url": `${input.origin}/${DeckoName.parse(input.card.name).urlKey}`,
      ":title|core": title,
      "_user|name": input.actorName,
    };
    const from = resolveFromAddress(await field(template, "*from"), { deckoBotEmail: input.deckoBotEmail });
    const html = await field(template, "*html message");
    const msg: MailMessage = {
      to,
      from,
      replyTo: addressOf(from),
      subject: interpolateTemplate(await field(template, "*subject"), vars),
      textBody: interpolateTemplate(await field(template, "*text message"), vars),
      ...(html !== "" ? { htmlBody: interpolateTemplate(html, vars) } : {}),
      tags: { trigger: "observer", template },
    };
    try {
      await input.transport.sendMail(msg);
      delivered++;
    } catch (err) {
      input.logger?.(`[observer] ${setting} ${template}: ${(err as Error).message}`);
      return { failed: true, delivered };
    }
  }
  return { failed: false, delivered };
}
