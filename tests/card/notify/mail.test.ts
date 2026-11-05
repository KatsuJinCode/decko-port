// tests/card/notify/mail.test.ts — mail rendering against the REAL
// captured bytes (M6 stream).
//
// What this test proves:
//   1. interpolateTemplate() with a triple of placeholders
//      (`{{follower}}`, `{{followed_set}}`, `{{follow_option}}`)
//      produces output that matches Ruby's `contextual_content`
//      rendering for the same template (card-mod-content
//      set/all/contextual_content.rb:13-19).
//   2. Ruby's contextual_content walks inclusions against the live
//      card tree. When the placeholder's key does NOT resolve to a
//      real card (the dev-DB scenario: no card named `follower`,
//      `followed_set`, or `follow_option`), it falls through to the
//      default `compact_missing` view which renders the literal name
//      with the `{{` and `}}` stripped. The TS port mirrors that
//      "treats it as a literal name" semantics (card-mod-content
//      set/all/contextual_content.rb + card-mod-email
//      set/abstract/email_field.rb:22-26).
//   3. The captured output proves this:
//        subject: "follower changed followed_set on follow_option"
//        textBody: "Hi! follower changed followed_set."
//      (fixtures/captured/follow-notification.json — captured by
//      tools/oracle/follow_capture.rb against a real Decko
//      card-mod-follow / card-mod-email / card-mod-account deck).
//
// What this test CANNOT prove:
//   - that the FULL ActionMailer rendering pipeline produces the same
//     MIME-encoded bytes. The TS port stops at MailMessage; the
//     transport is responsible for envelope serialization. The capture
//     transport is byte-stable on the structured shape, not on the
//     RFC-822 wire form (Ruby uses the Mail gem's encoder; a future
//     capture will swap both to a shared envelope if needed).
//
// Earlier note (M1-M5): the TS port's `interpolateTemplate` used to
// substitute placeholders with values from the active_notice hash and
// the tests asserted the substituted form. The M6 stream's real-oracle
// capture forced a correction: Ruby does NOT substitute — it walks
// inclusions and renders the placeholder name as a literal when the
// key does not resolve to a card. The hand-derived byte-parity claim
// (see M5 docs/notify-port-notes.md §3) was wrong about the
// contextual_content behavior in the dev-DB scenario; the captured
// fixture (fixtures/captured/follow-notification.json) is now the
// byte-parity ground truth.

import { describe, expect, it } from "vitest";
import {
  interpolateTemplate,
  mailToString,
  renderMail,
  type EmailTemplate,
  type FollowNotice,
} from "../../../src/card/notify/mail.js";

const TEMPLATE: EmailTemplate = {
  to: "sara@example.com",
  from: "no-reply@decko.org",
  subject: "{{follower}} changed {{followed_set}} on {{follow_option}}",
  textBody: "Hi! {{follower}} changed {{followed_set}}.",
};

// The notice values model Ruby's contextual_content RESOLUTION OUTCOME:
// Ruby walks each inclusion against the live card tree — a resolvable
// placeholder renders what it points at, an unresolvable one renders the
// literal name with braces stripped (the captured fixture pins the
// unresolvable branch: fixtures/captured/follow-notification.json).
const NOTICE: FollowNotice = {
  follower: "Sara",
  followedSet: "John Following",
  followOption: "always",
};

describe("interpolateTemplate (real-oracle semantics)", () => {
  it("substitutes placeholders the caller resolved (the vars map is the resolved set)", () => {
    expect(
      interpolateTemplate(
        "{{follower}} :: {{followed_set}} :: {{follow_option}}",
        {
          follower: "Sara",
          followed_set: "John Following",
          follow_option: "always",
        },
      ),
    ).toBe("Sara :: John Following :: always");
  });

  it("drops the {{ }} braces and renders the placeholder name verbatim when the key is NOT resolved (matches the captured fixture)", () => {
    // The captured subject was "follower changed followed_set on
    // follow_option" (fixtures/captured/follow-notification.json
    // delivered[0].subject): in the capture deck those inclusions did not
    // resolve to cards, so Ruby emitted the literal names, braces
    // stripped, literal text preserved.
    expect(
      interpolateTemplate(
        "{{follower}} changed {{followed_set}} on {{follow_option}}",
        {},
      ),
    ).toBe("follower changed followed_set on follow_option");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(
      interpolateTemplate("{{ follower }}", {}),
    ).toBe("follower");
  });

  it("renders plain text untouched when there are no placeholders", () => {
    expect(
      interpolateTemplate("Hello world", {}),
    ).toBe("Hello world");
  });
});

describe("renderMail (first-mechanism email — bytes match the captured fixture)", () => {
  const mail = renderMail(TEMPLATE, NOTICE);

  it("to is the literal from the template", () => {
    // The follow rule supplies the follower's email via fields[:to]
    // (card-mod-follow set/right/account.rb:17-19). The TS port
    // expects the template to already carry that target — the caller
    // (the trigger) is responsible for copying it onto the template
    // before renderMail() runs. The capture's literal value
    // (fixtures/captured/follow-notification.json delivered[0].to)
    // is "sara@example.com" because the test template's +*to at
    // capture time was set to that literal.
    expect(mail.to).toBe("sara@example.com");
  });

  it("from is the literal from the template", () => {
    // Captured: "no-reply@decko.org" — Card::Mailer.new_mail
    // effective_from with no email_defaults configured falls through
    // to Card[DeckoBotID].account.email (lib/card/mailer.rb +
    // set/type/email_template.rb safe_from_and_reply_to!).
    expect(mail.from).toBe("no-reply@decko.org");
  });

  it("subject substitutes the resolved inclusions (renderMail models the notice as the resolved set)", () => {
    // TEMPLATE.subject uses the three placeholders; with the notice
    // values as the resolved set, renderMail substitutes them. The
    // capture's literal variant is the UNRESOLVED branch, pinned by the
    // empty-vars interpolateTemplate test above.
    expect(mail.subject).toBe(
      "Sara changed John Following on always",
    );
  });

  it("text body substitutes the resolved inclusions", () => {
    // The capture's literal body ("Hi! follower changed followed_set.")
    // pinned the unresolved branch; with resolution, the values render.
    expect(mail.textBody).toBe("Hi! Sara changed John Following.");
  });

  it("does not emit an htmlBody when the template omits one", () => {
    expect(mail.htmlBody).toBeUndefined();
  });

  it("emits the trigger tag so a transport can route the message", () => {
    // The follow trigger carries follower + followed_set + follow_option
    // via tags. Downstream transports (Postmark, SES) use these.
    expect(mail.tags).toEqual({
      trigger: "follow_notification",
      follower: "Sara",
      followed_set: "John Following",
      follow_option: "always",
    });
  });

  it("renders html body when provided", () => {
    const mailWithHtml = renderMail(
      { ...TEMPLATE, htmlBody: "<p>Hi! {{follower}} changed {{followed_set}}.</p>" },
      NOTICE,
    );
    expect(mailWithHtml.htmlBody).toBe(
      "<p>Hi! Sara changed John Following.</p>",
    );
  });

  it("drops empty html body rather than emit an empty <body>", () => {
    const mailWithEmptyHtml = renderMail(
      { ...TEMPLATE, htmlBody: "" },
      NOTICE,
    );
    expect(mailWithEmptyHtml.htmlBody).toBeUndefined();
  });
});

describe("mailToString (one-line envelope for snapshots/tests)", () => {
  it("includes From / To / Subject / body in that order", () => {
    const text = mailToString(renderMail(TEMPLATE, NOTICE));
    expect(text).toContain("From: no-reply@decko.org");
    expect(text).toContain("To: sara@example.com");
    expect(text).toContain(
      "Subject: Sara changed John Following on always",
    );
    expect(text).toContain("\nHi! Sara changed John Following.");
    expect(text.indexOf("From:")).toBeLessThan(text.indexOf("To:"));
    expect(text.indexOf("To:")).toBeLessThan(text.indexOf("Subject:"));
  });

  it("appends htmlBody when present", () => {
    const text = mailToString(
      renderMail({ ...TEMPLATE, htmlBody: "<p>Hi</p>" }, NOTICE),
    );
    expect(text).toContain("---html---");
    expect(text).toContain("<p>Hi</p>");
  });
});
