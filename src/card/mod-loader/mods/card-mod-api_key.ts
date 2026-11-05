import { randomBytes } from "node:crypto";
import type { ViewContext, ViewFn } from "../../render/format.js";
import { DeckoName } from "../../name.js";
import { CardActionError } from "../../actions/types.js";
import type {
  DeckoModManifest,
  ModEventCard,
  ModEventFn,
  ModEventRegistration,
} from "../mod-manifest.js";
import type { ModEventContext } from "../mod-event-dispatch.js";
import { ModEngineHost } from "../mod-manifest.js";
import { superView } from "../mod-view-helpers.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

const LOCALE = {
  api_key_label: "API Key",
  api_key_generate: "Generate API Key",
  api_key_regenerate: "Regenerate API Key",
  api_key_generating: "Generating API Key",
  api_key_get_jwt_token: "get a JWT token",
  api_key_invalid:
    "Invalid API Key; must contain 20+ alphanumeric characters only",
  api_key_taken: "API Key taken",
  api_key_not_found: "no API key found",
  api_key_incorrect: "API key mismatch",
} as const;

const GENERATE_API_KEY_TRIGGER = "generate_api_key";

export function generatedApiKey(): string {
  return randomBytes(16)
    .toString("base64")
    .replace(/[+/=]/g, (c) => (c === "+" ? "Q" : c === "/" ? "r" : "t"));
}

async function apiKeyTaken(
  ctx: ModEventContext,
  cardName: string,
  cardId: number | undefined,
  content: string,
): Promise<boolean> {
  const accountId = await ctx.fetch?.codenames.id("account");
  const apiKeyId = await ctx.fetch?.codenames.id("api_key");
  if (accountId === undefined || apiKeyId === undefined) return false;
  const junction = (
    await ctx.driver.query<{ id: number; left_id: number | null }>(
      `SELECT a.id, a.left_id FROM cards a
       JOIN cards k ON k.left_id = a.id AND k.right_id = ? AND k.trash = 0
       WHERE a.right_id = ? AND a.trash = 0 AND k.db_content = ?
       ORDER BY a.id LIMIT 1`,
      [apiKeyId, accountId, content.trim()],
    )
  ).rows[0];
  if (junction === undefined) return false;
  let leftId: number | null | undefined = undefined;
  if (cardId !== undefined) {
    leftId = (
      await ctx.driver.query<{ left_id: number | null }>(
        "SELECT left_id FROM cards WHERE id = ?",
        [cardId],
      )
    ).rows[0]?.left_id;
  } else {
    const name = DeckoName.parse(cardName);
    if (name.isCompound) {
      leftId = (await ctx.lexicon.id(name.leftName!)) ?? null;
    }
  }
  return junction.id !== leftId;
}

const validateApiKeyEvent: ModEventFn = async (card, _host, ctx) => {
  const content = card.dbContent ?? "";
  const messages: string[] = [];
  if (!/^\w{20,}\n?$/.test(content)) messages.push(LOCALE.api_key_invalid);
  if (await apiKeyTaken(ctx, card.name, card.id, content)) {
    messages.push(LOCALE.api_key_taken);
  }
  if (messages.length === 0) return;
  throw new CardActionError(
    "validation-failed",
    messages.join("\n"),
    messages.map((m) => `Content: ${m}`).join("\n"),
    Object.fromEntries(messages.map((m) => ["content", m])),
    card.name,
  );
};

const generateApiKeyEvent: ModEventFn = (_card, _host, ctx) => {
  ctx.saveInput?.setContent(generatedApiKey());
};

function inputType(): "text_field" {
  return "text_field";
}

function coreTopView(): "current" {
  return "current";
}

function generateButtonHiddenTags(): string {
  return (
    `<input type="hidden" name="card[trigger]" id="card_trigger"` +
    ` value="${GENERATE_API_KEY_TRIGGER}" autocomplete="off" />`
  );
}

function generateButtonText(content: string): string {
  return content.length > 0 ? LOCALE.api_key_regenerate : LOCALE.api_key_generate;
}

function generateButtonSituation(): "primary" {
  return "primary";
}

function cardUpdatePath(urlKey: string): string {
  return `/update/${urlKey}`;
}

function cardTokenPath(urlKey: string): string {
  return `/${urlKey}/token.json`;
}

const coreView: ViewFn = (ctx) => {
  let top = `<div class='api-key-top d-flex my-2 py-3 border-bottom justify-content-between w-100'>\n`;
  if (ctx.fmt.card.dbContent.length > 0) {
    top += `${ctx.fmt.renderView(coreTopView())}\n`;
  }
  top += `</div>\n`;
  const buttons =
    `<div class='api-key-buttons d-flex my-2 py-3 justify-content-between w-100'>\n` +
    `${ctx.fmt.renderView("buttons")}\n</div>\n`;
  return `<div class='api-key-core p-1'>\n${top}${buttons}</div>\n`;
};

const currentView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  const value = card.dbContent;
  return (
    `<div class='current-api-key nodblclick'>\n` +
    `<label for='current_api_key'>\n${LOCALE.api_key_label}\n</label>\n` +
    `<input type="text" name="current_api_key" id="current_api_key"` +
    ` value="${value}" readonly="readonly" />\n` +
    `</div>\n`
  );
};

const superApiKeyView: ViewFn = (ctx) => superView(ctx, "Right::ApiKey", ctx.voo.requestedView);

const tokenLinkView: ViewFn = (ctx) => {
  const href = cardTokenPath(ctx.fmt.urlKey());
  return `<a href="${href}">${LOCALE.api_key_get_jwt_token}</a>`;
};

const buttonsView: ViewFn = (ctx) => ctx.fmt.renderView("generate_button");

const generateButtonView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  const isNew = card.id === undefined;
  const formId = isNew ? "new_card" : `edit_card_${card.id}`;
  const spoof = isNew
    ? ""
    : `<input type="hidden" name="_method" value="patch" autocomplete="off" />`;
  const opener =
    `<form class="card-form slotter autosave" id="${formId}"` +
    ` action="${cardUpdatePath(ctx.fmt.urlKey())}" accept-charset="UTF-8"` +
    ` data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />${spoof}`;
  const submit =
    `<button name="button" type="submit" data-disable-with="${LOCALE.api_key_generating}"` +
    ` class="btn btn-${generateButtonSituation()}">${generateButtonText(card.dbContent)}</button>`;
  return `${opener}${generateButtonHiddenTags()}\n${submit}</form>`;
};

const tokenJsonView: ViewFn = () => {
  throw new Error("api_key :token view: the JWT for an account needs the async token encoder, which a sync view cannot await");
};

const apiKeyView: ViewFn = (ctx) => {
  const childName = `${ctx.fmt.card.name.s}+*api key`;
  const title = DeckoName.parse(childName).tag;
  return ctx.fmt.nest({
    syntax: `{{${childName}|titled}}`,
    name: childName,
    options: { view: "titled", title, extra: {} },
    comment: undefined,
  });
};

const cardModApiKey: DeckoModManifest = {
  name: "api_key",
  gemName: "card-mod-api_key",
  group: "gem",
  setModules: [
    {
      setPath: "right/api_key",
      events: [
        event({ event: "generate_api_key", at: "prepare_to_validate", trigger: "required", fn: generateApiKeyEvent }),
        event({ event: "validate_api_key", at: "validate", on: ["save"], changed: ["content"], fn: validateApiKeyEvent }),
      ],
      formats: {
        html: {
          views: [
            { view: "core", viewFn: coreView, config: { unknown: true } },
            { view: "current", viewFn: currentView, config: { unknown: true } },
            { view: "titled", viewFn: superApiKeyView, config: { unknown: true } },
            { view: "titled_content", viewFn: superApiKeyView, config: { unknown: true } },
            { view: "content", viewFn: superApiKeyView, config: { unknown: true } },
            { view: "token_link", viewFn: tokenLinkView },
            { view: "buttons", viewFn: buttonsView, config: { unknown: true, perms: "update" } },
            {
              view: "generate_button",
              viewFn: generateButtonView,
              config: { unknown: true, perms: "update" },
            },
          ],
        },
        json: {
          views: [
            { view: "token", viewFn: tokenJsonView },
          ],
        },
      },
    },
    {
      setPath: "right/account",
      formats: {
        html: {
          views: [
            { view: "api_key", viewFn: apiKeyView },
          ],
        },
      },
    },
  ],
};

export default cardModApiKey;