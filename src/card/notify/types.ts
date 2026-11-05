import type { CardRecord } from "../fetch/card-record.js";
import type { Actor } from "../actions/types.js";

export interface NotifyCardRef {
  readonly id: number | null;
  readonly name: string | null;
  readonly leftName: string | null;
  readonly rightName: string | null;
  readonly type: string | null;
  readonly content: string | null;
  readonly trashed: boolean;
}

export interface NotifyActor {
  readonly id: number;
  readonly name: string;
  readonly email: string | null;
}

export interface SavePathEvent {
  readonly card: NotifyCardRef | null;
  readonly verb: "create" | "update" | "delete";
  readonly actId: number;
  readonly actionId: number;
  readonly actor: NotifyActor;
  readonly silent?: boolean;
  readonly isDeletePath?: boolean;
}

export interface SavePathAct {
  readonly actId: number;
  readonly actor: NotifyActor;
  readonly silent: boolean;
  readonly events: readonly SavePathEvent[];
  readonly actCardName?: string | null;
}

export interface SavePathIntegrationHook {
  readonly stage: "integrate" | "integrate_with_delay";
  readonly notable: (event: SavePathEvent) => boolean;
  fire(event: SavePathEvent, ctx: NotifyContext): Promise<void>;
  readonly fireAct?: (act: SavePathAct, ctx: NotifyContext) => Promise<void>;
  readonly name?: string;
  readonly event?: string;
  readonly priority?: number;
}

export interface NotifyContext {
  readonly transport: NotifyTransport;
  readonly logger?: (line: string) => void;
}

export interface NotifyTransport {
  sendMail(msg: MailMessage): Promise<void>;
  readonly name: string;
}

export interface MailMessage {
  readonly to: string;
  readonly from: string;
  readonly replyTo?: string;
  readonly cc?: string;
  readonly bcc?: string;
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody?: string;
  readonly tags?: Readonly<Record<string, string>>;
}

export type { CardRecord };
export type { Actor };
