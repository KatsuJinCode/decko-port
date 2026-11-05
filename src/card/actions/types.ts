import type { DeckoName, Nameish } from "../name.js";
import type { CardRecord } from "../fetch/card-record.js";
import type { VisitorSession } from "../session/visitor-session.js";

export interface Actor {
  id: number;
  name: string;
}

export const ANONYMOUS_ACTOR_NAME = "*anonymous";

export type CardActionErrorCode =
  | "anonymous-actor"
  | "permission-denied"
  | "name-conflict"
  | "name-illegal"
  | "rename-conflict"
  | "cycle"
  | "not-found"
  | "type-unknown"
  | "attachment-missing"
  | "protected-card"
  | "conflict"
  | "revert-unsupported"
  | "field-required"
  | "validation-failed"
  | "server-error"
  | "recaptcha"
  | "user-error";

export class CardActionError extends Error {
  readonly code: CardActionErrorCode;
  readonly userMessage?: string;
  readonly errorsByAttribute?: Readonly<Record<string, string>>;
  readonly cardName?: string;

  constructor(
    code: CardActionErrorCode,
    message: string,
    userMessage?: string,
    errorsByAttribute?: Readonly<Record<string, string>>,
    cardName?: string,
  ) {
    super(message);
    this.name = "CardActionError";
    this.code = code;
    if (userMessage !== undefined) this.userMessage = userMessage;
    if (errorsByAttribute !== undefined) this.errorsByAttribute = errorsByAttribute;
    if (cardName !== undefined) this.cardName = cardName;
  }
}

export class ModEventAbortSuccess extends Error {
  constructor() {
    super("action canceled");
    this.name = "ModEventAbortSuccess";
  }
}

export interface TypeSpec {
  typeId?: number;
  typeCode?: string;
  typeName?: Nameish;
}

export interface AttachmentInput {
  bytes: Uint8Array;
  originalFilename: string;
  declaredContentType?: string | null;
  fromCachedUpload?: boolean;
  coded?: { mod?: string };
}

export interface SubcardInput extends TypeSpec {
  content?: string | null;
  attachment?: AttachmentInput;
  actionIdOfCachedUpload?: number | string;
  subcards?: Record<string, SubcardInput>;
  name?: Nameish;
  trash?: boolean;
  history?: boolean;
  passwordEncrypted?: boolean;
  fromEventField?: boolean;
}

export interface CreateCardInput extends TypeSpec {
  name: Nameish;
  content?: string | null;
  attachment?: AttachmentInput;
  subcards?: Record<string, SubcardInput>;
  history?: boolean;
  passwordEncrypted?: boolean;
  codename?: string | null;
  superActionId?: number | null;
  comment?: string;
  commentAuthor?: string;
  commentAuthorSession?: { commentAuthor?: string };
  recaptchaToken?: string;
  actionIdOfCachedUpload?: number | string;
}

export interface UpdateCardInput extends TypeSpec {
  receiver?: "find" | "fetch";
  cardId: number;
  passwordEncrypted?: boolean;
  name?: Nameish;
  content?: string;
  attachment?: AttachmentInput;
  subcards?: Record<string, SubcardInput>;
  superActionId?: number | null;
  comment?: string;
  commentAuthor?: string;
  commentAuthorSession?: { commentAuthor?: string };
  lastActionIdBeforeEdit?: number | string | null;
  trigger?: string | readonly string[];
  draft?: boolean;
  recaptchaToken?: string;
  actionIdOfCachedUpload?: number | string;
  triggeredIntegrate?: () => Promise<void>;
  withinOtherAct?: boolean;
  colorsParams?: Record<string, string>;
  themeColorsParams?: Record<string, string>;
  lookInTrash?: boolean;
  trash?: boolean;
  withinRollback?: boolean;
  skipValidateRenaming?: boolean;
  skip?: string[];
}

export interface RevertActionsInput {
  cardId: number;
  actionIds?: (number | string)[];
  actId?: number | string;
  revertToPrevious?: boolean;
}

export interface DeleteCardInput {
  cardId: number;
  superActionId?: number | null;
  recaptchaToken?: string;
  visitorSession?: VisitorSession;
}

export type ActionRequest =
  | ({ verb: "create" } & CreateCardInput)
  | ({ verb: "update" } & UpdateCardInput)
  | ({ verb: "delete" } & DeleteCardInput);

export interface CardActionSummary {
  cardId: number;
  actionId: number;
  verb: "create" | "update" | "delete";
  name?: DeckoName;
  nameBeforeAct?: DeckoName;
}

export interface ActionResult extends CardActionSummary {
  actId: number;
  subactions: CardActionSummary[];
  actCardActionOmitted?: boolean;
  successAppends?: ReadonlyArray<{ readonly id?: string; readonly view?: string }>;
  signout?: boolean;
}

export type CanWriteHook = (
  card: CardRecord,
  actor: Actor,
) => boolean | Promise<boolean>;
