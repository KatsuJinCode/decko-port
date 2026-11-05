export const NO_REQUEST_ORIGIN = "";

export function envOriginForSurface(_pageSurface: boolean): string {
  if (deckEnvironment?.origin !== undefined) return deckEnvironment.origin;
  return NO_REQUEST_ORIGIN;
}

export interface DeckEnvironment {
  readonly origin?: string;
  readonly defaultHtmlView?: string;
}

let deckEnvironment: DeckEnvironment | undefined;

export function setDeckEnvironment(env: DeckEnvironment | undefined): void {
  deckEnvironment = env;
}

export function pageDefaultHtmlView(): string {
  return deckEnvironment?.defaultHtmlView ?? "content";
}

export function deckDefaultHtmlView(): string | undefined {
  return deckEnvironment?.defaultHtmlView;
}
