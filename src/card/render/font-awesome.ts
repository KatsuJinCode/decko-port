export const FONT_AWESOME_ASSET_PREFIX = "/mod/bootstrap/fontawesome-6.7.2/";
export const STOCK_FONT_AWESOME_TAG = '<script src="https://kit.fontawesome.com/1366963381.js" crossorigin="anonymous"></script>';

export function fontAwesomeHeadTag(mode?: "local"): string {
  return mode === "local"
    ? `<link href="${FONT_AWESOME_ASSET_PREFIX}css/all.min.css" rel="stylesheet" type="text/css" />`
    : STOCK_FONT_AWESOME_TAG;
}

export function configureFontAwesomeMode(value: string | undefined): "local" | undefined {
  if (value === undefined || value === "stock") return undefined;
  if (value === "local") return "local";
  throw new Error("DECKO_FONT_AWESOME must be local or stock");
}

export function applyFontAwesomeAssetConfiguration(html: string, mode?: "local"): string {
  if (mode !== "local") return html;
  return html.replace(/<!--[\s\S]*?-->|<script\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>/gi, (tag) => {
    if (tag.startsWith("<!--")) return tag;
    const opening = tag.match(/^<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i);
    if (!opening) return tag;
    const attrs = opening[1]!.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g);
    for (const attr of attrs) {
      if (attr[1]!.toLowerCase() === "src") {
        return (attr[2] ?? attr[3] ?? attr[4]) === "https://kit.fontawesome.com/1366963381.js"
          ? fontAwesomeHeadTag("local") : tag;
      }
    }
    return tag;
  });
}
