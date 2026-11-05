import type { MailMessage, NotifyTransport } from "./types.js";

export class NoopTransport implements NotifyTransport {
  readonly name = "noop";
  async sendMail(_msg: MailMessage): Promise<void> {
  }
}

export interface CapturedMail extends MailMessage {
  readonly seq: number;
  readonly capturedAt: number;
}

export class CaptureTransport implements NotifyTransport {
  readonly name: string;
  private readonly _captured: CapturedMail[] = [];
  private _seq = 0;
  constructor(name: string = "capture") {
    this.name = name;
  }

  async sendMail(msg: MailMessage): Promise<void> {
    this._seq += 1;
    this._captured.push({
      ...msg,
      seq: this._seq,
      capturedAt: Date.now(),
    });
  }

  captured(): readonly CapturedMail[] {
    return this._captured.slice();
  }

  drain(): CapturedMail[] {
    const out = this._captured.slice();
    this._captured.length = 0;
    this._seq = 0;
    return out;
  }

  last(): CapturedMail | undefined {
    return this._captured[this._captured.length - 1];
  }

  count(): number {
    return this._captured.length;
  }
}

export class LoggingTransport implements NotifyTransport {
  readonly name: string;
  private readonly inner: NotifyTransport;
  constructor(inner: NotifyTransport, private readonly log: (line: string) => void = console.log) {
    this.inner = inner;
    this.name = `${inner.name}+log`;
  }

  async sendMail(msg: MailMessage): Promise<void> {
    this.log(`[notify] -> to=${msg.to} subject=${JSON.stringify(msg.subject)} text=${msg.textBody.length}B${msg.htmlBody ? ` html=${msg.htmlBody.length}B` : ""}`);
    await this.inner.sendMail(msg);
  }
}

export const defaultTransport: NotifyTransport = new NoopTransport();
