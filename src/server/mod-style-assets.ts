import { ASSET_PREFIX, assets } from "../../vendor/decko-mod-style-images/assets.js";
import { ifNoneMatchSatisfied, notModifiedResponse } from "./conditional-asset-request.js";

export function serveModStyleAsset(request: Request): Response | undefined {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(ASSET_PREFIX)) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const key = pathname.slice(ASSET_PREFIX.length);
  const asset = Object.hasOwn(assets, key) ? assets[key] : undefined;
  if (!asset) return new Response(null, { status: 404 });
  const headers = new Headers({
    "content-type": asset.contentType,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    etag: `"${asset.sha256}"`,
  });
  if (ifNoneMatchSatisfied(request, headers.get("etag"))) return notModifiedResponse(headers);
  const bytes = Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0));
  headers.set("content-length", String(bytes.byteLength));
  return new Response(request.method === "HEAD" ? null : bytes, { headers });
}
