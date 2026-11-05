export interface UpdaterCardInfo {
  readonly cardId: number;
  readonly name: string | undefined;
}

export interface UpdaterRenderReader {
  readonly rootCardId: number | undefined;
  readonly updaters: readonly UpdaterCardInfo[];
}
