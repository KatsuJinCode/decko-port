

import { describe, expect, it } from "vitest";
import {
  actionEngine,
  createActionsTestStorage,
  seedCard,
  seedStandardDeck,
  type ActionsTestStorage,
  type StandardFixture,
} from "../actions/actions-test-storage.js";
import { CardActionEngine } from "../../../src/card/actions/card-action-engine.js";
import {
  CaptureTransport,
  defaultFollowerResolver,
  deckEmailTemplateResolver,
  fixedFollowerResolver,
  resolveFollowers,
  type SavePathEvent,
} from "../../../src/card/notify/index.js";

const ID = {
  set: 100,
  setting: 101,
  user: 102,
  follow: 103,
  always: 104,
  never: 105,
  created: 106,
  edited: 107,
  account: 108,
  email: 109,
  self: 110,
  type: 111,
  joeUser: 11,
  sara: 12,
  joeAccount: 209,
  joeEmail: 309,
  saraAccount: 212,
  saraEmail: 312,
  richTextTypeSet: 440,
  watchedSelfSet: 460,
  otherSelfSet: 470,
  watchedCard: 60,
  otherCard: 61,
} as const;

async function seedFollowDeck(storage: ActionsTestStorage): Promise<StandardFixture> {
  const f = await seedStandardDeck(storage);
  await seedCard(storage, { id: ID.set, name: "Set", codename: "set", typeId: 3 });
  await seedCard(storage, { id: ID.setting, name: "Setting", codename: "setting", typeId: 3 });
  await seedCard(storage, { id: ID.user, name: "User", codename: "user", typeId: 3 });
  await seedCard(storage, { id: ID.follow, name: "*follow", codename: "follow", typeId: ID.setting });
  await seedCard(storage, { id: ID.always, name: "*always", codename: "always" });
  await seedCard(storage, { id: ID.never, name: "*never", codename: "never" });
  await seedCard(storage, { id: ID.created, name: "*created", codename: "created" });
  await seedCard(storage, { id: ID.edited, name: "*edited", codename: "edited" });
  await seedCard(storage, { id: ID.self, name: "*self", codename: "self", typeId: ID.setting });
  await seedCard(storage, { id: ID.type, name: "*type", codename: "type", typeId: ID.setting });
  await seedCard(storage, { id: ID.account, name: "*account", codename: "account" });
  await seedCard(storage, { id: ID.email, name: "*email", codename: "email" });

  await seedCard(storage, { id: ID.joeUser, name: "Joe User", typeId: ID.user });
  await seedCard(storage, { id: ID.sara, name: "Sara", typeId: ID.user });
  await seedCard(storage, { id: ID.joeAccount, leftId: ID.joeUser, rightId: ID.account });
  await seedCard(storage, {
    id: ID.joeEmail,
    leftId: ID.joeAccount,
    rightId: ID.email,
    dbContent: "joe@example.com",
  });
  await seedCard(storage, { id: ID.saraAccount, leftId: ID.sara, rightId: ID.account });
  await seedCard(storage, {
    id: ID.saraEmail,
    leftId: ID.saraAccount,
    rightId: ID.email,
    dbContent: "sara@example.com",
  });

  await seedCard(storage, {
    id: ID.watchedCard,
    name: "Watched Card",
    dbContent: "v1",
  });
  await seedCard(storage, {
    id: ID.watchedSelfSet,
    leftId: ID.watchedCard,
    rightId: ID.self,
    typeId: ID.set,
  });

  await seedCard(storage, {
    id: ID.richTextTypeSet,
    leftId: 2,
    rightId: ID.type,
    typeId: ID.set,
  });

  await seedCard(storage, { id: ID.otherCard, name: "Other Card", dbContent: "x" });
  await seedCard(storage, {
    id: ID.otherSelfSet,
    leftId: ID.otherCard,
    rightId: ID.self,
    typeId: ID.set,
  });
  return f;
}

async function seedFollowRule(
  storage: ActionsTestStorage,
  opts: {
    setId: number;
    userId: number;
    content: string;
    prefId: number;
    joinId: number;
  },
): Promise<void> {
  await seedCard(storage, {
    id: opts.joinId,
    leftId: opts.setId,
    rightId: opts.userId,
  });
  await seedCard(storage, {
    id: opts.prefId,
    leftId: opts.joinId,
    rightId: ID.follow,
    dbContent: opts.content,
  });
}

async function seedTemplateCards(storage: ActionsTestStorage): Promise<void> {
  await seedCard(storage, { id: 556, name: "follower notification email", typeId: 2 });
  await seedCard(storage, { id: 557, name: "*subject", typeId: 2 });
  await seedCard(storage, { id: 558, name: "*text message", typeId: 2 });
  await seedCard(storage, {
    id: 560,
    leftId: 556,
    rightId: 557,
    typeId: 2,
    dbContent: "{{followed_set}} on {{follow_option}}",
  });
  await seedCard(storage, {
    id: 561,
    leftId: 556,
    rightId: 558,
    typeId: 2,
    dbContent: "Hi! {{follower}} — {{followed_set}} changed.",
  });
}

function makeEvent(actorId: number, actorName: string, cardId: number): SavePathEvent {
  return {
    card: {
      id: cardId,
      name: null,
      leftName: null,
      rightName: null,
      type: null,
      content: null,
      trashed: false,
    },
    verb: "update",
    actId: 1,
    actionId: 1,
    actor: { id: actorId, name: actorName, email: null },
    silent: false,
    isDeletePath: false,
  };
}

async function freshDeck(): Promise<{ storage: ActionsTestStorage; f: StandardFixture }> {
  const storage = await createActionsTestStorage();
  const f = await seedFollowDeck(storage);
  return { storage, f };
}

describe("follower-resolver (card-mod-follow rule algebra against real rows)", () => {
  it("resolves an *always follower with Ruby's set name + option strings", async () => {
    const { storage, f } = await freshDeck();
    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.joeUser,
      content: "*always",
      joinId: 480,
      prefId: 481,
    });
    const refs = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(2, "anonymous", ID.watchedCard),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.followerId).toBe(ID.joeUser);
    expect(refs[0]?.followerName).toBe("Joe User");
    expect(refs[0]?.followerEmail).toBe("joe@example.com");

    expect(refs[0]?.followedSetName).toBe("Watched Card+*self");
    expect(refs[0]?.followOption).toBe("*always");
    storage.close();
  });

  it("excludes an *never follower", async () => {
    const { storage, f } = await freshDeck();
    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.joeUser,
      content: "*never",
      joinId: 480,
      prefId: 481,
    });
    const refs = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(2, "anonymous", ID.watchedCard),
    );

    expect(refs).toEqual([]);
    storage.close();
  });

  it("resolves a follower matching two set rules exactly once, first pattern wins the reason", async () => {
    const { storage, f } = await freshDeck();

    await seedFollowRule(storage, {
      setId: ID.richTextTypeSet,
      userId: ID.joeUser,
      content: "*always",
      joinId: 480,
      prefId: 481,
    });
    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.joeUser,
      content: "*always",
      joinId: 482,
      prefId: 483,
    });
    const refs = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(2, "anonymous", ID.watchedCard),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.followedSetName).toBe("RichText+*type");
    expect(refs[0]?.followOption).toBe("*always");
    storage.close();
  });

  it("a more-general set's *never shadows a more-specific set's *always", async () => {
    const { storage, f } = await freshDeck();

    await seedFollowRule(storage, {
      setId: ID.richTextTypeSet,
      userId: ID.joeUser,
      content: "*never",
      joinId: 480,
      prefId: 481,
    });
    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.joeUser,
      content: "*always",
      joinId: 482,
      prefId: 483,
    });
    const refs = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(2, "anonymous", ID.watchedCard),
    );
    expect(refs).toEqual([]);
    storage.close();
  });

  it("applies rule lines in order: *never then *always still follows; non-matching *created falls through", async () => {
    const { storage, f } = await freshDeck();

    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.joeUser,
      content: "*never\n*created\n*always",
      joinId: 480,
      prefId: 481,
    });
    const refs = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(2, "anonymous", ID.watchedCard),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.followOption).toBe("*always");
    storage.close();
  });

  it("non-followers get nothing (rule on another card, or no rules)", async () => {
    const { storage, f } = await freshDeck();

    await seedFollowRule(storage, {
      setId: ID.otherSelfSet,
      userId: ID.joeUser,
      content: "*always",
      joinId: 480,
      prefId: 481,
    });
    const watched = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(2, "anonymous", ID.watchedCard),
    );
    expect(watched).toEqual([]);

    const other = await resolveFollowers(
      f.engine,
      ID.otherCard,
      makeEvent(2, "anonymous", ID.otherCard),
    );
    expect(other).toHaveLength(1);
    expect(other[0]?.followedSetName).toBe("Other Card+*self");
    storage.close();
  });

  it("*created matches only the creator; *edited matches actors of the card's acts", async () => {
    const { storage, f } = await freshDeck();

    await storage.driver.query("UPDATE cards SET creator_id = ? WHERE id = ?", [
      ID.sara,
      ID.watchedCard,
    ]);
    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.sara,
      content: "*created",
      joinId: 480,
      prefId: 481,
    });
    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.joeUser,
      content: "*edited",
      joinId: 482,
      prefId: 483,
    });

    const before = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(2, "anonymous", ID.watchedCard),
    );
    expect(before).toHaveLength(1);
    expect(before[0]?.followerId).toBe(ID.sara);
    expect(before[0]?.followOption).toBe("*created");

    const engine = actionEngine(storage, { id: ID.joeUser, name: "Joe User" });
    await engine.updateCard({ cardId: ID.watchedCard, content: "v2" });
    const after = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(2, "anonymous", ID.watchedCard),
    );
    expect(after).toHaveLength(2);
    const byUser = new Map(after.map((r) => [r.followerId, r.followOption]));
    expect(byUser.get(ID.sara)).toBe("*created");
    expect(byUser.get(ID.joeUser)).toBe("*edited");
    storage.close();
  });
});

describe("default save-path wiring (engine without integrationHooks)", () => {
  it("resolves real followers and mails them through the deck template", async () => {
    const { storage, f } = await freshDeck();

    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.sara,
      content: "*always",
      joinId: 480,
      prefId: 481,
    });
    await seedTemplateCards(storage);
    const transport = new CaptureTransport();

    const engine = new CardActionEngine(f.engine, {
      actor: { id: 11, name: "John" },
      notifyTransport: transport,
    });
    await engine.updateCard({ cardId: ID.watchedCard, content: "second" });
    const mails = transport.captured();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe("sara@example.com");
    expect(mails[0]?.subject).toBe("Watched Card+*self on *always");
    expect(mails[0]?.textBody).toBe("Hi! Sara — Watched Card+*self changed.");
    storage.close();
  });

  it("excludes the acting follower from the default resolution (notify.rb:51)", async () => {
    const { storage, f } = await freshDeck();

    await seedFollowRule(storage, {
      setId: ID.watchedSelfSet,
      userId: ID.sara,
      content: "*always",
      joinId: 480,
      prefId: 481,
    });
    const transport = new CaptureTransport();
    const engine = new CardActionEngine(f.engine, {
      actor: { id: ID.sara, name: "Sara" },
      notifyTransport: transport,
    });
    await engine.updateCard({ cardId: ID.watchedCard, content: "self-edit" });
    expect(transport.captured()).toEqual([]);

    const refs = await resolveFollowers(
      f.engine,
      ID.watchedCard,
      makeEvent(ID.sara, "Sara", ID.watchedCard),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.followerId).toBe(ID.sara);

    const defaulted = await defaultFollowerResolver(f.engine)(
      ID.watchedCard,
      makeEvent(ID.sara, "Sara", ID.watchedCard),
    );
    expect(defaulted).toEqual([]);
    storage.close();
  });

  it("honors an injected followerResolver on the engine options", async () => {
    const { storage, f } = await freshDeck();
    await seedTemplateCards(storage);
    const transport = new CaptureTransport();
    const engine = new CardActionEngine(f.engine, {
      actor: { id: 11, name: "John" },
      followerResolver: fixedFollowerResolver([
        {
          followerId: 12,
          followerName: "Sara",
          followerEmail: "sara@example.com",
          followedSetName: "Watched Card+*followed",
          followOption: "always",
        },
      ]),
      notifyTransport: transport,
    });
    await engine.updateCard({ cardId: ID.watchedCard, content: "second" });
    const mails = transport.captured();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toBe("Watched Card+*followed on always");
    storage.close();
  });

  it("exposes the seam pair the engine wires (both plain functions of the fetch engine)", async () => {
    const { storage, f } = await freshDeck();
    expect(typeof defaultFollowerResolver(f.engine)).toBe("function");
    expect(typeof deckEmailTemplateResolver(f.engine)).toBe("function");
    storage.close();
  });
});
