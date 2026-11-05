import type { ViewResult } from "../../render/format.js";

import type { ViewContext, ViewFn } from "../../render/format.js";
import { HTML_VIEWS } from "../../render/views.js";
import { defineMod } from "../mod-dsl.js";
import { kramdownToHtml, kramdownToStashedHtml } from "../../render/kramdown.js";

export { kramdownToHtml };

const priorCore: ViewFn =
  HTML_VIEWS["core"] ??
  ((ctx) => ctx.fmt.processContent(ctx.fmt.renderRaw()));

const markdownCoreView: ViewFn = (ctx: ViewContext): ViewResult => {
  if (ctx.fmt.card.typeName !== "Markdown") return priorCore(ctx);
  return markdownCore(ctx);
};

function markdownCore(ctx: ViewContext): string {
  return ctx.fmt.processContent(kramdownToStashedHtml(ctx.fmt.renderRaw()));
}

export function escapeLiteral(literal: string): string {
  return literal;
}

export const inputType = "ace_editor";

export const aceMode = "markdown";

const cardModMarkdown = defineMod("card-mod-markdown", { group: "gem-defaults" }, ({ set }) => {
  set("type/markdown", ({ format }) => {
    format("html", ({ view }) => {
      view("core", markdownCoreView);
    });
  });
});

export default cardModMarkdown;
