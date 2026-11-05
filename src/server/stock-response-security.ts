import { ORACLE_SECURITY_RESPONSE_HEADERS } from './oracle-security-response-headers.js';
export const STOCK_RESPONSE_SECURITY_HEADERS = ORACLE_SECURITY_RESPONSE_HEADERS;

export function withStockResponseSecurity(response: Response): Response {
  if (response.status < 200) return response;
  const headers = new Headers(response.headers);
  let changed = false;
  for (const [name, value] of Object.entries(STOCK_RESPONSE_SECURITY_HEADERS)) {
    if (headers.has(name)) continue;
    headers.set(name, value);
    changed = true;
  }
  return changed ? new Response(response.body, {
    status: response.status, statusText: response.statusText, headers,
  }) : response;
}
