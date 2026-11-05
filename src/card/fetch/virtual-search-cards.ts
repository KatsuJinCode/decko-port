import { DeckoName } from "../name.js";

export const VIRTUAL_SEARCH_CQL_BY_CODENAME: ReadonlyMap<string, string> =
  new Map([
    ["by_create", '{"found_by":"_left","sort_by":"create"}'],
    ["by_name", '{"found_by":"_left","sort_by":"name"}'],
    ["by_update", '{"found_by":"_left","sort_by":"update"}'],
    ["children", '{"part":"_left","sort_by":"name"}'],
    ["count", '{"found_by":"_left","return":"count"}'],
    ["created", '{"created_by":"_left","sort_by":"create","dir":"desc"}'],
    ["creator", '{"creator_of":"_left"}'],
    ["edited", '{"edited_by":"_left","sort_by":"name"}'],
    ["editors", '{"editor_of":"_left","sort_by":"name"}'],
    ["last_edited", '{"last_edited_by":"_left"}'],
    ["linked_to_by", '{"link_to":"_left","sort_by":"name"}'],
    ["links_to", '{"linked_to_by":"_left","sort_by":"name"}'],
    ["nested_by", '{"nest":"_left","sort_by":"name"}'],
    ["nests", '{"nested_by":"_left","sort_by":"name"}'],
    ["referred_to_by", '{"refer_to":"_left","sort_by":"name"}'],
    ["refers_to", '{"referred_to_by":"_left","sort_by":"name"}'],
  ]);

const UNSTARRED_STOCK_CODENAMES = new Set(["by_create", "by_name", "by_update"]);

export const VIRTUAL_SEARCH_CQL_BY_RIGHT_KEY: ReadonlyMap<string, string> =
  new Map(
    [...VIRTUAL_SEARCH_CQL_BY_CODENAME].map(([codename, cql]) => [
      UNSTARRED_STOCK_CODENAMES.has(codename) ? codename : `*${codename}`,
      cql,
    ]),
  );

export type CodenameKeyResolver = (codename: string) => string | undefined;

export function virtualSearchCqlFor(
  name: DeckoName,
  codenameKey?: CodenameKeyResolver,
): string | undefined {
  if (!name.isCompound) return undefined;
  const rightKey = name.rightName?.key;
  if (rightKey === undefined) return undefined;
  if (codenameKey === undefined) return VIRTUAL_SEARCH_CQL_BY_RIGHT_KEY.get(rightKey);
  for (const [codename, cql] of VIRTUAL_SEARCH_CQL_BY_CODENAME) {
    if (codenameKey(codename) === rightKey) return cql;
  }
  return undefined;
}
