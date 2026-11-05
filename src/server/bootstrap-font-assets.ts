import { assets } from "../../vendor/decko-bootstrap-fonts/assets.js";
import {serveMaterialIconsAsset} from './material-icons-assets.js';
import { ifNoneMatchSatisfied, notModifiedResponse } from "./conditional-asset-request.js";

export function serveBootstrapFontAsset(request: Request): Response | undefined {
  const material=serveMaterialIconsAsset(request);
  if(material)return material;
  const prefix = "/mod/bootstrap/fonts/";
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(prefix)) return undefined;
  const name = pathname.slice(prefix.length);
  if (!Object.hasOwn(assets, name)) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const asset = assets[name]!;
  const headers = new Headers({
    "content-type": asset.contentType,
    "x-content-type-options": "nosniff",
    "cache-control": "public, max-age=31536000, immutable",
    etag: `"${asset.sha256}"`,
  });
  if (ifNoneMatchSatisfied(request, headers.get("etag"))) return notModifiedResponse(headers);
  const bytes = Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0));
  headers.set("content-length", String(bytes.length));
  return new Response(request.method === "HEAD" ? null : bytes, { headers });
}
