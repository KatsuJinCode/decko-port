function opaqueTag(token: string): string | null {
  const match = /^(?:W\/)?"([\s\S]*)"$/.exec(token.trim());
  return match === null ? null : match[1];
}

export function ifNoneMatchSatisfied(request: Request, etag: string | null): boolean {
  if (etag === null) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const header = request.headers.get("if-none-match");
  if (header === null) return false;

  const current = opaqueTag(etag);
  if (current === null) return false;
  for (const token of header.split(",")) {
    const trimmed = token.trim();
    if (trimmed === "*") return true;
    const candidate = opaqueTag(trimmed);
    if (candidate !== null && candidate === current) return true;
  }
  return false;
}

export function notModifiedResponse(headers: Headers): Response {
  return new Response(null, { status: 304, headers });
}