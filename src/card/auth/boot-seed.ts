import type { SQLDatabaseDriver } from "../../server/driver.js";
import { sqlDateTime } from "./session-store.js";
import { CardActionEngine } from "../actions/card-action-engine.js";
import { FetchEngine } from "../fetch.js";
import { DEFAULT_PATH_INDEX, PORT_SEED_SOURCE } from "./seed-source.js";
import { MOD_CONTENT_SEED_CARDS } from "../mod-loader/mod-content-seeds.js";
import { MOD_REAL_YAML_SEED_CARDS } from "../mod-loader/mod-realyml-seed-cards.js";
import { ensureInstalledModCards } from "./boot-mod-cards.js";
import { actorBot, type Actor } from "./actor.js";

export interface DefaultsFixtureCardRow {
  readonly id: number;
  readonly name: string | null;
  readonly key: string | null;
  readonly codename: string | null;
  readonly leftId: number | null;
  readonly rightId: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly creatorId: number | null;
  readonly updaterId: number | null;
  readonly readRuleClass: string | null;
  readonly readRuleId: number | null;
  readonly trash: number | null;
  readonly typeId: number | null;
  readonly dbContent: string | null;
}

export interface DefaultsFixtureActionRow {
  readonly id: number;
  readonly cardId: number | null;
  readonly cardActId: number | null;
  readonly superActionId: number | null;
  readonly actionType: number | null;
  readonly draft: number | null;
}

export interface DefaultsFixtureActRow {
  readonly id: number;
  readonly cardId: number | null;
  readonly actorId: number | null;
  readonly actedAt: string | null;
  readonly ipAddress: string | null;
}

export interface DefaultsFixtureChangeRow {
  readonly id: number;
  readonly cardActionId: number | null;
  readonly field: number | null;
  readonly value: string | null;
}

export interface DefaultsFixtureReferenceRow {
  readonly id: number;
  readonly refererId: number | null;
  readonly refereeKey: string | null;
  readonly refereeId: number | null;
  readonly refType: string | null;
  readonly isPresent: number | null;
}

export interface DefaultsSeedCorpusTables {
  readonly cards: readonly DefaultsFixtureCardRow[];
  readonly actions: readonly DefaultsFixtureActionRow[];
  readonly acts: readonly DefaultsFixtureActRow[];
  readonly changes: readonly DefaultsFixtureChangeRow[];
  readonly references: readonly DefaultsFixtureReferenceRow[];
}

export interface CoreFixtureSeedCard {
  readonly id: number;
  readonly name: string | null;
  readonly key: string | null;
  readonly codename: string | null;
  readonly leftId: number | null;
  readonly rightId: number | null;
  readonly typeId: number;
  readonly dbContent: string | null;
}

export const CORE_FIXTURE_SEED_CARDS: readonly CoreFixtureSeedCard[] = [
  { id: 1, name: "Decko Bot", key: "decko_bot", codename: "decko_bot", leftId: null, rightId: null, typeId: 2, dbContent: "" },
  { id: 2, name: "RichText", key: "rich_text", codename: "basic", leftId: null, rightId: null, typeId: 3, dbContent: "" },
  { id: 3, name: "Cardtype", key: "cardtype", codename: "cardtype", leftId: null, rightId: null, typeId: 3, dbContent: "" },
  { id: 4, name: "List", key: "list", codename: "list", leftId: null, rightId: null, typeId: 3, dbContent: "" },
  { id: 5, name: "Set", key: "set", codename: "set", leftId: null, rightId: null, typeId: 2, dbContent: "" },
  { id: 6, name: "Setting", key: "setting", codename: "setting", leftId: null, rightId: null, typeId: 3, dbContent: "" },
  { id: 7, name: "*all", key: "*all", codename: "all", leftId: null, rightId: null, typeId: 5, dbContent: "{}" },
  { id: 8, name: "*default", key: "*default", codename: "default", leftId: null, rightId: null, typeId: 6, dbContent: "" },
  { id: 9, name: "*read", key: "*read", codename: "read", leftId: null, rightId: null, typeId: 6, dbContent: "" },
  { id: 10, name: null, key: null, codename: null, leftId: 7, rightId: 9, typeId: 4, dbContent: "Decko Bot" },
  { id: 11, name: null, key: null, codename: null, leftId: 7, rightId: 8, typeId: 2, dbContent: "" },
];

export interface AccountModSeedCard {
  readonly name: string;
  readonly codename?: string;
  readonly typeCodename?: string;
  readonly content?: string;
}

const ACCOUNT_RIGHT_CORE_CONTENT = [
  "<div>When someone signs up, they create a [[Sign up]] card...</div>",
  "<blockquote>",
  "<div>{{Sign up|closed;title: Sign ups}}</div>",
  "</blockquote>",
  "<div>...that can be changed into a [[User]] card:</div>",
  "<blockquote>",
  "<div>{{User|title: Users; closed}}</div>",
  "</blockquote>",
  "<div>Some important [[http://decko.org/permissions|permissions]]:</div>",
  "<div>",
  "<ul>",
  "<li>When [[Anyone]] can [[*create|create]] a [[Sign up]] card, links to sign up will appear.</li>",
  "<li>When [[Anyone]] can [[*create|create]] a [[User]] card, each [[Sign up]] can be auto-approved with a verification email.</li>",
  "<li>If permission to [[*create|create]] a [[User]] is restricted, someone with that permission must approve each [[Sign up]] by hand.</li>",
  "</ul>",
  "</div>",
  "<h5>Related links</h5>",
  "<ul>",
  "<li><em>[[http://decko.org/account | Accounts docs]]</em></li>",
  "<li><em>[[Cards with accounts]]</em></li>",
  "<li><em>[[:account+:right+:by_name|Account cards]]</em></li>",
  "</ul>",
].join("\n");

export const ACCOUNT_MOD_SEED_CARDS: readonly AccountModSeedCard[] = [
  { name: "Role", codename: "role", typeCodename: "cardtype" },
  { name: "User", codename: "user", typeCodename: "cardtype" },
  { name: "Email template", codename: "email_template", typeCodename: "cardtype" },
  { name: "*members", codename: "members" },
  { name: "Anyone", codename: "anyone", typeCodename: "role" },
  { name: "Anyone Signed In", codename: "anyone_signed_in", typeCodename: "role" },
  { name: "Administrator", codename: "administrator", typeCodename: "role" },
  { name: "Eagle", codename: "eagle", typeCodename: "role" },
  { name: "Shark", codename: "shark", typeCodename: "role" },
  { name: "Help Desk", codename: "help_desk", typeCodename: "role" },
  {
    name: "Anonymous",
    codename: "anonymous",
    content:
      "<p>Edits made by people who are not signed in are credited to Anonymous. " +
      "[[http://decko.org/account|Learn more about accounts]].</p>",
  },
  { name: "*account", codename: "account", content: ACCOUNT_RIGHT_CORE_CONTENT },
  { name: "*email", codename: "email" },
  { name: "*password", codename: "password" },
  { name: "*salt", codename: "salt" },
  { name: "*status", codename: "status" },
  { name: "*account settings", codename: "account_settings" },
  { name: "Sign up", codename: "signup", typeCodename: "cardtype" },
  { name: "*signin", codename: "signin" },
  { name: "*roles", codename: "roles" },
  { name: "*enabled roles", codename: "enabled_roles" },
  { name: "*account links", codename: "account_links" },
  { name: "Cards with accounts", codename: "cards_with_account", content: '{"right_plus": ":account"}' },
  { name: "*thanks", codename: "thanks", typeCodename: "setting" },
  {
    name: "Signup Success",
    codename: "signup_success",
    content:
      "<div>\n  Thank you for signing up with {{:title|core}}. \n" +
      "  You should receive a response in your email.\n</div>",
  },
  { name: "welcome email", codename: "welcome_email", typeCodename: "email_template" },
  { name: "verification email", codename: "verification_email", typeCodename: "email_template" },
  { name: "password reset email", codename: "password_reset_email", typeCodename: "email_template" },
  { name: "signup alert email", codename: "signup_alert_email", typeCodename: "email_template" },
];

const DECKOBOT_ACCOUNT: { junctionName: string; emailChildName: string; email: string } = {
  junctionName: "Decko Bot+*account",
  emailChildName: "Decko Bot+*account+*email",
  email: "no-reply@decko.org",
};

export interface BootSeedDeps {
  readonly driver: SQLDatabaseDriver;
  readonly now?: () => Date;
  readonly defaultsCorpus?: DefaultsSeedCorpusTables;
}

export interface BootSeedResult {
  readonly ok: true;
  readonly coreRowsInserted: number;
  readonly defaultsRowsInserted?: {
    readonly cards: number;
    readonly actions: number;
    readonly acts: number;
    readonly changes: number;
    readonly references: number;
  };
  readonly modCardsCreated: readonly string[];
  readonly modCardsUpdated: readonly string[];
  readonly modCardCascade: {
    readonly dependencyCardsCreated: readonly string[];
    readonly modCardsCreated: readonly string[];
    readonly modCardsRetyped: readonly string[];
    readonly inputCardsCreated: readonly string[];
    readonly assetListsSet: readonly string[];
  };
}

export function corpusShippedAccountHolderIds(
  cards: readonly DefaultsFixtureCardRow[],
): number[] {
  const accountCard = cards.find((card) => card.codename === "account");
  if (accountCard === undefined) return [];
  return cards
    .filter((card) => card.rightId === accountCard.id)
    .map((card) => card.leftId)
    .filter((id): id is number => id !== null);
}

export async function bootstrapFreshDeck(deps: BootSeedDeps): Promise<BootSeedResult> {
  const now = deps.now ?? (() => new Date());
  const stamp = sqlDateTime(now());

  const layerA = await seedFreshDeckFixture(deps.driver, stamp, deps.defaultsCorpus);
  const coreRowsInserted = typeof layerA === "number" ? layerA : layerA.cards;
  const defaultsRowsInserted = typeof layerA === "number" ? undefined : layerA;

  if (defaultsRowsInserted !== undefined) {
    return {
      ok: true,
      coreRowsInserted,
      defaultsRowsInserted,
      modCardsCreated: [],
      modCardsUpdated: [],
      modCardCascade: {
        dependencyCardsCreated: [],
        modCardsCreated: [],
        modCardsRetyped: [],
        inputCardsCreated: [],
        assetListsSet: [],
      },
    };
  }

  const bot = await actorBot(deps.driver);

  const fetcher = new FetchEngine(deps.driver);
  const engine = new CardActionEngine(fetcher, { actor: bot });
  const modCardsCreated: string[] = [];
  const modCardsUpdated: string[] = [];

  for (const seed of ACCOUNT_MOD_SEED_CARDS) {
    await ensureSeedCard(engine, seed, deps.driver, bot, modCardsCreated, modCardsUpdated);
  }

  const botAccount = await engine.fetch.fetchByName(DECKOBOT_ACCOUNT.junctionName);
  if (botAccount === undefined || botAccount.id === undefined) {
    await engine.createCard({
      name: DECKOBOT_ACCOUNT.junctionName,
      subcards: { "+*email": { content: DECKOBOT_ACCOUNT.email } },
    });
    modCardsCreated.push(DECKOBOT_ACCOUNT.junctionName, DECKOBOT_ACCOUNT.emailChildName);
  }
  await ensureNamed(engine, DECKOBOT_ACCOUNT.emailChildName, DECKOBOT_ACCOUNT.email, undefined, modCardsCreated, modCardsUpdated);

  for (const seed of MOD_CONTENT_SEED_CARDS) {
    await ensureSeedCard(engine, seed, deps.driver, bot, modCardsCreated, modCardsUpdated);
  }

  for (const seed of MOD_REAL_YAML_SEED_CARDS) {
    await ensureSeedCard(engine, seed, deps.driver, bot, modCardsCreated, modCardsUpdated);
  }

  const modCardCascade = await ensureInstalledModCards(engine, deps.driver);

  return {
    ok: true,
    coreRowsInserted,
    ...(defaultsRowsInserted !== undefined ? { defaultsRowsInserted } : {}),
    modCardsCreated,
    modCardsUpdated,
    modCardCascade,
  };
}

export function seedFreshDeckFixture(
  driver: SQLDatabaseDriver,
  stamp: string,
  defaultsCorpus?: DefaultsSeedCorpusTables,
): Promise<number> | Promise<{ cards: number; actions: number; acts: number; changes: number; references: number }> {
  if (PORT_SEED_SOURCE.index === DEFAULT_PATH_INDEX) {
    if (defaultsCorpus === undefined) {
      throw new Error(
        "bootstrapFreshDeck: the defaults seed corpus was not supplied. " +
          "The boot loads deploy/seed/defaults-seed-corpus.json at seed " +
          "time (loadDefaultsSeedCorpusAsset in " +
          "src/card/auth/defaults-seed-corpus-asset.ts) and passes it as " +
          "defaultsCorpus - the engine no longer carries the corpus " +
          "compiled in (the v21 roll's bundle-budget crossing).",
      );
    }
    return seedDefaultsCorpus(driver, defaultsCorpus);
  }
  return seedCoreFixture(driver, stamp);
}

async function seedDefaultsCorpus(
  driver: SQLDatabaseDriver,
  corpus: DefaultsSeedCorpusTables,
): Promise<{
  cards: number;
  actions: number;
  acts: number;
  changes: number;
  references: number;
}> {
  const cardStatements = corpus.cards.map((card) => ({
    sql:
      `INSERT OR IGNORE INTO cards
         (id, name, key, codename, left_id, right_id, current_revision_id,
          created_at, updated_at, creator_id, updater_id,
          read_rule_class, read_rule_id, references_expired, trash,
          type_id, db_content)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    params: [
      card.id,
      card.name,
      card.key,
      card.codename,
      card.leftId,
      card.rightId,
      card.createdAt,
      card.updatedAt,
      card.creatorId,
      card.updaterId,
      card.readRuleClass,
      card.readRuleId,
      card.trash,
      card.typeId,
      card.dbContent,
    ] as unknown[],
  }));
  const cardResults = await driver.batch(cardStatements);
  const cards = cardResults.reduce((sum, result) => sum + result.rowsAffected, 0);

  const actionStatements = corpus.actions.map((action) => ({
    sql:
      `INSERT OR IGNORE INTO card_actions
         (id, card_id, card_act_id, super_action_id, action_type, draft, comment)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    params: [action.id, action.cardId, action.cardActId, action.superActionId, action.actionType, action.draft] as unknown[],
  }));
  const actionResults = await driver.batch(actionStatements);
  const actions = actionResults.reduce((sum, result) => sum + result.rowsAffected, 0);

  const actStatements = corpus.acts.map((act) => ({
    sql:
      `INSERT OR IGNORE INTO card_acts
         (id, card_id, actor_id, acted_at, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
    params: [act.id, act.cardId, act.actorId, act.actedAt, act.ipAddress] as unknown[],
  }));
  const actResults = await driver.batch(actStatements);
  const acts = actResults.reduce((sum, result) => sum + result.rowsAffected, 0);

  const changeStatements = corpus.changes.map((change) => ({
    sql:
      `INSERT OR IGNORE INTO card_changes
         (id, card_action_id, field, value)
       VALUES (?, ?, ?, ?)`,
    params: [change.id, change.cardActionId, change.field, change.value] as unknown[],
  }));
  const changeResults = await driver.batch(changeStatements);
  const changes = changeResults.reduce((sum, result) => sum + result.rowsAffected, 0);

  const referenceStatements = corpus.references.map((reference) => ({
    sql:
      `INSERT OR IGNORE INTO card_references
         (id, referer_id, referee_key, referee_id, ref_type, is_present)
       VALUES (?, ?, ?, ?, ?, ?)`,
    params: [reference.id, reference.refererId, reference.refereeKey, reference.refereeId, reference.refType, reference.isPresent] as unknown[],
  }));
  const referenceResults = await driver.batch(referenceStatements);
  const references = referenceResults.reduce((sum, result) => sum + result.rowsAffected, 0);

  return { cards, actions, acts, changes, references };
}

export async function seedCoreFixture(driver: SQLDatabaseDriver, stamp: string): Promise<number> {
  const statements = CORE_FIXTURE_SEED_CARDS.map((card) => ({
    sql:
      `INSERT OR IGNORE INTO cards
         (id, name, key, codename, left_id, right_id, current_revision_id,
          created_at, updated_at, creator_id, updater_id,
          read_rule_class, read_rule_id, references_expired, trash,
          type_id, db_content)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 1, '*all', 10, NULL, 0, ?, ?)`,
    params: [
      card.id,
      card.name,
      card.key,
      card.codename,
      card.leftId,
      card.rightId,
      stamp,
      stamp,
      card.typeId,
      card.dbContent,
    ] as unknown[],
  }));
  const results = await driver.batch(statements);
  return results.reduce((sum, result) => sum + result.rowsAffected, 0);
}

async function ensureSeedCard(
  engine: CardActionEngine,
  seed: AccountModSeedCard,
  driver: SQLDatabaseDriver,
  bot: Actor,
  created: string[],
  updated: string[],
): Promise<void> {
  const typeId = seed.typeCodename === undefined
    ? undefined
    : await codenameCardId(driver, seed.typeCodename);
  await ensureNamed(engine, seed.name, seed.content, typeId, created, updated, seed.codename);
  void bot;
}

async function ensureNamed(
  engine: CardActionEngine,
  name: string,
  content: string | undefined,
  typeId: number | undefined,
  created: string[],
  updated: string[],
  codename?: string,
): Promise<void> {
  const existing = await engine.fetch.fetchByName(name);
  if (existing !== undefined && existing.id !== undefined) {
    if (existing.dbContent !== (content ?? "") && content !== undefined) {
      await engine.updateCard({ cardId: existing.id, content });
      updated.push(name);
    }
    return;
  }
  await engine.createCard({
    name,
    content: content ?? null,
    typeId,
    codename: codename ?? null,
  });
  created.push(name);
}

async function codenameCardId(driver: SQLDatabaseDriver, codename: string): Promise<number | undefined> {
  const result = await driver.query<{ id: number }>(
    "SELECT id FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1",
    [codename],
  );
  return result.rows[0]?.id;
}
