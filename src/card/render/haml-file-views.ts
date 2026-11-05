import { compileHaml } from "./haml-slice-compiler.js";
import type { HamlScope } from "./haml-slice-compiler.js";
import type { ViewContext, ViewFn } from "./format.js";

export const GROUP_LIST_HAML =
  "- groups.each do |(title, items)|\n" +
  "  %p\n" +
  "    %h5\n" +
  "      =title\n" +
  "    =list_group(items)\n";

export function listGroup(items: unknown): string {
  const list = (Array.isArray(items) ? items : [items]).filter(
    (i) => i !== null && i !== undefined,
  );
  return `<ul class="list-group">${list
    .map((i) => `<li class="list-group-item">${String(i)}</li>`)
    .join("\n")}</ul>`;
}

export function groupsFor(ctx: ViewContext): [string, string[]][] {
  const raw = ctx.fmt.card.dbContent ?? "";
  const lines = raw.split("\n").filter((l) => l !== "");
  if (lines.length === 0) return [];
  const [title, ...items] = lines;
  return [[title!, items]];
}

export function modAssetGroupsCoreHtml(
  groups: readonly (readonly [string, readonly string[]])[],
): string {
  const scope: HamlScope = {
    locals: { groups: groups.map(([title, items]): [string, string[]] => [title, [...items]]) },
    helpers: { list_group: listGroup },
  };
  return compileHaml(GROUP_LIST_HAML, scope);
}

export const modAssetsCoreView: ViewFn = (ctx) => modAssetGroupsCoreHtml(groupsFor(ctx));

export function hamlFileCoreView(
  ctx: ViewContext,
  options: { template?: string; locals?: Record<string, unknown> } = {},
): string {
  const template = options.template ?? ctx.fmt.card.dbContent ?? "";
  const scope: HamlScope = {
    locals: options.locals ?? {},
    helpers: { list_group: listGroup },
  };
  return compileHaml(template, scope);
}
