import type { SQLDatabaseDriver } from "../../src/server/driver.js";

export const DB_CONTENT_FIELD: number;

export interface ParsedLocalIdentifier {
  cardId: number;
  actionId: number;
  ext: string;
}

export function parseLocalIdentifier(content: unknown): ParsedLocalIdentifier | undefined;

export function localIdentifierPath(filesDir: string, parsed: ParsedLocalIdentifier): string;

export interface DeckFilesCopy {
  files: number;
  bytes: number;
  copied: number;
  alreadyPresent: number;
  mismatched: string[];
}

export function copyDeckFiles(opts: { sourceDir: string; targetDir: string }): DeckFilesCopy;

export interface DeckFilesReport {
  status: "ok" | "failed" | "not-migrated";
  referenced: { current: number; history: number };
  present: { current: number; history: number };
  lost: number;
  lostSample: { cardId: number; actionId: number }[];
  absentInSource: { current: number; history: number };
  absentInSourceSample: { kind: "current" | "history"; cardId: number; actionId: number }[];
  copy: DeckFilesCopy | null;
}

export function verifyDeckFiles(opts: {
  driver: SQLDatabaseDriver;
  sourceDir?: string;
  targetDir?: string;
  copy?: DeckFilesCopy;
}): Promise<DeckFilesReport>;
