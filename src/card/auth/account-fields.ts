import { sha1Hex } from "./signin.js";

const PASSWORD_REGEX: Record<string, RegExp> = {
  lower: /[a-z]/,
  upper: /[A-Z]/,
  special_char: /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/,
  number: /\d+/,
  letter: /[a-zA-Z]/,
};

const PASSWORD_REQUIREMENTS = ["lower", "upper", "special_char", "number"] as const;
const PASSWORD_LENGTH = 8;

const REQUIREMENT_LABEL: Record<string, string> = {
  lower: "a lower case letter",
  upper: "an upper case letter",
  special_char: "a special character (like !@$%&#)",
  number: "a number",
  letter: "a letter",
};

const EMAIL_REGEX = /^([^@\s]+)@((?:[-a-z0-9]+\.)+[a-z]{2,})$/i;

export function passwordErrors(password: string): string[] {
  const out: string[] = [];
  if (password.length < PASSWORD_LENGTH) out.push(`must be ${PASSWORD_LENGTH} characters or longer`);
  const missing = PASSWORD_REQUIREMENTS.filter((r) => !PASSWORD_REGEX[r].test(password)).map((r) => REQUIREMENT_LABEL[r]);
  if (missing.length > 0) {
    const text = missing.length > 2
      ? `${missing.slice(0, -1).join(", ")}, and ${missing[missing.length - 1]}`
      : missing.join(" and ");
    out.push(`must contain ${text}`);
  }
  return out;
}

export function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}

export function emailIsValid(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function encryptPassword(password: string, salt: string): Promise<string> {
  return sha1Hex(`${salt}--${password}--`);
}

function rubyUtcTime(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function generateSalt(now: Date): Promise<string> {
  return sha1Hex(`--${rubyUtcTime(now)}--`);
}

export interface AccountFieldWrite {
  readonly key: string;
  readonly content: string;
  readonly history: boolean;
}

export interface AccountFieldInput {
  readonly fields: Record<string, { content?: string | null }>;
  readonly holderIsSignup: boolean;
  readonly canApprove: boolean;
  readonly emailTaken: (email: string) => Promise<boolean>;
  readonly now: Date;
}

export interface AccountFieldPlan {
  readonly errors: string[];
  readonly writes: AccountFieldWrite[];
  readonly status: string;
  readonly requestVerification: boolean;
}

function holderError(fieldKey: string, attribute: string | null, message: string): string {
  const inner = attribute === null ? message : `${attribute} ${message}`;
  return `+*ACCOUNT: ${fieldKey} ${inner}`;
}

export async function planAccountFields(input: AccountFieldInput): Promise<AccountFieldPlan> {
  const errors: string[] = [];
  const writes: AccountFieldWrite[] = [];
  const emailRaw = input.fields["+*email"]?.content ?? undefined;
  const passwordRaw = input.fields["+*password"]?.content ?? undefined;

  if (emailRaw === undefined) errors.push("+*ACCOUNT: email required");

  let email: string | undefined;
  if (emailRaw !== undefined) {
    email = normalizeEmail(emailRaw);
    if (email !== "") {
      if (!emailIsValid(email)) errors.push(holderError("+*email", null, "must be valid address"));
      else if (await input.emailTaken(email)) errors.push(holderError("+*email", null, "must be unique"));
    }
  }
  if (passwordRaw !== undefined) {
    for (const m of passwordErrors(passwordRaw)) errors.push(holderError("+*password", "password", m));
  }

  const status = input.holderIsSignup ? (input.canApprove ? "unverified" : "unapproved") : "active";
  if (errors.length > 0) return { errors, writes, status, requestVerification: false };

  const salt = await generateSalt(input.now);
  if (email !== undefined) writes.push({ key: "+*email", content: email, history: true });
  if (passwordRaw !== undefined) {
    writes.push({ key: "+*password", content: await encryptPassword(passwordRaw, salt), history: false });
  }
  writes.push({ key: "+*salt", content: salt, history: false });
  writes.push({ key: "+*status", content: status, history: true });
  return { errors, writes, status, requestVerification: input.holderIsSignup && input.canApprove };
}
