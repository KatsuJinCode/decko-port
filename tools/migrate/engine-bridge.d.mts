import type { LocalSqliteToolDriver } from "./import.mjs";

export function deriveKeyWithEngine(name: string): string;

export interface EngineSpotResult {
  id: number;
  view: string;
  sha256: string;
  bytes: number;
  contentContained?: boolean;
}

export interface EngineChecksResult {
  junctionEngine: { sampled: number; resolved: number };
  spotRender: {
    sampled: number;
    rendered: number;
    renderErrors: number;
    contentContainedHits: number;
    results: EngineSpotResult[];
  };
  fixtures: {
    source: string;
    cardsPresent: number;
    contentParityHits: number;
    contentParityChecked: number;
    renderedCompared: number;
    renderedMismatched: number;
    matchedFixtureNames: string[];
  };
}

export function engineChecks(ctx: {
  driver: LocalSqliteToolDriver;
  spotCount: number;
  seed: number;
}): Promise<EngineChecksResult>;
