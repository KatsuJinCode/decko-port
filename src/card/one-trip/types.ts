import type { CardsRow } from "../../server/schema.js";
import type { RenderPlan } from "./render-plan.js";

export type OneTripEdgeKind = "include" | "link" | "side" | "type" | "anchor" | "item";

export interface OneTripEdge {
  refererId: number;
  refereeKey: string;
  refereeId: number | null;
  kind: OneTripEdgeKind;
  refView?: string;
}

export interface OneTripClosureRow {
  pageId: number;
  cardId: number;
  depth: number;
  views: string[];
}

export interface OneTripSearchNest {
  searchCardId: number;
  cqlText: string;
}

export interface OneTripRuleCandidate {
  cardId: number;
  settingCode: string;
  candidateKey: string;
  candidateId: number | null;
}

export interface EdgeDeriver {
  referenceEdges(content: string, referencingCardName: string): { key: string; view?: string }[];
  linkEdges(content: string, referencingCardName: string): { key: string }[];
}

export interface RuleCandidateEnumerator {
  candidatesForCard(cardName: string): { settingCode: string; candidateKeys: string[] }[];
}

export interface OneTripBuildReport {
  liveCards: number;
  composedNames: number;
  edges: number;
  danglingEdges: number;
  searchNests: number;
  pages: Record<string, { pageId: number; closureSize: number }>;
  edgeAgreement: {
    storedInclusionRows: number;
    parsedEdges: number;
    parsedNotStored: number;
    storedNotParsed: number;
  };
}

export interface PageBundle {
  pageKey: string;
  pageId: number;
  rows: CardsRow[];
  cardIds: number[];
  ruleCandidates: OneTripRuleCandidate[];
  searchResults: { searchCardId: number; position: number; cardId: number }[];
  renderPlan?: RenderPlan;
}
