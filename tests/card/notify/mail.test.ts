

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

    expect(mail.to).toBe("sara@example.com");
  });

  it("from is the literal from the template", () => {

    expect(mail.from).toBe("no-reply@decko.org");
  });

  it("subject substitutes the resolved inclusions (renderMail models the notice as the resolved set)", () => {

    expect(mail.subject).toBe(
      "Sara changed John Following on always",
    );
  });

  it("text body substitutes the resolved inclusions", () => {

    expect(mail.textBody).toBe("Hi! Sara changed John Following.");
  });

  it("does not emit an htmlBody when the template omits one", () => {
    expect(mail.htmlBody).toBeUndefined();
  });

  it("emits the trigger tag so a transport can route the message", () => {

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
