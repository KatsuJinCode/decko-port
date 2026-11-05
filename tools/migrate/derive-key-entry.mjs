import { DeckoName } from "../../src/card/name.ts";
import { applyDeckInflections, singularize } from "../../src/card/name/inflect.ts";
import { CARD_GEM_INITIALIZER_INFLECTIONS } from "../../src/card/name/oracle-deck-inflections.ts";

export function deriveKey(name) {
  if (singularize("anonymous") !== "anonymous") applyDeckInflections(CARD_GEM_INITIALIZER_INFLECTIONS);
  return DeckoName.parse(name).key;
}
