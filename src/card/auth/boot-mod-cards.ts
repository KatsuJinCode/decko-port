import type { SQLDatabaseDriver } from "../../server/driver.js";
import { sqlDateTime } from "./session-store.js";
import { ORACLE_BUNDLE_ORDER } from "../mod-loader/default-mod-deck.js";
import { modScriptGroups } from "../assets/script-sources.js";
import { modStyleGroups } from "../assets/style-sources.js";
import type { CardActionEngine } from "../actions/card-action-engine.js";

export interface ModCardCascadeResult {
  readonly dependencyCardsCreated: readonly string[];
  readonly modCardsCreated: readonly string[];
  readonly modCardsRetyped: readonly string[];
  readonly inputCardsCreated: readonly string[];
  readonly assetListsSet: readonly string[];
}

interface CascadeDependencyCard {
  readonly name: string;
  readonly codename?: string;
  readonly typeCodename?: string;
}

const CASCADE_DEPENDENCY_CARDS: readonly CascadeDependencyCard[] = [
  { name: "Mod", codename: "mod", typeCodename: "cardtype" },
  { name: "*script", codename: "script", typeCodename: "setting" },
  { name: "*style", codename: "style", typeCodename: "setting" },
  { name: "style: mods", codename: "style_mods", typeCodename: "list" },
  { name: "*asset input", codename: "asset_input" },
  { name: "*asset output", codename: "asset_output" },
];

async function codenameCardId(driver: SQLDatabaseDriver, codename: string): Promise<number | undefined> {
  const result = await driver.query<{ id: number }>(
    "SELECT id FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1",
    [codename],
  );
  return result.rows[0]?.id;
}

function modCardName(modName: string): string {
  return `mod: ${modName.replace(/_/g, " ")}`;
}

export async function ensureInstalledModCards(
  engine: CardActionEngine,
  driver: SQLDatabaseDriver,
  now: () => Date = () => new Date(),
): Promise<ModCardCascadeResult> {
  const result: {
    dependencyCardsCreated: string[];
    modCardsCreated: string[];
    modCardsRetyped: string[];
    inputCardsCreated: string[];
    assetListsSet: string[];
  } = {
    dependencyCardsCreated: [],
    modCardsCreated: [],
    modCardsRetyped: [],
    inputCardsCreated: [],
    assetListsSet: [],
  };

  for (const seed of CASCADE_DEPENDENCY_CARDS) {
    const typeId = seed.typeCodename === undefined
      ? undefined
      : await codenameCardId(driver, seed.typeCodename);
    const existing = await engine.fetch.fetchByName(seed.name);
    if (existing !== undefined && existing.id !== undefined) continue;
    await engine.createCard({
      name: seed.name,
      content: null,
      typeId,
      codename: seed.codename ?? null,
    });
    result.dependencyCardsCreated.push(seed.name);
  }

  const scriptNames: string[] = [];
  const styleNames: string[] = [];
  const modTypeId = await codenameCardId(driver, "mod");
  const listTypeId = await codenameCardId(driver, "list");

  for (const modName of ORACLE_BUNDLE_ORDER) {
    const cardName = modCardName(modName);
    const codename = `mod_${modName}`;

    const existingId = await codenameCardId(driver, codename);
    if (existingId === undefined) {
      const existingByName = await engine.fetch.fetchByName(cardName);
      if (existingByName !== undefined && existingByName.id !== undefined) {
        if (modTypeId !== undefined && existingByName.typeId !== modTypeId) {
          await engine.updateCard({ cardId: existingByName.id, typeId: modTypeId });
          result.modCardsRetyped.push(cardName);
        }
      } else {
        await engine.createCard({
          name: cardName,
          content: null,
          typeId: modTypeId,
          codename,
        });
        result.modCardsCreated.push(cardName);
      }
    } else if (modTypeId !== undefined) {
      const row = await engine.fetch.fetchById(existingId);
      if (row !== undefined && row.typeId !== modTypeId) {
        await engine.updateCard({ cardId: existingId, typeId: modTypeId });
        result.modCardsRetyped.push(cardName);
      }
    }

    for (const [family, groups, names] of [
      ["script", modScriptGroups(modName), scriptNames],
      ["style", modStyleGroups(modName), styleNames],
    ] as const) {
      if (groups === undefined) continue;
      const inputName = `${cardName}+*${family}`;
      const existing = await engine.fetch.fetchByName(inputName);
      if (existing !== undefined && existing.id !== undefined) {
        names.push(inputName);
        continue;
      }
      await engine.createCard({ name: inputName, content: null, typeId: listTypeId });
      names.push(inputName);
      result.inputCardsCreated.push(inputName);
    }
  }

  const styleRule = await engine.fetch.fetchByName("style: mods");
  if (styleRule !== undefined && styleRule.id !== undefined && styleRule.dbContent !== styleNames.join("\n")) {
    await engine.updateCard({ cardId: styleRule.id, content: styleNames.join("\n") });
    result.assetListsSet.push("style: mods");
  }
  if (await ensureAllScriptRuleRow(driver, scriptNames, now())) {
    result.assetListsSet.push("*all+*script");
  }

  return result;
}

async function ensureAllScriptRuleRow(
  driver: SQLDatabaseDriver,
  scriptNames: readonly string[],
  stamp: Date,
): Promise<boolean> {
  const allId = await codenameCardId(driver, "all");
  const scriptId = await codenameCardId(driver, "script");
  const listTypeId = await codenameCardId(driver, "list");
  if (allId === undefined || scriptId === undefined || listTypeId === undefined) return false;
  const content = scriptNames.join("\n");
  const existing = (
    await driver.query<{ id: number; db_content: string | null }>(
      "SELECT id, db_content FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0 LIMIT 1",
      [allId, scriptId],
    )
  ).rows[0];
  const stampText = sqlDateTime(stamp);
  if (existing !== undefined) {
    if ((existing.db_content ?? "") === content) return false;
    await driver.query("UPDATE cards SET db_content = ?, updated_at = ? WHERE id = ?", [
      content,
      stampText,
      existing.id,
    ]);
    return true;
  }
  await driver.query(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id,
        read_rule_class, read_rule_id, references_expired, trash,
        type_id, db_content)
     VALUES
       (NULL, NULL, NULL, NULL, ?, ?, NULL, ?, ?, 1, 1, '*all', 10, NULL, 0, ?, ?)`,
    [allId, scriptId, stampText, stampText, listTypeId, content],
  );
  return true;
}
