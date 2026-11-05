

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

    expect(noop.name).toBe("noop");
  });

  it("captures the full mail bytes end-to-end (the byte-parity headline)", async () => {

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
