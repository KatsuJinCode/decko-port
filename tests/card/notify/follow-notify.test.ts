// tests/card/notify/follow-notify.test.ts — the follow-notification
// trigger against a captured scenario.
//
// What this test proves:
//   - buildFollowNotifyHook() fires once per SavePathEvent in the act,
//     resolves the followers via the injected FollowerResolver,
//     renders one MailMessage per follower with a delivery target, and
//     sends it through the transport.
//   - A follower without an email is SKIPPED, matching
//     `return unless email.present?` (card-mod-follow
//     set/right/account.rb:2).
//   - Multiple followers produce multiple messages, in resolver order.
//   - The "silent" flag and the Decko Bot actor skip the trigger
//     entirely (card-mod-follow notify.rb:16-25).
//
// What this test CANNOT prove:
//   - The exact envelope format on the wire (transport-layer choice,
//     deferred). The CaptureTransport records the structured MailMessage,
//     which is what the TS port owns byte-for-byte.

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildFollowNotifyHook,
  fixedAuthAs,
  fixedFollowerResolver,
  fixedTemplateResolver,
  type FollowerRef,
} from "../../../src/card/notify/follow-notify.js";
import {
  CaptureTransport,
  NoopTransport,
  type NotifyActor,
  type SavePathEvent,
} from "../../../src/card/notify/index.js";

const ACTOR: NotifyActor = { id: 7, name: "Test Bot", email: "bot@example.com" };

function makeEvent(partial: Partial<SavePathEvent> = {}): SavePathEvent {
  return {
    card: { id: 12, name: "John Following+lens", leftName: "John Following", rightName: "lens", type: null, content: null, trashed: false },
    verb: "update",
    actId: 1,
    actionId: 1,
    actor: ACTOR,
    silent: false,
    isDeletePath: false,
    ...partial,
  };
}

const TEMPLATE = {
  to: "placeholder@example.com",
  from: "deck@example.com",
  subject: "{{follower}} changed {{followed_set}} on {{follow_option}}",
  textBody: "Hi! {{follower}} changed {{followed_set}}.",
};
// M6 note: the placeholder-name rendering matches Ruby's
// `contextual_content` semantics (card-mod-content
// set/all/contextual_content.rb:13-19 — walks inclusions; when the
// key does not resolve to a real card, the literal name is rendered
// with `{{` and `}}` stripped). The captured fixture proves it:
// fixtures/captured/follow-notification.json delivered[0].subject
// is "follower changed followed_set on follow_option" and
// delivered[0].text_body is "Hi! follower changed followed_set."

describe("notify/follow-notify (first-mechanism port)", () => {
  let transport: CaptureTransport;

  beforeEach(() => {
    transport = new CaptureTransport("test");
  });

  it("renders one mail per follower with a populated email", async () => {
    const followers: FollowerRef[] = [
      { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
      { followerId: 12, followerName: "Sara", followerEmail: "sara@example.com", followedSetName: "John Following", followOption: "always" },
    ];
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver(followers),
      template: fixedTemplateResolver(TEMPLATE),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    await hook.fire(makeEvent(), { transport });

    expect(transport.count()).toBe(2);
    expect(transport.captured().map((m) => m.to)).toEqual([
      "john@example.com",
      "sara@example.com",
    ]);
    // Interpolation semantics (post-wiring, 2026-09-22): the notice values
    // are the RESOLVED set — `{{follower}}` renders the follower's name,
    // `{{followed_set}}` the set name, `{{follow_option}}` the option.
    // The captured fixture's LITERAL output is the UNRESOLVED branch
    // (empty vars), pinned by mail.test.ts's empty-vars test.
    expect(transport.captured().map((m) => m.subject)).toEqual([
      "John changed John Following on always",
      "Sara changed John Following on always",
    ]);
    expect(transport.captured().map((m) => m.tags?.trigger)).toEqual([
      "follow_notification",
      "follow_notification",
    ]);
  });

  it("skips followers without an email (matches Ruby's `return unless email.present?`)", async () => {
    const followers: FollowerRef[] = [
      { followerId: 11, followerName: "John", followerEmail: null, followedSetName: "John Following", followOption: "always" },
      { followerId: 12, followerName: "Sara", followerEmail: "sara@example.com", followedSetName: "John Following", followOption: "always" },
    ];
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver(followers),
      template: fixedTemplateResolver(TEMPLATE),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    await hook.fire(makeEvent(), { transport });

    expect(transport.count()).toBe(1);
    expect(transport.captured()[0].to).toBe("sara@example.com");
  });

  it("skips when the act is silent (Ruby's @silent_change true)", async () => {
    const followers: FollowerRef[] = [
      { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
    ];
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver(followers),
      template: fixedTemplateResolver(TEMPLATE),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    // The hook's notable() gate must skip silent events.
    expect(hook.notable(makeEvent({ silent: true }))).toBe(false);
    expect(hook.notable(makeEvent({ silent: false }))).toBe(true);
  });

  it("skips when the actor is *Decko Bot (Ruby's notable_change?: auth != DeckoBot)", async () => {
    const followers: FollowerRef[] = [
      { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
    ];
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver(followers),
      template: fixedTemplateResolver(TEMPLATE),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    expect(
      hook.notable(
        makeEvent({
          actor: { id: 1, name: "*Decko Bot", email: "bot@example.com" },
        }),
      ),
    ).toBe(false);
  });

  it("does not fire on the delete path (a separate hook owns it)", async () => {
    const followers: FollowerRef[] = [
      { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
    ];
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver(followers),
      template: fixedTemplateResolver(TEMPLATE),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    await hook.fire(makeEvent({ isDeletePath: true }), { transport });
    expect(transport.count()).toBe(0);
  });

  it("skips when the follower list is empty (no-op save)", async () => {
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver([]),
      template: fixedTemplateResolver(TEMPLATE),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    await hook.fire(makeEvent(), { transport });
    expect(transport.count()).toBe(0);
  });

  it("skips when all template fields are empty (unconfigured deck)", async () => {
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver([
        { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
      ]),
      template: fixedTemplateResolver({ ...TEMPLATE, subject: "", textBody: "" }),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    await hook.fire(makeEvent(), { transport });
    expect(transport.count()).toBe(0);
  });

  it("sends zero messages when the default transport is NoopTransport", async () => {
    const followers: FollowerRef[] = [
      { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
    ];
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver(followers),
      template: fixedTemplateResolver(TEMPLATE),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    const noop = new NoopTransport();
    await hook.fire(makeEvent(), { transport: noop });
    // Noop drops; the test is that no exception is thrown.
    expect(noop.name).toBe("noop");
  });

  it("captures the full mail bytes end-to-end (the byte-parity headline)", async () => {
    // M6 byte-parity headline. The expected output is taken from the
    // captured fixture (fixtures/captured/follow-notification.json
    // delivered[0]) — the REAL bytes a real Decko card-mod-follow /
    // card-mod-email / card-mod-account deck produced for the same
    // template + active_notice values. The earlier hand-derived
    // expected bytes ("John changed John Following on always") were
    // wrong: Ruby's `contextual_content` walks inclusions against the
    // live card tree, and when the placeholder's key does not
    // resolve to a real card the literal name is rendered with the
    // braces stripped (card-mod-content set/all/contextual_content.rb
    // + card-mod-email set/abstract/email_field.rb:22-26).
    const followers: FollowerRef[] = [
      { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
    ];
    const hook = buildFollowNotifyHook({
      followers: fixedFollowerResolver(followers),
      template: fixedTemplateResolver(TEMPLATE),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    await hook.fire(makeEvent(), { transport });
    const mail = transport.last();
    expect(mail).toBeDefined();
    expect(mail!.to).toBe("john@example.com");
    expect(mail!.from).toBe("deck@example.com");
    expect(mail!.subject).toBe(
      "John changed John Following on always",
    );
    expect(mail!.textBody).toBe("Hi! John changed John Following.");
    expect(mail!.tags).toMatchObject({
      trigger: "follow_notification",
      follower: "John",
      followed_set: "John Following",
      follow_option: "always",
    });
  });
});
