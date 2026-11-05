// Save-path notify wiring, end to end: a card saved through the REAL
// CardActionEngine dispatches the act's events to the registered
// follow-notify hook, whose template resolves from THIS deck's
// follower_notification_email children (deckEmailTemplateResolver) and
// whose mail lands in the injected CaptureTransport.
//
// Proven here (the wiring per docs/notify-port-notes.md "save-path
// registration line"):
//   - no integrationHooks configured -> saves dispatch nothing (engine
//     behavior unchanged for every pre-existing caller);
//   - hooks configured -> updating a followed card fires the hook once
//     with the deck-resolved template bytes (the interpolation vars the
//     first mechanism supports: {{follower}}, {{followed_set}},
//     {{follow_option}} — mail.ts renderMail);
//   - an anonymous actor dispatches nothing (notifications carry the
//     acting user; anonymous writes throw before any dispatch).
// The follower rule-algebra walk is a deferred stream: the follower
// resolver here is the fixed sugar (deck-resolvers.ts header).

import { describe, expect, it } from "vitest";
import {
  actionEngine,
  createActionsTestStorage,
  seedStandardDeck,
  type StandardFixture,
} from "./actions-test-storage.js";
import { CardActionEngine } from "../../../src/card/actions/card-action-engine.js";
import { seedCard } from "./actions-test-storage.js";
import {
  buildFollowNotifyHook,
  fixedAuthAs,
  fixedFollowerResolver,
  CaptureTransport,
  deckEmailTemplateResolver,
  type SavePathIntegrationHook,
} from "../../../src/card/notify/index.js";

async function freshWithHook(): Promise<{
  f: StandardFixture;
  engine: CardActionEngine;
  transport: CaptureTransport;
}> {
  const f = await (async () => {
    const storage = await createActionsTestStorage();
    const fixture = await seedStandardDeck(storage);
    return fixture;
  })();
  const transport = new CaptureTransport();
  const hooks: SavePathIntegrationHook[] = [
    buildFollowNotifyHook({
      followers: fixedFollowerResolver([
        {
          followerId: 12,
          followerName: "Sara",
          followerEmail: "sara@example.com",
          followedSetName: "Watched Card+*followed",
          followOption: "always",
        },
      ]),
      template: deckEmailTemplateResolver(f.storage.engine),
      authAs: fixedAuthAs({ id: 12, name: "Sara", email: "sara@example.com" }),
        defaultFrom: "no-reply@decko.org",
    }),
  ];
  const engine = new CardActionEngine(f.storage.engine, {
    actor: { id: 7, name: "John" },
    integrationHooks: hooks,
    notifyTransport: transport,
  });
  return { f, engine, transport };
}

/** The template triple, seeded as REAL rows: the setting cards (*subject,
 *  *text message, *html message) + the junction children under `follower
 *  notification email` (junction rows carry NULL name + side ids — the
 *  child names M6's real capture proved). */
async function seedTemplateCards(f: StandardFixture): Promise<void> {
  await seedCard(f.storage, { id: 556, name: "follower notification email", typeId: 2 });
  await seedCard(f.storage, { id: 557, name: "*subject", typeId: 2 });
  await seedCard(f.storage, { id: 558, name: "*text message", typeId: 2 });
  await seedCard(f.storage, { id: 559, name: "*html message", typeId: 2 });
  await seedCard(f.storage, {
    id: 560,
    leftId: 556,
    rightId: 557,
    typeId: 2,
    dbContent: "{{followed_set}} on {{follow_option}}",
  });
  await seedCard(f.storage, {
    id: 561,
    leftId: 556,
    rightId: 558,
    typeId: 2,
    dbContent: "Hi! {{follower}} — {{followed_set}} changed.",
  });
  await seedCard(f.storage, { id: 562, leftId: 556, rightId: 559, typeId: 2, dbContent: "" });
}

describe("save-path notify wiring (CardActionEngine -> integration hooks)", () => {
  it("dispatches nothing when no integrationHooks are configured", async () => {
    const f = await (async () => {
      const storage = await createActionsTestStorage();
      return seedStandardDeck(storage);
    })();
    const transport = new CaptureTransport();
    const engine = new CardActionEngine(f.storage.engine, {
      actor: { id: 7, name: "John" },
      notifyTransport: transport,
    });
    const created = await engine.createCard({ name: "Plain Card", content: "x" });
    await engine.updateCard({ cardId: created.cardId, content: "y" });
    expect(transport.captured()).toEqual([]);
    f.storage.close();
  });

  it("fires the follow hook with the deck-resolved template on update", async () => {
    const { f, engine, transport } = await freshWithHook();
    await seedTemplateCards(f);
    const created = await engine.createCard({ name: "Watched Card", content: "first" });
    transport.drain(); // the create's own act is not the target here
    await engine.updateCard({ cardId: created.cardId, content: "second" });
    const mails = transport.captured();
    expect(mails.length).toBe(1);
    expect(mails[0]?.to).toBe("sara@example.com");
    expect(mails[0]?.subject).toBe("Watched Card+*followed on always");
    expect(mails[0]?.textBody).toBe("Hi! Sara — Watched Card+*followed changed.");
    f.storage.close();
  });

  it("dispatches nothing for an anonymous actor even with hooks configured", async () => {
    const f = await (async () => {
      const storage = await createActionsTestStorage();
      return seedStandardDeck(storage);
    })();
    const transport = new CaptureTransport();
    const engine = new CardActionEngine(f.storage.engine, {
      actor: null,
      integrationHooks: [
        buildFollowNotifyHook({
          followers: fixedFollowerResolver([]),
          template: deckEmailTemplateResolver(f.storage.engine),
          authAs: fixedAuthAs({ id: 1, name: "x", email: null }),
          defaultFrom: "no-reply@decko.org",
        }),
      ],
      notifyTransport: transport,
    });
    await expect(engine.createCard({ name: "Nope" })).rejects.toThrow();
    expect(transport.captured()).toEqual([]);
    f.storage.close();
  });
});
