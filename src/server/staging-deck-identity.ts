import type {SQLDatabaseDriver} from "./driver.js";
import {rawItemStrings} from "../card/render/pointer-list.js";

type QueryDriver = Pick<SQLDatabaseDriver, "query">;

export interface ActiveSkinCard {
  readonly id: number;
  readonly dbContent: string;
}

export async function readActiveSkinCard(driver: QueryDriver): Promise<ActiveSkinCard | null> {
  const {rows} = await driver.query<{db_content: string | null}>(
    "SELECT rule.db_content AS db_content" +
      " FROM cards rule" +
      " JOIN cards all_card ON rule.left_id = all_card.id AND all_card.trash = 0" +
      " JOIN cards setting ON rule.right_id = setting.id AND setting.trash = 0" +
      " WHERE all_card.codename = 'all' AND setting.codename = 'style' AND rule.trash = 0 LIMIT 1",
    [],
  );
  const firstItem = rawItemStrings(rows[0]?.db_content ?? "").find(item => item.length > 0);
  if (firstItem === undefined) return null;
  const skin = await driver.query<{id: number; db_content: string | null}>(
    "SELECT id, db_content FROM cards WHERE name = ? AND trash = 0 LIMIT 1",
    [firstItem],
  );
  const row = skin.rows[0];
  return row === undefined ? null : {id: Number(row.id), dbContent: row.db_content ?? ""};
}

export async function readCardIdByCodename(driver: QueryDriver, codename: string): Promise<number | null> {
  const {rows} = await driver.query<{id: number}>(
    "SELECT id FROM cards WHERE codename = ? AND trash = 0 LIMIT 1",
    [codename],
  );
  const row = rows[0];
  return row === undefined ? null : Number(row.id);
}

export interface DefaultCardType {
  readonly id: number;
  readonly name: string;
  readonly classToken: string;
}

export async function readDefaultCardType(driver: QueryDriver): Promise<DefaultCardType | null> {
  const columns = "type_card.id AS id, type_card.name AS name, type_card.key AS key";
  const rule = await driver.query<{id: number; name: string | null; key: string | null}>(
    `SELECT ${columns}` +
      " FROM cards rule" +
      " JOIN cards all_card ON rule.left_id = all_card.id AND all_card.trash = 0" +
      " JOIN cards setting ON rule.right_id = setting.id AND setting.trash = 0" +
      " JOIN cards type_card ON type_card.id = rule.type_id AND type_card.trash = 0" +
      " WHERE all_card.codename = 'all' AND setting.codename = 'default' AND rule.trash = 0 LIMIT 1",
    [],
  );
  let row = rule.rows[0];
  if (row === undefined) {
    const basic = await driver.query<{id: number; name: string | null; key: string | null}>(
      `SELECT ${columns} FROM cards type_card WHERE type_card.codename = 'basic' AND type_card.trash = 0 LIMIT 1`,
      [],
    );
    row = basic.rows[0];
  }
  if (row === undefined) return null;
  const name = row.name ?? "";
  const key = row.key ?? name.toLowerCase().replace(/\s+/g, "_");
  return {id: Number(row.id), name, classToken: key.replace(/\*/g, "X").replace(/\+/g, "-")};
}

export function siteImageSmallUrl(assetOrigin: string, dbContent: string | null | undefined): string | null {
  const stored = (dbContent ?? "").trim();
  const bucket = /^\([^()\s]+\)\/(\d+)\/([\w-]+)\.([A-Za-z0-9]+)$/.exec(stored);
  if (bucket !== null) return `${assetOrigin.replace(/\/+$/, "")}/files/${bucket[1]}/${bucket[2]}-small.${bucket[3].toLowerCase()}`;
  const local = /^~(\d+)\/([\w-]+)\.([A-Za-z0-9]+)$/.exec(stored);
  if (local !== null) return `/files/~${local[1]}/${local[2]}-small.${local[3].toLowerCase()}`;
  return null;
}

export interface SiteBootValues {
  readonly siteTitle: string;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
}

export async function readSiteBootValues(
  driver: QueryDriver,
  assetOrigin: string,
  defaultTitle: string,
): Promise<SiteBootValues> {
  const {rows} = await driver.query<{name: string | null; db_content: string | null}>(
    "SELECT name, db_content FROM cards WHERE name IN ('*title', '*favicon', '*logo') AND trash = 0",
    [],
  );
  let siteTitle = defaultTitle;
  let logoUrl: string | null = null;
  let faviconUrl: string | null = null;
  for (const row of rows) {
    if (row.name === "*title" && typeof row.db_content === "string" && row.db_content.trim().length > 0) {
      siteTitle = row.db_content.trim();
    }
    if (row.name === "*logo") logoUrl = siteImageSmallUrl(assetOrigin, row.db_content);
    if (row.name === "*favicon") faviconUrl = siteImageSmallUrl(assetOrigin, row.db_content);
  }
  return {siteTitle, logoUrl, faviconUrl};
}

export interface FooterCardIdentity {
  readonly id: number;
  readonly typeId: number | null;
  readonly typeName: string | null;
}

export async function readFooterCardIdentity(driver: QueryDriver, footerName = "*footer"): Promise<FooterCardIdentity | null> {
  const {rows} = await driver.query<{id: number; type_id: number | null; type_name: string | null}>(
    "SELECT footer.id AS id, footer.type_id AS type_id, type_card.name AS type_name" +
      " FROM cards footer" +
      " LEFT JOIN cards type_card ON type_card.id = footer.type_id AND type_card.trash = 0" +
      " WHERE footer.name = ? AND footer.trash = 0 LIMIT 1",
    [footerName],
  );
  const row = rows[0];
  return row === undefined ? null : {
    id: Number(row.id),
    typeId: row.type_id === null || row.type_id === undefined ? null : Number(row.type_id),
    typeName: row.type_name ?? null,
  };
}
