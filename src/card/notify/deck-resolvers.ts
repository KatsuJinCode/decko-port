import type { FetchEngine } from "../fetch.js";
import { CARD_ID_BY_JUNCTION_SQL, LIVE_CARD_ROW_BY_ID_SQL } from "../fetch/card-read-shapes.js";
import type { EmailTemplate } from "./mail.js";
import type { EmailTemplateResolver } from "./follow-notify.js";

const TEMPLATE_CARD = "follower notification email";
const FROM_TAG = "*from";
const SUBJECT_TAG = "*subject";
const TEXT_TAG = "*text message";
const HTML_TAG = "*html message";
const SUBJECT_CHILD = `${TEMPLATE_CARD}+${SUBJECT_TAG}`;
const TEXT_CHILD = `${TEMPLATE_CARD}+${TEXT_TAG}`;
const HTML_CHILD = `${TEMPLATE_CARD}+${HTML_TAG}`;

async function readContent(fetch: FetchEngine, name: string): Promise<string> {
  const card = await fetch.fetchByName(name);
  return card?.dbContent ?? "";
}

export function deckEmailTemplateResolver(fetch: FetchEngine): EmailTemplateResolver {
  return async (): Promise<EmailTemplate> => {
    const templateCard = await fetch.fetchByName(TEMPLATE_CARD);
    if (templateCard === undefined) {
      return { to: "", from: "", subject: "", textBody: "", htmlBody: "" };
    }
    if (templateCard.id !== undefined) {
      const rightIds = (
        await Promise.all([FROM_TAG, SUBJECT_TAG, TEXT_TAG, HTML_TAG].map((tag) => fetch.lexicon.id(tag)))
      ).filter((id): id is number => id !== undefined);
      if (rightIds.length > 0) {
        const idResults = await fetch.driver.batch(
          rightIds.map((rightId) => ({
            sql: CARD_ID_BY_JUNCTION_SQL,
            params: [templateCard.id, rightId],
          })),
        );
        const childIds = idResults
          .map((res) => (res.rows[0] as { id?: number } | undefined)?.id)
          .filter((id): id is number => typeof id === "number");
        if (childIds.length > 0) {
          await fetch.driver.batch(
            childIds.map((childId) => ({
              sql: LIVE_CARD_ROW_BY_ID_SQL,
              params: [childId],
            })),
          );
        }
      }
    }
    const [from, subject, textBody, htmlBody] = await Promise.all([
      readContent(fetch, `${TEMPLATE_CARD}+*from`),
      readContent(fetch, SUBJECT_CHILD),
      readContent(fetch, TEXT_CHILD),
      readContent(fetch, HTML_CHILD),
    ]);
    return {
      to: "",
      from, subject, textBody, htmlBody,
    };
  };
}
