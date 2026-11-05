import { styleForKindPath } from "./alpha-style.js";
import { coderayEscape } from "./escape.js";
import { tokenKindClass } from "./token-kinds.js";

export class HtmlTokenEncoder {
  private out = "";
  private readonly opened: string[] = [];
  private lastOpened: string | undefined;
  private readonly spanCache = new Map<string, string | undefined>();

  private spanFor(kinds: readonly string[]): string | undefined {
    const key = kinds.join("\0");
    const cached = this.spanCache.get(key);
    if (cached !== undefined || this.spanCache.has(key)) return cached;
    const span = this.buildSpan(kinds);
    if (this.spanCache.size >= 100) this.spanCache.clear();
    this.spanCache.set(key, span);
    return span;
  }

  private buildSpan(kinds: readonly string[]): string | undefined {
    const cssClass = tokenKindClass(kinds[0] ?? "");
    if (cssClass === false) return undefined;
    const style = styleForKindPath(kinds.map((kind) => String(tokenKindClass(kind))));
    return style ? `<span style="${style}">` : "<span>";
  }

  textToken(text: string, kind: string): void {
    const kinds = this.lastOpened === undefined ? [kind] : [kind, ...this.opened];
    const span = this.spanFor(kinds);
    const escaped = coderayEscape(text);
    this.out += span === undefined ? escaped : `${span}${escaped}</span>`;
  }

  beginGroup(kind: string): void {
    const kinds = this.lastOpened === undefined ? [kind] : [kind, ...this.opened];
    const span = this.spanFor(kinds);
    this.out += span ?? "<span>";
    this.opened.push(kind);
    this.lastOpened = kind;
  }

  endGroup(): void {
    if (this.opened.pop() === undefined) return;
    this.out += "</span>";
    this.lastOpened = this.opened[this.opened.length - 1];
  }

  closeAllGroups(): void {
    while (this.opened.pop() !== undefined) {
      this.out += '</span>';
    }
    this.lastOpened = undefined;
  }

  toString(): string {
    return this.out;
  }
}
