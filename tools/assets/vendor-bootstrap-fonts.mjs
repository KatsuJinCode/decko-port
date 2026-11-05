import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const gem = process.argv[2];
if (!gem || !path.isAbsolute(gem) || path.basename(gem) !== "card-mod-bootstrap-0.20.0") throw new Error("supply the absolute bootstrap0.20.0 gem directory");
const root = new URL("../../vendor/decko-bootstrap-fonts/", import.meta.url);
mkdirSync(root, { recursive: true });
const licenseUrl = "https://raw.githubusercontent.com/twbs/icons/main/LICENSE";
const response = await fetch(licenseUrl);
if (!response.ok) throw new Error(`upstream license HTTP${response.status}`);
const license = Buffer.from(await response.arrayBuffer());
const assets = {}, files = [];
for (const extension of ["woff2", "woff"]) {
  const name = `bootstrap-icons.${extension}`;
  const bytes = readFileSync(path.join(gem, "public/fonts", name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assets[name] = { base64: bytes.toString("base64"), sha256, contentType: `font/${extension}` };
  files.push({ path: `public/fonts/${name}`, bytes: bytes.length, sha256 });
}
writeFileSync(new URL("assets.js", root), `// Exact installed stock gem font bytes; tools/assets/vendor-bootstrap-fonts.mjs.\nexport const assets = ${JSON.stringify(assets)};\n`);
writeFileSync(new URL("assets.d.ts", root), "export const assets: Readonly<Record<string, {base64: string; sha256: string; contentType: string}>>;\n");
writeFileSync(new URL("LICENSE.md", root), license);
writeFileSync(new URL("provenance.json", root), JSON.stringify({ gem: "card-mod-bootstrap", version: "0.20.0", upstream: "https://github.com/twbs/icons", upstreamFontVersion: "not established from gem metadata; exact gem bytes pinned below", licenseUrl, licenseSha256: createHash("sha256").update(license).digest("hex"), files }, null, 2) + "\n");
console.log(JSON.stringify({ files: files.length, bytes: files.reduce((n, file) => n + file.bytes, 0) }));
