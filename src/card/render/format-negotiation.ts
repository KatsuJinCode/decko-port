export const REGISTERED_FORMAT_NAMES: readonly string[] = [
  "css",
  "csv",
  "html",
  "js",
  "json",
  "jsonld",
  "rss",
  "scss",
  "text",
  "txt",
  "xml",
  "yaml",
  "yml",
];

export const WILDCARD_ACCEPT = "*/*";

export interface ReadFormatNegotiation {
  readonly formatName: string;
  readonly source: "params" | "accept" | "implicit-html";
  readonly implicitHtml: boolean;
  readonly requestedFormat: string;
}

export interface ReadFormatRequest {
  readonly paramsFormat?: string | null;
  readonly accept?: string | null;
  readonly isAjax?: boolean;
  readonly explicitFile?: boolean;
}

export function registeredFormatMember(requestedFormat: string): boolean {
  return REGISTERED_FORMAT_NAMES.includes(requestedFormat);
}

export function implicitHtml(request: ReadFormatRequest, requestedFormat: string): boolean {
  const ajaxWithoutFormat = request.isAjax === true && !request.paramsFormat;
  return ajaxWithoutFormat || requestedFormat === WILDCARD_ACCEPT;
}

export function negotiateReadFormat(request: ReadFormatRequest): ReadFormatNegotiation {
  const paramsFormat = request.paramsFormat ?? null;
  const fromParams = paramsFormat !== null && paramsFormat !== "";
  const requestedFormat = fromParams
    ? paramsFormat
    : (request.accept ?? "");
  const implicit = implicitHtml(request, requestedFormat);
  if (implicit) {
    return {
      formatName: "file",
      source: "implicit-html",
      implicitHtml: true,
      requestedFormat,
    };
  }
  const isFile = request.explicitFile === true || !registeredFormatMember(requestedFormat);
  const formatName = isFile ? "file" : requestedFormat;
  return {
    formatName,
    source: fromParams ? "params" : "accept",
    implicitHtml: false,
    requestedFormat,
  };
}

export function negotiatedFormatName(
  accept: string | undefined,
): { formatName: string } | Record<string, never> {
  if (accept === undefined) return {};
  const negotiated = negotiateReadFormat({ accept });
  if (negotiated.formatName === "file") return {};
  return { formatName: negotiated.formatName };
}
