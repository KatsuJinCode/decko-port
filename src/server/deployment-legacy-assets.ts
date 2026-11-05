import {Parser} from "htmlparser2";
import {staticUglifyHarmonyStringLiteralRanges} from "../card/assets/uglify-harmony-static.js";

export interface DeploymentLegacyAssets {
  readonly version: 1;
  readonly assetOrigin: string;
  readonly stylesheetPath?: string;
  readonly scriptPath?: string;
  readonly footerSlotId?: string;
  readonly revisions: Readonly<Record<string, string>>;
}

export class DeploymentLegacyAssetsError extends Error {
  constructor(field: string) {super(`InvalidDeploymentLegacyAssets:${field}`); this.name = "DeploymentLegacyAssetsError";}
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"
  && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const JAVASCRIPT_SCRIPT_TYPES = new Set([
  "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript",
  "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2",
  "text/javascript1.3", "text/javascript1.4", "text/javascript1.5", "text/jscript", "text/livescript",
  "text/x-ecmascript", "text/x-javascript",
]);
function executableScript(attributes: Record<string, string>): boolean {
  const hasType = Object.hasOwn(attributes, "type"), language = attributes.language;
  const value = hasType ? attributes.type! : language ? `text/${language}` : "text/javascript";
  if (value === "" || JAVASCRIPT_SCRIPT_TYPES.has(value.toLowerCase())) return true;
  if (hasType && JAVASCRIPT_SCRIPT_TYPES.has(value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "").toLowerCase())) return true;
  return value.toLowerCase() === "module";
}

function executableScriptStartTag(startTag: string): boolean {
  let attributes: Record<string, string> | undefined;
  new Parser({onopentag(name, values) {
    if (name === "script" && attributes === undefined) attributes = values;
  }}, {decodeEntities: true}).end(startTag);
  return attributes !== undefined && executableScript(attributes);
}

function assetPath(value: unknown, field: string, extension?: "css" | "js"): string {
  if (typeof value !== "string" || /\s/.test(value)
    || !/^[1-9][0-9]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(css|js)$/.test(value)
    || (extension !== undefined && !value.endsWith(`.${extension}`))) throw new DeploymentLegacyAssetsError(field);
  return value;
}

function slotId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{20}$/.test(value)) throw new DeploymentLegacyAssetsError(field);
  return value;
}

export function validateDeploymentLegacyAssets(value: unknown): DeploymentLegacyAssets | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || Object.getOwnPropertySymbols(value).length || value.version !== 1
    || Object.keys(value).some(key => !["version", "assetOrigin", "stylesheetPath", "scriptPath", "footerSlotId", "revisions"].includes(key))) {
    throw new DeploymentLegacyAssetsError("record");
  }
  if (typeof value.assetOrigin !== "string" || /["'<>\\\s]/.test(value.assetOrigin)) throw new DeploymentLegacyAssetsError("assetOrigin");
  let url: URL;
  try {url = new URL(value.assetOrigin);} catch {throw new DeploymentLegacyAssetsError("assetOrigin");}
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.pathname !== "/" || (value.assetOrigin !== url.origin && value.assetOrigin !== `${url.origin}/`)) {
    throw new DeploymentLegacyAssetsError("assetOrigin");
  }
  const revisions: Record<string, string> = Object.create(null) as Record<string, string>;
  if (value.revisions !== undefined) {
    if (!record(value.revisions) || Object.getOwnPropertySymbols(value.revisions).length) throw new DeploymentLegacyAssetsError("revisions");
    for (const [from, to] of Object.entries(value.revisions)) {
      const source = assetPath(from, "revisions.source"), target = assetPath(to, "revisions.target");
      if (source.split("/")[0] !== target.split("/")[0] || source.slice(source.lastIndexOf(".")) !== target.slice(target.lastIndexOf("."))) {
        throw new DeploymentLegacyAssetsError("revisions.identity");
      }
      revisions[source] = target;
    }
    if (Object.entries(revisions).some(([from, to]) => from !== to && Object.hasOwn(revisions, to))) throw new DeploymentLegacyAssetsError("revisions.chain");
  }
  const footerSlotId = value.footerSlotId === undefined ? undefined : slotId(value.footerSlotId, "footerSlotId");
  return Object.freeze({version: 1, assetOrigin: url.origin,
    ...(value.stylesheetPath === undefined ? {} : {stylesheetPath: assetPath(value.stylesheetPath, "stylesheetPath", "css")}),
    ...(value.scriptPath === undefined ? {} : {scriptPath: assetPath(value.scriptPath, "scriptPath", "js")}),
    ...(footerSlotId === undefined ? {} : {footerSlotId}),
    revisions: Object.freeze(revisions)});
}

export function rewriteDeploymentLegacyAssetRevisions(
  html: string, assetOrigin: string, revisions: Readonly<Record<string, string>>,
  unsupportedScript: (error: unknown) => void = error => console.warn(`LegacyAssetInlineScriptUnchanged: ${String(error)}`),
): string {
  if (Object.keys(revisions).length === 0) return html;
  const prefix = `${assetOrigin}/files/`;
  function mapped(token: string): string | undefined {
    if (!token.startsWith(prefix)) return undefined;
    let url: URL;
    try {url = new URL(token);} catch {return undefined;}
    if (url.origin !== assetOrigin || url.username || url.password) return undefined;
    const path = url.pathname.slice("/files/".length), replacement = revisions[path];
    if (replacement === undefined || !token.startsWith(prefix + path)) return undefined;
    return prefix + replacement + token.slice(prefix.length + path.length);
  }
  const edits: Array<{start: number; end: number; value: string}> = [];
  const protectedNames = new Set(["iframe", "noembed", "noframes", "noscript", "plaintext", "xmp", "textarea", "title", "style", "template", "svg", "math"]);
  const stack: Array<{name: string; blocked: boolean; executable: boolean; start?: number; end?: number}> = [];
  let currentTag = "", blocked = false, plaintext = false, seen = new Set<string>();
  function script(start: number, end: number): void {
    const code = html.slice(start, end);
    let literals;
    try {literals = staticUglifyHarmonyStringLiteralRanges(code);}
    catch (error) {unsupportedScript(error); return;}
    for (const literal of literals) {
      const raw = code.slice(literal.start, literal.end), quote = raw[0];
      if ((quote !== "'" && quote !== '"') || raw.at(-1) !== quote || raw.slice(1, -1) !== literal.value) continue;
      const value = mapped(literal.value);
      if (value !== undefined) edits.push({start: start + literal.start + 1, end: start + literal.end - 1, value});
    }
  }
  const parser = new Parser({
    onopentagname(name) {
      currentTag = name; seen = new Set();
      if (name === "plaintext") plaintext = true;
      blocked = plaintext || stack.some(frame => frame.blocked) || protectedNames.has(name);
    },
    onattribute(name, value, quote) {
      if (seen.has(name)) return;
      seen.add(name);
      if (blocked || !quote || !["a", "link", "script"].includes(currentTag) || !["src", "href"].includes(name)) return;
      const raw = html.slice(parser.startIndex, parser.endIndex + 1), equals = raw.indexOf("=");
      let start = equals + 1;
      while (/[\t\n\f\r ]/.test(raw[start] ?? "") && start < raw.length) start++;
      const end = raw.lastIndexOf(quote);
      if (equals < 0 || raw[start] !== quote || end <= start || raw.slice(start + 1, end) !== value) return;
      const replacement = mapped(value);
      if (replacement !== undefined) edits.push({start: parser.startIndex + start + 1, end: parser.startIndex + end, value: replacement});
    },
    onopentag(name, attributes) {
      stack.push({name, blocked, executable: name === "script" && !blocked && !Object.hasOwn(attributes, "src")
        && executableScriptStartTag(html.slice(parser.startIndex, parser.endIndex + 1))});
    },
    ontext() {
      const frame = stack.at(-1);
      if (frame?.name !== "script" || frame.blocked || !frame.executable) return;
      frame.start ??= parser.startIndex;
      frame.end = parser.endIndex + 1;
    },
    onclosetag(name) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index]?.name !== name) index--;
      if (index < 0) return;
      const frame = stack[index]!;
      if (frame.name === "script" && !frame.blocked && frame.start !== undefined && frame.end !== undefined) script(frame.start, frame.end);
      stack.splice(index);
    },
  }, {decodeEntities: false});
  parser.end(html);
  let result = html, boundary = html.length;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    if (edit.start < 0 || edit.end > boundary || edit.end < edit.start) throw new Error("Overlapping legacy asset rewrite spans");
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    boundary = edit.start;
  }
  return result;
}
