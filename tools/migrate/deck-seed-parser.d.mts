export interface DeckSeedRow {
  table: string;
  columns: string[] | undefined;
  values: unknown[];
}

export interface DeckSeedRowsOptions {
  tables?: readonly string[];
}

export function decodeLiteral(raw: string): string;

export function deckSeedRows(
  path: string,
  opts?: DeckSeedRowsOptions,
): AsyncGenerator<DeckSeedRow, void, void>;
