export const REGISTERED_ROUTE_FORMAT_NAMES: readonly string[] = [
  "css",
  "scss",
  "js",
  "text",
  "txt",
  "csv",
  "xml",
];

export interface RegisteredFormatArm {
  readonly mimeType: string;
  readonly defaultView: string;
  readonly family?: "csv";
}

export const REGISTERED_FORMAT_ARMS: Readonly<Record<string, RegisteredFormatArm>> = {
  css: { mimeType: "text/css", defaultView: "content" },
  scss: { mimeType: "text/x-scss", defaultView: "content" },
  js: { mimeType: "text/javascript", defaultView: "core" },
  text: { mimeType: "text/plain", defaultView: "core" },
  txt: { mimeType: "text/plain", defaultView: "core" },
  csv: { mimeType: "text/comma-separated-values", defaultView: "titled", family: "csv" },
  xml: { mimeType: "text/xml", defaultView: "core" },
};

export function registeredFormatMimeType(format: string, disposition?: string | null): string {
  const arm = REGISTERED_FORMAT_ARMS[format];
  if (arm === undefined) return "text/html";
  if (format === "csv" && disposition === "inline") return "text/plain";
  return arm.mimeType;
}

export function isRegisteredRouteFormat(format: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTERED_FORMAT_ARMS, format);
}

export function splitRegisteredFormatSuffix(
  raw: string,
): { base: string; format: string } | undefined {
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return undefined;
  const format = raw.slice(dot + 1);
  if (!isRegisteredRouteFormat(format)) return undefined;
  return { base: raw.slice(0, dot), format };
}

export function registeredFormatDefaultView(format: string): string {
  return REGISTERED_FORMAT_ARMS[format]?.defaultView ?? "open";
}

export interface RegisteredFormatEngine {
  render(name: string, view: string, params: { format: string; requestUrl?: string }): Promise<string>;
  renderCsvFormat?(name: string): Promise<string>;
}

export interface RegisteredFormatAnswer {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

export async function renderRegisteredFormat(
  engine: RegisteredFormatEngine,
  cardName: string,
  format: string,
  requestedView: string | undefined,
  requestUrl: string | undefined,
  disposition?: string | null,
): Promise<RegisteredFormatAnswer> {
  const arm = REGISTERED_FORMAT_ARMS[format];
  if (arm === undefined) {
    throw new Error(`no registered-format arm for ${format}`);
  }
  const view = requestedView ?? registeredFormatDefaultView(format);
  const body =
    arm.family === "csv" && engine.renderCsvFormat !== undefined
      ? await engine.renderCsvFormat(cardName)
      : await engine.render(cardName, view, {
          format,
          ...(requestUrl !== undefined ? { requestUrl } : {}),
        });
  return {
    status: 200,
    contentType: `${registeredFormatMimeType(format, disposition)}; charset=utf-8`,
    body,
  };
}
