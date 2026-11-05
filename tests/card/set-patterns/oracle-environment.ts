/**
 * Test environment mirroring the deck facts of the live oracle app
 * (tools/oracle/decko-oracle-app), as captured in
 * set-pattern-oracle-capture.json / set-pattern-oracle-capture2.json.
 *
 * Every id below is a CAPTURED id from the oracle deck (deck-specific; the
 * production port resolves them through the DB-backed lexicon and codename
 * registries from src/card/fetch).
 *
 * Note the RichText cardtype: the oracle deck's "RichText" card carries the
 * codename "basic" (the historical Basic cardtype was renamed RichText while
 * keeping its codename). Oracle evidence: the type pattern's module key for a
 * RichText card is "Type::Basic" (capture2, cards["Oracle Junction"]
 * .module_keys[1]) while its safe key is "TYPE-rich_text" (safe keys use the
 * NAME).
 */

import { afterEach, beforeEach } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import { getNameEnvironment, setNameEnvironment } from "../../../src/card/name/environment.js";
import type { NameEnvironment } from "../../../src/card/name/environment.js";

interface CardFact {
  id: number;
  name: string;
  codename?: string;
}

/** Captured card facts: id, canonical name, codename where present. */
export const ORACLE_CARD_FACTS: readonly CardFact[] = [
  { id: 2, name: "RichText", codename: "basic" },
  { id: 4, name: "List", codename: "list" },
  { id: 6, name: "Setting", codename: "setting" },
  { id: 7, name: "*all", codename: "all" },
  { id: 9, name: "*read", codename: "read" },
  { id: 10, name: "*all+*read" },
  { id: 20, name: "*all plus", codename: "all_plus" },
  { id: 21, name: "*type", codename: "type" },
  { id: 22, name: "*star", codename: "star" },
  { id: 23, name: "*rstar", codename: "rstar" },
  { id: 24, name: "*rule", codename: "rule" },
  { id: 25, name: "*type plus right", codename: "type_plus_right" },
  { id: 26, name: "*right", codename: "right" },
  { id: 27, name: "*self", codename: "self" },
  { id: 605, name: "Oracle Basics" },
  { id: 606, name: "Oracle Junction" },
  { id: 607, name: "child_one" },
  { id: 608, name: "Oracle Junction+child_one" },
];

const factByKey = new Map<string, CardFact>();
for (const fact of ORACLE_CARD_FACTS) {
  factByKey.set(DeckoName.parse(fact.name).key, fact);
}
const factByCodename = new Map<string, CardFact>();
for (const fact of ORACLE_CARD_FACTS) {
  if (fact.codename !== undefined) factByCodename.set(fact.codename, fact);
}
const factById = new Map<number, CardFact>(ORACLE_CARD_FACTS.map((f) => [f.id, f]));

/** NameEnvironment over the captured facts (cardname-0.20.0 key semantics). */
export const ORACLE_ENV: NameEnvironment = {
  lexicon: {
    id: (key) => factByKey.get(key)?.id,
    name: (id) => factById.get(id)?.name,
  },
  codename: {
    id: (codename) => factByCodename.get(codename)?.id,
    name: (codename) => factByCodename.get(codename)?.name,
    nameForId: (id) => factById.get(id)?.codename,
  },
};

let savedEnv: NameEnvironment | undefined;

beforeEach(() => {
  savedEnv = getNameEnvironment();
  setNameEnvironment(ORACLE_ENV);
});

afterEach(() => {
  setNameEnvironment(savedEnv);
});
