import type { DeckInflectionConfig } from "./inflect.js";

export const CARD_GEM_INITIALIZER_INFLECTIONS: DeckInflectionConfig = {
  uncountables: ["s", "this", "anonymous"],
  singular: [
    [/(g)rave$/i, "$1rave"],
    [/(g)raveyard$/i, "$1rave"],
    [/(ss)$/i, "$1"],
  ],
  plural: [
    [/(g)rave$/i, "$1raveyard"],
    [/(g)raveyard$/i, "$1raveyard"],
    [/(ss)$/i, "$1"],
  ],
};

export const ORACLE_DECK_INFLECTIONS: DeckInflectionConfig =
  CARD_GEM_INITIALIZER_INFLECTIONS;
