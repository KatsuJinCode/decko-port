// tests/card/notify/transport-and-dispatch.test.ts — the transport seam
// and the dispatcher.
//
// What this test proves:
//   - CaptureTransport records every send, in order, with seq numbers.
//   - CaptureTransport.drain() clears; tests can isolate scenarios.
//   - LoggingTransport delegates to its inner transport and ALSO emits
//     a log line per send (matching Ruby's Net::SMTPError rescue path's
//     "log and continue" pattern).
//   - runIntegrationHooks() iterates events × hooks, gates each by the
//     hook's `notable`, and yields a receipt per (hook, event).
//   - runIntegrationHooks() catches per-hook errors (a failing hook
//     does not abort other hooks for the same event).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildFollowNotifyHook,
  fixedAuthAs,
  fixedFollowerResolver,
  fixedTemplateResolver,
  type FollowerRef,
} from "../../../src/card/notify/follow-notify.js";
import {
  CaptureTransport,
  LoggingTransport,
  NoopTransport,
  type NotifyActor,
  type SavePathEvent,
  type SavePathIntegrationHook,
  runIntegrationHooks,
  makeNotifyContext,
  savePathEventFromAction,
  expandActionResultToSavePathEvents,
} from "../../../src/card/notify/index.js";
import type { ActionResult } from "../../../src/card/actions/types.js";
import { DeckoName } from "../../../src/card/name.js";

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

describe("CaptureTransport", () => {
  it("records every sendMail call in order, with a 1-based seq", async () => {
    const t = new CaptureTransport("t");
    await t.sendMail({ to: "a", from: "b", subject: "s1", textBody: "x" } as never);
    await t.sendMail({ to: "c", from: "d", subject: "s2", textBody: "y" } as never);
    expect(t.count()).toBe(2);
    expect(t.captured()[0].to).toBe("a");
    expect(t.captured()[1].to).toBe("c");
    expect(t.captured()[0].seq).toBe(1);
    expect(t.captured()[1].seq).toBe(2);
  });

  it("drain returns and clears", async () => {
    const t = new CaptureTransport("t");
    await t.sendMail({ to: "a", from: "b", subject: "s1", textBody: "x" } as never);
    const out = t.drain();
    expect(out).toHaveLength(1);
    expect(t.count()).toBe(0);
  });

  it("drain re-seats the seq counter", async () => {
    const t = new CaptureTransport("t");
    await t.sendMail({ to: "a", from: "b", subject: "s1", textBody: "x" } as never);
    t.drain();
    await t.sendMail({ to: "c", from: "d", subject: "s2", textBody: "y" } as never);
    expect(t.captured()[0].seq).toBe(1);
  });
});

describe("NoopTransport", () => {
  it("drops messages silently and exposes name=noop", async () => {
    const t = new NoopTransport();
    await t.sendMail({ to: "a", from: "b", subject: "s1", textBody: "x" } as never);
    expect(t.name).toBe("noop");
  });
});

describe("LoggingTransport", () => {
  it("writes one log line per send and forwards to the inner transport", async () => {
    const inner = new CaptureTransport("inner");
    const logger = vi.fn();
    const lt = new LoggingTransport(inner, logger);
    await lt.sendMail({
      to: "x@y",
      from: "z@y",
      subject: "hi",
      textBody: "body",
    } as never);
    expect(logger).toHaveBeenCalledOnce();
    const line = logger.mock.calls[0][0] as string;
    expect(line).toContain("to=x@y");
    expect(line).toContain('subject="hi"');
    expect(inner.count()).toBe(1);
  });
});

describe("runIntegrationHooks", () => {
  let transport: CaptureTransport;
  beforeEach(() => {
    transport = new CaptureTransport("dispatch");
  });

  it("fires every hook for every notable event", async () => {
    const hook1 = buildFollowNotifyHook({
      followers: fixedFollowerResolver([
        { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
      ]),
      template: fixedTemplateResolver({
        to: "x", from: "y", subject: "s", textBody: "b",
      }),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });
    const hook2: SavePathIntegrationHook = {
      stage: "integrate",
      name: "spy",
      notable: () => true,
      fire: vi.fn().mockResolvedValue(undefined),
    };

    const receipts = await runIntegrationHooks({
      actId: 1,
      actor: ACTOR,
      silent: false,
      events: [makeEvent()],
      hooks: [hook1, hook2],
      context: makeNotifyContext(transport),
    });

    expect(transport.count()).toBe(1); // hook1 sent one mail
    expect(hook2.fire).toHaveBeenCalledOnce();
    // 2 hooks × 1 event = 2 receipts
    expect(receipts).toHaveLength(2);
    expect(receipts.map((r) => r.status)).toEqual(["fired", "fired"]);
  });

  it("skips events whose notable predicate rejects them", async () => {
    const silentHook = buildFollowNotifyHook({
      followers: fixedFollowerResolver([
        { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
      ]),
      template: fixedTemplateResolver({
        to: "x", from: "y", subject: "s", textBody: "b",
      }),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });

    const receipts = await runIntegrationHooks({
      actId: 1,
      actor: ACTOR,
      silent: true,
      events: [makeEvent({ silent: true })],
      hooks: [silentHook],
      context: makeNotifyContext(transport),
    });

    expect(transport.count()).toBe(0);
    expect(receipts[0].status).toBe("skipped");
  });

  it("a failing hook does not abort the rest (matching rescue_if_integration)", async () => {
    const boom: SavePathIntegrationHook = {
      stage: "integrate",
      name: "boom",
      notable: () => true,
      fire: vi.fn().mockRejectedValue(new Error("smtp down")),
    };
    const goodHook = buildFollowNotifyHook({
      followers: fixedFollowerResolver([
        { followerId: 11, followerName: "John", followerEmail: "john@example.com", followedSetName: "John Following", followOption: "always" },
      ]),
      template: fixedTemplateResolver({
        to: "x", from: "y", subject: "s", textBody: "b",
      }),
      authAs: fixedAuthAs(ACTOR),
      defaultFrom: "deck@example.com",
    });
    const seen: { hook: string; status: string }[] = [];
    await runIntegrationHooks({
      actId: 1,
      actor: ACTOR,
      silent: false,
      events: [makeEvent()],
      hooks: [boom, goodHook],
      context: makeNotifyContext(transport),
      onError: (_err, hook, _ev) => {
        seen.push({ hook: hook.name ?? "?", status: "caught" });
      },
    });
    expect(transport.count()).toBe(1); // goodHook still fires
    expect(seen).toEqual([{ hook: "boom", status: "caught" }]);
  });
});

describe("savePathEventFromAction / expandActionResultToSavePathEvents", () => {
  const action: ActionResult = {
    cardId: 12,
    actionId: 100,
    actId: 5,
    verb: "update",
    name: DeckoName.parse("John Following+lens"),
    subactions: [
      { cardId: 13, actionId: 101, verb: "update", name: DeckoName.parse("John Following+lens+price") },
    ],
  };

  it("expands to one event per action with shared actId", () => {
    const events = expandActionResultToSavePathEvents(action, ACTOR, false);
    expect(events).toHaveLength(2);
    expect(events[0].actId).toBe(5);
    expect(events[1].actId).toBe(5);
    expect(events[0].actionId).toBe(100);
    expect(events[1].actionId).toBe(101);
    expect(events[0].card?.name).toBe("John Following+lens");
    expect(events[1].card?.name).toBe("John Following+lens+price");
  });

  it("emits isDeletePath=true when verb is delete", () => {
    const del: ActionResult = { ...action, verb: "delete", actionId: 100, cardId: 12 };
    const e = savePathEventFromAction(del, ACTOR, 5, false);
    expect(e.isDeletePath).toBe(true);
  });

  it("accepts a missing name (the rare mid-flight delete case)", () => {
    const noName: ActionResult = { cardId: 13, actionId: 101, actId: 5, verb: "delete", subactions: [] };
    const e = savePathEventFromAction(noName, ACTOR, 5, false);
    expect(e.card).toBeNull();
    expect(e.isDeletePath).toBe(true);
  });
});
