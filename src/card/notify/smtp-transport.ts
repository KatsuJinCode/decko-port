import * as net from "node:net";
import * as tls from "node:tls";
import type { MailMessage, NotifyTransport } from "./types.js";
import { NoopTransport } from "./transport.js";

export interface SmtpTransportOptions {
  readonly host?: string;
  readonly port?: number;
  readonly heloDomain?: string;
  readonly user?: string;
  readonly pass?: string;
  readonly auth?: "plain" | "login";
  readonly starttls?: "always" | "auto" | false;
  readonly from?: string;
  readonly openTimeoutMs?: number;
  readonly readTimeoutMs?: number;
}

const DEFAULT_HOST = "smtp.mail-synthetic.example";
const DEFAULT_PORT = 587;
const DEFAULT_HELO = "localhost.localdomain";
const DEFAULT_FROM = "no-reply@deck.example";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STARTTLS: "always" | "auto" | false = "auto";

export const RUBY_SMTP_DEFAULTS = {
  address: "localhost",
  port: 25,
  domain: "localhost.localdomain",
  authentication: null,
  enableStarttlsFallback: "auto",
  openTimeoutSec: 5,
  readTimeoutSec: 5,
} as const;

const MAX_ADDRESS_BYTESIZE = 2000;

export class SmtpTransientError extends Error {
  constructor(readonly code: number, readonly replyText: string) {
    super(`SMTP transient error ${code}: ${replyText}`);
    this.name = "SmtpTransientError";
  }
}
export class SmtpPermanentError extends Error {
  constructor(readonly code: number, readonly replyText: string) {
    super(`SMTP permanent error ${code}: ${replyText}`);
    this.name = "SmtpPermanentError";
  }
}
export class SmtpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpProtocolError";
  }
}

interface ParsedAddress {
  readonly name: string | null;
  readonly email: string;
}

function splitAddress(raw: string): ParsedAddress {
  const m = /(.*)<(.*)>/.exec(raw);
  if (m) return { name: m[1]!.trim() || null, email: m[2]!.trim() };
  return { name: null, email: raw.trim() };
}

function validateAddress(kind: "From" | "To", addr: string): string {
  if (addr.length === 0) {
    throw new Error(`SMTP ${kind} address may not be blank`);
  }
  if (/[\r\n]/.test(addr)) {
    throw new Error(`SMTP ${kind} address may not contain CR or LF line breaks`);
  }
  if (Buffer.byteLength(addr, "utf-8") > MAX_ADDRESS_BYTESIZE) {
    throw new Error(`SMTP ${kind} address may not exceed ${MAX_ADDRESS_BYTESIZE} bytes`);
  }
  return addr;
}

function addressSpec(raw: string): string {
  return validateAddress("From", splitAddress(raw).email);
}

function addressList(raw: string): string[] {
  return raw
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece) => validateAddress("To", splitAddress(piece).email));
}

export function resolveFromHeader(
  templateFrom: string | undefined,
  defaultFrom: string | undefined,
): string {
  const conf = templateFrom !== undefined && templateFrom.trim().length > 0
    ? splitAddress(templateFrom)
    : null;
  const actual = defaultFrom !== undefined && defaultFrom.trim().length > 0
    ? addressSpec(defaultFrom)
    : (conf?.email ?? "");
  if (actual.length === 0) {
    throw new Error(
      "SMTP From address may not be blank: set DECKO_SMTP_FROM (or message.from)",
    );
  }
  const confText = conf?.name ?? conf?.email ?? null;
  if (confText !== null && confText !== actual) {
    return `"${confText}" <${actual}>`;
  }
  return actual;
}

export function qpEncode(text: string): string {
  const lines = text.split(/\r\n|\r|\n/);
  const outLines: string[] = [];
  for (const line of lines) {
    const bytes = new TextEncoder().encode(line);
    let current = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      const isLast = i === bytes.length - 1;
      let tok: string;
      if (b === 0x3d) tok = "=3D";
      else if (b === 0x20) tok = isLast ? "=20" : " ";
      else if (b === 0x09) tok = isLast ? "=09" : "\t";
      else if (b >= 0x21 && b <= 0x7e) tok = String.fromCharCode(b);
      else tok = "=" + b.toString(16).toUpperCase().padStart(2, "0");
      if (current.length + tok.length > 75) {
        outLines.push(current + "=");
        current = "";
      }
      current += tok;
    }
    outLines.push(current);
  }
  return outLines.join("\r\n");
}

export function qEncodeWord(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const words: string[] = [];
  let payload = "";
  const pushWord = () => {
    words.push(`=?utf-8?q?${payload}?=`);
    payload = "";
  };
  for (const b of bytes) {
    let tok: string;
    if (b === 0x20) tok = "_";
    else if (b === 0x3d || b === 0x3f || b === 0x5f) {
      tok = "=" + b.toString(16).toUpperCase().padStart(2, "0");
    } else if (b >= 0x21 && b <= 0x7e) tok = String.fromCharCode(b);
    else tok = "=" + b.toString(16).toUpperCase().padStart(2, "0");
    if (payload.length + tok.length > 63) pushWord();
    payload += tok;
  }
  pushWord();
  return words.join("\r\n ");
}

function subjectHeader(subject: string): string {
  if (/^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/.test(subject) && subject.length <= 78) {
    return subject;
  }
  return qEncodeWord(subject);
}

function messageIdHeader(envelopeFrom: string): string {
  const domain = envelopeFrom.includes("@") ? envelopeFrom.slice(envelopeFrom.indexOf("@") + 1) : "localhost";
  const rand = Math.random().toString(16).slice(2, 10);
  const stamp = Date.now().toString(36);
  return `<${stamp}.${rand}@${domain}>`;
}

function rfc5322Date(now: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[now.getUTCDay()]}, ${p(now.getUTCDate())} ${months[now.getUTCMonth()]} ` +
    `${now.getUTCFullYear()} ${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())} +0000`
  );
}

export function buildMime(msg: MailMessage, fromHeader: string, now: Date = new Date()): string {
  const envelopeFrom = addressSpec(fromHeader);
  const headers: string[] = [
    `Date: ${rfc5322Date(now)}`,
    `From: ${fromHeader}`,
    ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []),
    `To: ${msg.to}`,
    ...(msg.cc ? [`Cc: ${msg.cc}`] : []),
    `Message-ID: ${messageIdHeader(envelopeFrom)}`,
    `Subject: ${subjectHeader(msg.subject)}`,
    "MIME-Version: 1.0",
  ];

  if (msg.htmlBody === undefined) {
    headers.push("Content-Type: text/plain; charset=utf-8");
    headers.push("Content-Transfer-Encoding: quoted-printable");
    return `${headers.join("\r\n")}\r\n\r\n${qpEncode(msg.textBody)}\r\n`;
  }

  const boundary = `deckomail-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  headers.push("Content-Transfer-Encoding: 7bit");
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: quoted-printable\r\n\r\n${qpEncode(body)}\r\n`;
  return (
    `${headers.join("\r\n")}\r\n\r\n` +
    `This is a multi-part message in MIME format.\r\n` +
    part("text/plain", msg.textBody) +
    part("text/html", msg.htmlBody) +
    `--${boundary}--\r\n`
  );
}

interface SmtpReply {
  readonly code: number;
  readonly lines: readonly string[];
}

function isTransient(code: number): boolean {
  return code >= 400 && code < 500;
}

export class SmtpTransport implements NotifyTransport {
  readonly name = "smtp";
  private readonly host: string;
  private readonly port: number;
  private readonly heloDomain: string;
  private readonly user: string | undefined;
  private readonly pass: string | undefined;
  private readonly auth: "plain" | "login";
  private readonly starttls: "always" | "auto" | false;
  private readonly from: string | undefined;
  private readonly openTimeoutMs: number;
  private readonly readTimeoutMs: number;

  constructor(opts: SmtpTransportOptions = {}) {
    this.host = opts.host ?? DEFAULT_HOST;
    this.port = opts.port ?? DEFAULT_PORT;
    this.heloDomain = opts.heloDomain ?? DEFAULT_HELO;
    this.user = opts.user;
    this.pass = opts.pass;
    this.auth = opts.auth ?? "plain";
    this.starttls = opts.starttls ?? DEFAULT_STARTTLS;
    this.from = opts.from ?? DEFAULT_FROM;
    this.openTimeoutMs = opts.openTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.readTimeoutMs = opts.readTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  describe(): string {
    return (
      `smtp host=${this.host} port=${this.port} user=${this.user ?? "-"}` +
      ` auth=${this.auth} starttls=${String(this.starttls)} from=${this.from ?? "-"}`
    );
  }

  async sendMail(msg: MailMessage): Promise<void> {
    const fromHeader = resolveFromHeader(msg.from, this.from);
    const envelopeFrom = addressSpec(fromHeader);
    const envelopeTo = [
      ...addressList(msg.to),
      ...(msg.cc ? addressList(msg.cc) : []),
      ...(msg.bcc ? addressList(msg.bcc) : []),
    ];
    const mime = buildMime(msg, fromHeader);
    await this.deliver(envelopeFrom, envelopeTo, mime);
  }

  private async deliver(envelopeFrom: string, envelopeTo: string[], mime: string): Promise<void> {
    const socket = await this.connect();
    try {
      const readReply = this.makeReplyReader(socket);
      const command = this.makeCommandRunner(socket, readReply);

      await readReply();
      let caps = this.makeCapabilities(await command(`EHLO ${this.heloDomain}`, [250]));

      if (this.starttls !== false) {
        if (caps.has("STARTTLS")) {
          await command("STARTTLS", [220]);
          const tlsSocket = await this.upgradeTls(socket);
          const tlsRead = this.makeReplyReader(tlsSocket);
          const tlsCommand = this.makeCommandRunner(tlsSocket, tlsRead);
          caps = this.makeCapabilities(await tlsCommand(`EHLO ${this.heloDomain}`, [250]));
          await this.authenticate(tlsCommand);
          await this.envelopeAndData(tlsCommand, envelopeFrom, envelopeTo, mime);
          await tlsCommand("QUIT", [221]);
          tlsSocket.end();
          return;
        }
        if (this.starttls === "always") {
          socket.destroy();
          throw new SmtpProtocolError(
            `starttls=always but ${this.host}:${this.port} does not advertise STARTTLS — refusing plaintext`,
          );
        }
      }

      await this.authenticate(command);
      await this.envelopeAndData(command, envelopeFrom, envelopeTo, mime);
      await command("QUIT", [221]);
      socket.end();
    } catch (err) {
      socket.destroy();
      throw err;
    }
  }

  private async connect(): Promise<net.Socket> {
    return await new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new SmtpProtocolError(`connect timeout after ${this.openTimeoutMs}ms to ${this.host}:${this.port}`));
      }, this.openTimeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.setTimeout(this.readTimeoutMs, () => {
          socket.destroy(new SmtpProtocolError(`read timeout after ${this.readTimeoutMs}ms on ${this.host}:${this.port}`));
        });
        resolve(socket);
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(new SmtpProtocolError(`connection to ${this.host}:${this.port} failed: ${err.message}`));
      });
    });
  }

  private async upgradeTls(plain: net.Socket): Promise<tls.TLSSocket> {
    return await new Promise<tls.TLSSocket>((resolve, reject) => {
      const secure = tls.connect({
        socket: plain,
        servername: this.host,
        rejectUnauthorized: true,
      });
      const timer = setTimeout(() => {
        secure.destroy();
        reject(new SmtpProtocolError(`TLS upgrade timeout with ${this.host}`));
      }, this.openTimeoutMs);
      secure.once("secureConnect", () => {
        clearTimeout(timer);
        secure.setTimeout(this.readTimeoutMs, () => {
          secure.destroy(new SmtpProtocolError(`read timeout after TLS on ${this.host}`));
        });
        resolve(secure);
      });
      secure.once("error", (err) => {
        clearTimeout(timer);
        reject(new SmtpProtocolError(`TLS upgrade with ${this.host} failed: ${err.message}`));
      });
    });
  }

  private makeReplyReader(socket: net.Socket): () => Promise<SmtpReply> {
    let buffer = "";
    let waiter: { resolve: (r: SmtpReply) => void; reject: (e: Error) => void } | null = null;
    const settle = () => {
      if (waiter === null) return;
      const idx = buffer.indexOf("\r\n");
      if (idx === -1) return;
      const lines: string[] = [];
      let code = 0;
      for (;;) {
        const nl = buffer.indexOf("\r\n");
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        lines.push(line);
        const m = /^(\d{3})([ -])(.*)$/.exec(line);
        if (m === null) {
          const w = waiter; waiter = null;
          w.reject(new SmtpProtocolError(`unparseable SMTP reply line: ${JSON.stringify(line)}`));
          return;
        }
        code = Number(m[1]);
        if (m[2] === " ") break;
      }
      const w = waiter; waiter = null;
      w.resolve({ code, lines });
    };
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      settle();
    });
    socket.on("error", (err) => {
      if (waiter) { const w = waiter; waiter = null; w.reject(err); }
    });
    socket.on("close", () => {
      if (waiter) { const w = waiter; waiter = null; w.reject(new SmtpProtocolError("connection closed by peer mid-reply")); }
    });
    return () => new Promise<SmtpReply>((resolve, reject) => {
      waiter = { resolve, reject };
      settle();
    });
  }

  private makeCommandRunner(
    socket: net.Socket,
    readReply: () => Promise<SmtpReply>,
  ): (cmd: string, expect: number[]) => Promise<SmtpReply> {
    return async (cmd, expect) => {
      socket.write(cmd + "\r\n");
      const reply = await readReply();
      if (!expect.includes(reply.code)) {
        if (isTransient(reply.code)) throw new SmtpTransientError(reply.code, reply.lines.join(" | "));
        if (reply.code >= 500 && reply.code < 600) throw new SmtpPermanentError(reply.code, reply.lines.join(" | "));
        throw new SmtpProtocolError(
          `unexpected reply ${reply.code} to ${cmd.split(" ")[0]} (wanted ${expect.join("/")}): ${reply.lines.join(" | ")}`,
        );
      }
      return reply;
    };
  }

  private makeCapabilities(reply: SmtpReply): Set<string> {
    const caps = new Set<string>();
    for (const line of reply.lines.slice(1)) caps.add(line.split(" ")[0]!.toUpperCase());
    return caps;
  }

  private async authenticate(
    command: (cmd: string, expect: number[]) => Promise<SmtpReply>,
  ): Promise<void> {
    if (!this.user || !this.pass) return;
    if (this.auth === "plain") {
      const initial = Buffer.from(`\u0000${this.user}\u0000${this.pass}`, "utf-8").toString("base64");
      await command(`AUTH PLAIN ${initial}`, [235]);
      return;
    }
    await command("AUTH LOGIN", [334]);
    await command(Buffer.from(this.user, "utf-8").toString("base64"), [334]);
    await command(Buffer.from(this.pass, "utf-8").toString("base64"), [235]);
  }

  private async envelopeAndData(
    command: (cmd: string, expect: number[]) => Promise<SmtpReply>,
    envelopeFrom: string,
    envelopeTo: string[],
    mime: string,
  ): Promise<void> {
    await command(`MAIL FROM:<${envelopeFrom}>`, [250]);
    for (const rcpt of envelopeTo) {
      await command(`RCPT TO:<${rcpt}>`, [250, 251, 252]);
    }
    await command("DATA", [354]);
    const stuffed = mime
      .split("\r\n")
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    await command(`${stuffed}\r\n.`, [250]);
  }
}

export function smtpOptionsFromEnv(env: NodeJS.ProcessEnv): SmtpTransportOptions {
  return {
    host: env.DECKO_SMTP_HOST,
    port: env.DECKO_SMTP_PORT !== undefined ? Number(env.DECKO_SMTP_PORT) : undefined,
    user: env.DECKO_SMTP_USER,
    pass: env.DECKO_SMTP_PASS,
    from: env.DECKO_SMTP_FROM,
  };
}

export function transportFromEnv(env: NodeJS.ProcessEnv = process.env): NotifyTransport {
  const pass = env.DECKO_SMTP_PASS;
  if (pass === undefined || pass.length === 0) return new NoopTransport();
  if (env.DECKO_SMTP_USER === undefined || env.DECKO_SMTP_USER.length === 0) {
    throw new Error(
      "DECKO_SMTP_PASS is set but DECKO_SMTP_USER is missing — refusing to start with half-configured mail (set DECKO_SMTP_USER to the token's mailbox address)",
    );
  }
  const opts = smtpOptionsFromEnv(env);
  return new SmtpTransport(opts);
}
