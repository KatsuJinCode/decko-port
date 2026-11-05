/**
 * The deployed deck's inflection table (src/card/name/oracle-deck-inflections.ts).
 *
 * The deck-serving origins apply ORACLE_DECK_INFLECTIONS at boot (the Rails
 * config/initializers/inflections.rb moment) so the engine keys names exactly
 * as the corpus's live Ruby stored them. The 2026-09-25 staging defect made
 * the stakes concrete: WITHOUT the boot call the engine computes
 * `participant_` for "Participant(s)" (the default /s$/ singularization
 * strips the lone "s" segment), while the corpus stores `participant_s` —
 * the CQL plus-join resolved through DeckoName keying then fell back to
 * Ruby's -999 sentinel and every "+Project(s) Participating" section
 * rendered "0 results" site-wide.
 *
 * These pins hold the PRODUCTION table (not a synthetic one — the seam
 * mechanics with synthetic tables live in deck-inflection-config.test.ts).
 */

import { afterEach, describe, expect, it } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import {
  applyDeckInflections,
  resetDeckInflections,
} from "../../../src/card/name/inflect.js";
import { ORACLE_DECK_INFLECTIONS } from "../../../src/card/name/oracle-deck-inflections.js";

afterEach(() => {
  resetDeckInflections();
});

describe("oracle deck inflection table (deployed deck boot data)", () => {
  it("default tables diverge from the corpus exactly on the recovered words", () => {
    resetDeckInflections();
    // the DEFAULT-engine keys — the byte shapes that made the staging
    // plus-joins return zero rows (projects-data-fix.md defect 1)
    expect(DeckoName.parse("Participant(s)").key).toBe("participant_");
    expect(DeckoName.parse("Project(s) Participating").key).toBe("project__participating");
    expect(DeckoName.parse("Brandon's").key).toBe("brandon_");
  });

  it("keys parenthesized junction names exactly as the corpus stores them", () => {
    applyDeckInflections(ORACLE_DECK_INFLECTIONS);
    // the corpus-stored keys (live Ruby's bytes, cards 406 / 420 / Brandon's
    // virtual participating section)
    expect(DeckoName.parse("Participant(s)").key).toBe("participant_s");
    expect(DeckoName.parse("Project(s) Participating").key).toBe("project_s_participating");
    // card 393's stored key (dual-lane capture db): live Ruby singularizes
    // "Williams" -> "william" under the SAME default rules — the deck table
    // changes nothing outside the three recovered uncountables
    expect(DeckoName.parse("Brandon WilliamsCraig").key).toBe("brandon_william_craig");
    expect(
      DeckoName.parse("Brandon WilliamsCraig+Project(s) Participating").key,
    ).toBe("brandon_william_craig+project_s_participating");
    // the possessive family (Brandon's -> brandon_s) site-wide
    expect(DeckoName.parse("Brandon's").key).toBe("brandon_s");
  });

  it("protects the other two recovered uncountables and nothing else", () => {
    applyDeckInflections(ORACLE_DECK_INFLECTIONS);
    expect(DeckoName.parse("delete this").key).toBe("delete_this");
    expect(DeckoName.parse("Anonymous").key).toBe("anonymous");
    // every other default singularization still fires under the deck table
    expect(DeckoName.parse("Participants").key).toBe("participant");
    expect(DeckoName.parse("musings").key).toBe("musing");
  });
});
