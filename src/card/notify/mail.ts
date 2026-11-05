import type { MailMessage } from "./types.js";

export interface EmailTemplate {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody?: string;
}

export interface FollowNotice {
  readonly follower: string;
  readonly followedSet: string;
  readonly followOption: string;
}

export interface FollowNoticeAct {
  readonly userName: string;
  readonly verb: string;
  readonly cardName: string;
}

export function interpolateTemplate(
  template: string,
  vars: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+(?:\|[a-zA-Z_]+)?)\s*\}\}/g, (_whole, key: string) => {
    const value = vars[key];
    return value !== undefined ? value : key.split("|")[0];
  });
}

export interface StockMailExtras {
  readonly text?: Readonly<Record<string, string>>;
  readonly html?: Readonly<Record<string, string>>;
  readonly botAccountEmail?: string;
  readonly wrapHtmlDocument?: boolean;
}

const EMAIL_DOCUMENT_HEAD =
  '<!DOCTYPE html>\n<html>\n  <head>\n    <meta http-equiv="Content-type" content="text/html;charset=UTF-8"/>\n    <style></style>\n  </head>\n  <body class="d0-email-body">\n    ';
const EMAIL_DOCUMENT_TAIL = "\n  </body>\n</html>\n";

export function addressOf(from: string): string {
  const m = /<([^>]*)>\s*$/.exec(from);
  return (m !== null ? m[1] : from).trim();
}

export function resolveFromAddress(
  templateFrom: string | undefined,
  opts: { deckoBotEmail: string; defaultFrom?: string },
): string {
  const raw = templateFrom?.trim() ?? "";
  let confName: string | undefined;
  let confEmail: string | undefined;
  const bracket = /^([^<]*)<([^>]*)>$/.exec(raw);
  if (bracket !== null) {
    confName = bracket[1].trim() === "" ? undefined : bracket[1].trim();
    confEmail = bracket[2].trim();
  } else if (raw !== "" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    confEmail = raw;
  } else if (raw !== "") {
    confEmail = opts.deckoBotEmail;
  }
  const actual = opts.defaultFrom !== undefined && opts.defaultFrom !== "" ? opts.defaultFrom : (confEmail ?? opts.deckoBotEmail);
  const confText = confName ?? confEmail;
  if (confText !== undefined && confText !== actual) {
    return `"${confText}" <${actual}>`;
  }
  return actual;
}

export function defaultsFromConfig(
  emailDefaults?: Readonly<Record<string, string | undefined>> | null,
): Record<string, string | undefined> {
  const defaults: Record<string, string | undefined> = { ...(emailDefaults ?? {}) };
  if (defaults.from !== undefined) defaults.return_path ??= defaults.from;
  defaults.charset ??= "utf-8";
  return defaults;
}

export function renderMail(
  template: EmailTemplate,
  notice: FollowNotice,
  act?: FollowNoticeAct,
  extras?: StockMailExtras,
): MailMessage {
  const baseVars: Record<string, string> = {
    follower: notice.follower,
    followed_set: notice.followedSet,
    follow_option: notice.followOption,
  };
  if (act !== undefined) {
    baseVars["_|name"] = act.cardName;
    baseVars["_|last_action_verb"] = act.verb;
    baseVars["_user|name"] = act.userName;
  }
  const subject = interpolateTemplate(
    template.subject,
    { ...baseVars, ...(extras?.text ?? {}) },
  );
  const textBody = interpolateTemplate(
    template.textBody ?? "",
    { ...baseVars, ...(extras?.text ?? {}) },
  );
  const htmlBody =
    template.htmlBody === undefined
      ? undefined
      : interpolateTemplate(template.htmlBody, { ...baseVars, ...(extras?.html ?? {}) });
  const wrappedHtml =
    htmlBody !== undefined && extras?.wrapHtmlDocument === true
      ? EMAIL_DOCUMENT_HEAD + htmlBody + EMAIL_DOCUMENT_TAIL
      : htmlBody;
  const from =
    extras?.botAccountEmail !== undefined
      ? resolveFromAddress(template.from, { deckoBotEmail: extras.botAccountEmail })
      : template.from;

  const replyTo = extras?.botAccountEmail !== undefined ? addressOf(from) : undefined;
  return {
    to: template.to,
    from,
    ...(replyTo !== undefined ? { replyTo } : {}),
    subject,
    textBody,
    ...(wrappedHtml !== undefined && wrappedHtml.length > 0 ? { htmlBody: wrappedHtml } : {}),
    tags: {
      trigger: "follow_notification",
      follower: notice.follower,
      followed_set: notice.followedSet,
      follow_option: notice.followOption,
    },
  };
}

export function mailToString(msg: MailMessage): string {
  const headers = [
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    msg.cc ? `Cc: ${msg.cc}` : null,
    msg.bcc ? `Bcc: ${msg.bcc}` : null,
    `Subject: ${msg.subject}`,
  ].filter((l): l is string => l !== null);
  const body = msg.textBody;
  const html = msg.htmlBody ? `\n---html---\n${msg.htmlBody}` : "";
  return `${headers.join("\n")}\n\n${body}${html}`;
}
