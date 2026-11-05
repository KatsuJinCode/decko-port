

import { beforeEach, describe, expect, it } from "vitest";
import {
  ANONYMOUS_CODENAME,
  actorAnonymous,
  actorBot,
  actorByCodename,
  ActorNotFoundError,
  DECKOBOT_CODENAME,
} from "../../../src/card/auth/actor.js";
import {
  createAuthTestStorage,
  insertAccountCard,
  type AuthTestStorage,
} from "./auth-test-storage.js";

describe("system actor constructors", () => {
  let storage: AuthTestStorage;

  beforeEach(() => {
    storage = createAuthTestStorage();

    insertAccountCard(storage, { id: 1, name: "Test Bot", codename: DECKOBOT_CODENAME });
    insertAccountCard(storage, { id: 2, name: "Test Anon", codename: ANONYMOUS_CODENAME });
  });

  it("actorAnonymous resolves the 'anonymous' codename card's id and name", async () => {
    expect(await actorAnonymous(storage.driver)).toEqual({ id: 2, name: "Test Anon" });
  });

  it("actorBot resolves the 'deckobot' codename card's id and name (as_bot target)", async () => {
    expect(await actorBot(storage.driver)).toEqual({ id: 1, name: "Test Bot" });
  });

  it("resolves by codename, not by hardcoded id (a deck with shifted ids still works)", async () => {

    storage.exec("UPDATE cards SET codename = NULL WHERE id = 1");
    insertAccountCard(storage, { id: 4100, name: "Shifted Bot", codename: DECKOBOT_CODENAME });
    expect(await actorBot(storage.driver)).toEqual({ id: 4100, name: "Shifted Bot" });
  });

  it("throws ActorNotFoundError when the codename card is missing (deck not bootstrapped)", async () => {
    storage.exec(`DELETE FROM cards WHERE codename = '${ANONYMOUS_CODENAME}'`);
    await expect(actorAnonymous(storage.driver)).rejects.toBeInstanceOf(ActorNotFoundError);
    try {
      await actorAnonymous(storage.driver);
    } catch (error) {
      expect((error as ActorNotFoundError).codename).toBe(ANONYMOUS_CODENAME);
      expect((error as ActorNotFoundError).message).toContain("anonymous");
    }
  });

  it("never resolves a TRASHED codename card even though its codename still matches", async () => {
    storage.exec(`UPDATE cards SET trash = 1 WHERE codename = '${ANONYMOUS_CODENAME}'`);
    await expect(actorAnonymous(storage.driver)).rejects.toBeInstanceOf(ActorNotFoundError);
  });

  it("actorByCodename is the general resolver behind both constructors", async () => {
    expect(await actorByCodename(storage.driver, DECKOBOT_CODENAME)).toEqual({
      id: 1,
      name: "Test Bot",
    });
  });
});
