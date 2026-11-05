

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

    expect(DeckoName.parse("Participant(s)").key).toBe("participant_");
    expect(DeckoName.parse("Project(s) Participating").key).toBe("project__participating");
    expect(DeckoName.parse("Gordon's").key).toBe("gordon_");
  });

  it("keys parenthesized junction names exactly as the corpus stores them", () => {
    applyDeckInflections(ORACLE_DECK_INFLECTIONS);

    expect(DeckoName.parse("Participant(s)").key).toBe("participant_s");
    expect(DeckoName.parse("Project(s) Participating").key).toBe("project_s_participating");

    expect(DeckoName.parse("Gordon Williams").key).toBe("gordon_william_craig");
    expect(
      DeckoName.parse("Gordon Williams+Project(s) Participating").key,
    ).toBe("gordon_william_craig+project_s_participating");

    expect(DeckoName.parse("Gordon's").key).toBe("gordon_s");
  });

  it("protects the other two recovered uncountables and nothing else", () => {
    applyDeckInflections(ORACLE_DECK_INFLECTIONS);
    expect(DeckoName.parse("delete this").key).toBe("delete_this");
    expect(DeckoName.parse("Anonymous").key).toBe("anonymous");

    expect(DeckoName.parse("Participants").key).toBe("participant");
    expect(DeckoName.parse("musings").key).toBe("musing");
  });
});
