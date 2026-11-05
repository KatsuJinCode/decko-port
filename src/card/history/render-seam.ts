import type { HistoryActionRow, HistoryActRow, HistoryChangeRow } from "../mod-loader/mods/card-mod-history.js";
import type { RenderCard } from "../render/format.js";
import type { NewCardOptions } from "../fetch.js";

export interface HistoryRenderParams {
  focalRoot?: boolean;
  accept?: string;
  actId?: string;
  actionId?: string;
  actSeq?: string;
  actionView?: string;
  hideDiff?: string;
  actContext?: string;
  page?: string;

  editorParams?: Readonly<Record<string, string>>;

  viewOpts?: Record<string, unknown>;

  newCard?: NewCardOptions;

  assignedType?: string;

  absentCard?: boolean;

  search?: { vars?: Record<string, string>; offset?: number; term?: string; main?: string };

  format?: string;
  requestUrl?: string;
  compress?: unknown;

  contentOverride?: string;
}

export interface HistoryActionCardInfo {
  cardId: number;
  name: string;
  typeId: number | null;
  typeName: string | undefined;
  renderCard: RenderCard | undefined;
}

export type TypeNameLookup = (typeId: number) => string | undefined;

export interface HistoryRenderReader {
  readonly params: HistoryRenderParams;
  readonly rootCardId: number | undefined;
  readonly currentUserId: number;
  readonly acts: HistoryActRow[];
  readonly actsTotal: number;
  readonly cardLastAct: HistoryActRow | undefined;
  readonly cardLastAction: HistoryActionRow | undefined;
  actById(id: number): HistoryActRow | undefined;
  actionById(id: number): HistoryActionRow | undefined;
  actionsOfAct(actId: number): HistoryActionRow[];
  actionOn(actId: number, cardId: number): HistoryActionRow | undefined;
  actionsAffecting(actId: number, cardId: number): HistoryActionRow[];
  approvedActions(actions: HistoryActionRow[]): HistoryActionRow[];
  actionCard(action: HistoryActionRow): HistoryActionCardInfo | undefined;
  cardInfo(cardId: number): HistoryActionCardInfo | undefined;
  value(action: HistoryActionRow, field: "name" | "type_id" | "db_content" | "content" | "trash"):
    string | number | boolean | null | undefined;
  previousValue(action: HistoryActionRow, field: "name" | "type_id" | "db_content" | "content" | "trash"):
    string | number | boolean | null | undefined;
  typeNameForId(typeId: number): string | undefined;
  readonly rootUpdateAllowed: boolean | undefined;
  readonly changes: Map<number, HistoryChangeRow[]>;
}
