import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const gem = process.argv[2];
if (!gem || !path.isAbsolute(gem) || path.basename(gem) !== "card-mod-style-0.20.0") {
  throw new Error("supply the absolute card-mod-style-0.20.0 gem directory");
}
const sourceDir = path.join(gem, "public", "jquery-ui-smoothness");
const names = readdirSync(sourceDir).filter((name) => name.endsWith(".png")).sort();
if (names.length === 0) throw new Error(`no PNGs under ${sourceDir}`);
const assets = {};
const files = [];
for (const name of names) {
  const bytes = readFileSync(path.join(sourceDir, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assets[name] = { base64: bytes.toString("base64"), sha256, contentType: "image/png" };
  files.push({ path: `public/jquery-ui-smoothness/${name}`, bytes: bytes.length, sha256 });
}
const root = new URL("../../vendor/decko-mod-style-images/", import.meta.url);
mkdirSync(root, { recursive: true });
const prefix = "/mod/style/jquery-ui-smoothness/";
const provenance = {
  gem: "card-mod-style",
  version: "0.20.0",
  surface: "the mod public-files surface (/mod/style/jquery-ui-smoothness/)",
  license: "MIT (stated in the vendored theme file header: Copyright jQuery Foundation and other contributors; Licensed MIT)",
  licenseSource: "assets/style/jquery_ui_smoothness.css file header in the same gem; the grant is quoted in the vendored copy at fixtures/vendor/mod-style-assets/card-mod-style/assets/style/jquery_ui_smoothness.css",
  files,
};
writeFileSync(
  new URL("assets.js", root),
  `// Exact installed stock gem image bytes; tools/assets/vendor-mod-style-images.mjs.\nexport const ASSET_PREFIX = ${JSON.stringify(prefix)};\nexport const assets = ${JSON.stringify(assets)};\n`,
);
writeFileSync(
  new URL("assets.d.ts", root),
  "export const ASSET_PREFIX: string;\nexport const assets: Readonly<Record<string, {base64: string; sha256: string; contentType: string}>>;\n",
);
writeFileSync(new URL("provenance.json", root), JSON.stringify(provenance, null, 2) + "\n");
writeFileSync(
  new URL("PROVENANCE.md", root),
  `# Stock jQuery UI smoothness theme images

Exact PNG bytes shipped in card-mod-style-0.20.0 public/jquery-ui-smoothness,
the files the gem's own stylesheet assets/style/jquery_ui_smoothness.css
references through url([[/mod/style/jquery-ui-smoothness/...]]) chunks once
the css format renders them. The original deployment serves them from the mod
public-files surface (the deck's public/mod/style/ tree, a copy of the gem's
public/ directory, served before the router sees the request); a stock
Decko 0.20.0 install carries the same 11 files with the same SHA-256 hashes
in its public/mod/style/jquery-ui-smoothness/ directory.

The gem has no separate license file for these images: the MIT grant is the
theme file's own header (provenance.json records that file as licenseSource).
Recreate with
\`node tools/assets/vendor-mod-style-images.mjs <absolute-card-mod-style-0.20.0-directory>\`.
`,
);
console.log(JSON.stringify({ files: files.length, bytes: files.reduce((n, file) => n + file.bytes, 0) }));
