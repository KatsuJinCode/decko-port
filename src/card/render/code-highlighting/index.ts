import { scanJson } from "./scanners/json.js";
import { scanCss } from "./scanners/css.js";
import { scanHtml } from "./scanners/html.js";
import { scanJavaScript } from "./scanners/java-script.js";
import { scanRuby } from "./scanners/ruby.js";
import { coderayEscape } from "./escape.js";

export type HighlightLanguage = "json" | "css" | "html" | "java_script" | "ruby";

const DIV_OPEN = '<div class="CodeRay">\n  <div class="code"><pre>';
const DIV_CLOSE = "</pre></div>\n</div>\n";

export function wrapDiv(content: string): string {
  return DIV_OPEN + content + DIV_CLOSE;
}

function toUnix(code: string): string {
  return code.indexOf("\r") === -1 ? code : code.replace(/\r\n?/g, "\n");
}

export function highlight(content: string, lang: HighlightLanguage): string {
  const code = toUnix(content);
  switch (lang) {
    case "json":
      return wrapDiv(scanJson(code));
    case "css":
      return wrapDiv(scanCss(code));
    case "html":
      return wrapDiv(scanHtml(code));
    case "java_script":
      return wrapDiv(scanJavaScript(code));
    case "ruby": {
      const tokens = scanRuby(code);
      return wrapDiv(tokens ?? coderayEscape(code));
    }
  }
}

export const CODERAY_CARDTYPE_CODENAMES: ReadonlySet<string> = new Set([
  "json",
  "layout_type",
  "head",
  "css",
  "scss",
  "java_script",
  "coffee_script",
]);

export function langForTypeCode(typeCode: string | undefined): HighlightLanguage | undefined {
  if (typeCode === undefined) return undefined;
  if (typeCode === "json") return "json";
  if (typeCode === "css" || typeCode === "scss") return "css";
  if (typeCode === "layout_type" || typeCode === "head") return "html";
  if (typeCode === "java_script") return "java_script";
  return undefined;
}
