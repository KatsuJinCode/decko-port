import type { ViewResult } from "../../render/format.js";

import type { ViewContext, ViewFn } from "../../render/format.js";
import { RenderFormat, UnsupportedViewError, str } from "../../render/format.js";
import { HTML_VIEWS } from "../../render/views.js";
import { h } from "../../render/slot-html.js";
import { localAttachmentUrl } from "../../attachments/asset-output-write.js";
import { inputFormatFor } from "../../attachments/asset-input-assembly.js";
import { modAssetsGroupListHtml } from "./card-mod-assets.js";
import type {
  DeckoModManifest,
  ModEngineHost,
  ModEventCard,
  ModEventFn,
} from "../mod-manifest.js";

function isInSkinBoxSet(ctx: ViewContext): boolean {
  const code = ctx.fmt.card.typeCode;
  if (code === "skin" || code === "bootswatch_skin") return true;
  const name = ctx.fmt.card.typeName;
  return name === "Skin" || name === "BootswatchSkin";
}

const priorBoxBottom: ViewFn | undefined = HTML_VIEWS["box_bottom"];
const priorBoxMiddle: ViewFn | undefined = HTML_VIEWS["box_middle"];
const priorCustomizeButton: ViewFn | undefined = HTML_VIEWS["customize_button"];

function priorOrUnsupported(
  prior: ViewFn | undefined,
  view: string,
  ctx: ViewContext,
): ViewResult {
  if (prior === undefined) {
    throw new UnsupportedViewError(view, ctx.fmt.card.name.s);
  }
  return prior(ctx);
}

const skinBoxBottomView: ViewFn = (ctx: ViewContext): ViewResult => {
  if (!isInSkinBoxSet(ctx)) return priorOrUnsupported(priorBoxBottom, "box_bottom", ctx);
  return "";
};

const skinCustomizeButtonView: ViewFn = (ctx: ViewContext): ViewResult => {
  if (!isInSkinBoxSet(ctx)) {
    return priorOrUnsupported(priorCustomizeButton, "customize_button", ctx);
  }
  return "";
};

const skinBoxMiddleView: ViewFn = (ctx: ViewContext): ViewResult => {
  if (!isInSkinBoxSet(ctx)) return priorOrUnsupported(priorBoxMiddle, "box_middle", ctx);
  const image = ctx.fmt.engine.fetchRenderCard(`${ctx.fmt.card.name.s}+image`);
  if (image === undefined) return "";
  return ctx.fmt.nestRecord(image, "full_width", { size: "large" });
};

export const cssChunkList = "references";

export const cssInputType = "ace_editor";

export const cssAceMode = "css";

export const cssDefaultNestView = "closed";

export const scssAceMode = "scss";

export const assetStyleCompressFlag = "@minimize";

export const validFileExtensions = ["css", "scss"] as readonly string[];

export const styleOkItemTypes = [
  "css",
  "scss",
  "skin",
  "bootswatch_skin",
] as readonly string[];

export const hiddenSkins = [
  "bootstrap_default_skin",
  "themeless_bootstrap_skin",
  "bootstrap_default_skin",
  "classic_bootstrap_skin",
] as readonly string[];

export const styleInputType = "box_select";

export const styleDefaultItemView = "bar";

export const setStyleOkToRead = true;

export const modStyleSubpath = "style";

export const modStyleFolderGroupType = "local_style_folder_group";
export const modStyleLocalManifestGroupType = "local_style_manifest_group";

export function skinDeletionError(
  styleItemKeys: readonly string[],
  cardKey: string,
): string | undefined {
  return styleItemKeys.includes(cardKey)
    ? "Can't delete skin because it's used."
    : undefined;
}

const validateCssBody: ModEventFn = () => {
};

const validateScssSyntaxBody: ModEventFn = () => {
};

const noDeletionIfUsedBody: ModEventFn = (card: ModEventCard, _host: ModEngineHost) => {
  void card;
};

function modStyleModname(ctx: ViewContext): string {
  const leftKey = ctx.fmt.card.name.leftName?.key ?? "";
  return leftKey.replace(/^mod_/, "");
}

const MOD_STYLE_GROUPS: Record<
  string,
  ReadonlyArray<readonly [string, readonly string[]]>
> = {
  format: [
    [
      "group: local",
      [
        "common.scss",
        "logo_and_credit.scss",
        "menu.scss",
        "messaging.scss",
        "misc.scss",
        "open_and_closed.scss",
      ],
    ],
  ],
  style: [["group: local", ["jquery_ui_decko.scss", "jquery_ui_smoothness.css"]]],
};

function styleItemNames(ctx: ViewContext, card: ViewContext["fmt"]["card"]): string[] {
  return card.dbContent
    .split(/\n+/)
    .map((item) => item.replace(/\[\[|\]\]/g, "").trim())
    .filter((item) => item !== "");
}

function styleRenderCardView(ctx: ViewContext, name: string, view: string): string | undefined {
  const target = ctx.fmt.engine.fetchRenderCard(name);
  if (target === undefined) return undefined;
  return ctx.fmt.nestRecord(target, view);
}

const skinConcatView: ViewFn = (ctx) => {
  const fmt = ctx.fmt;
  const parts: string[] = [];
  for (const name of styleItemNames(ctx, fmt.card)) {
    const item = fmt.engine.fetchRenderCard(name);
    if (item === undefined) continue;
    const spec = inputFormatFor(item.setKeys);
    if (spec === undefined) {
      parts.push(ctx.fmt.nestRecord(item, "core"));
      continue;
    }
    const sub = new RenderFormat(item, fmt.engine, {
      parent: fmt,
      formatName: spec.format,
      maxDepth: fmt.maxDepth,
      nestQuietErrors: fmt.nestQuietErrors,
    });
    parts.push(str(sub.renderView(spec.view)));
  }
  return parts.join("\n");
};

function styleGroupRemoteLines(ctx: ViewContext): string[] {
  const card = ctx.fmt.card;
  const leftKey = card.name.leftName?.key;
  if (leftKey === undefined) return [];
  const groupRemote = ctx.fmt.engine.fetchRenderCard(`${leftKey}+*group remote`);
  const content = groupRemote?.dbContent;
  if (content !== undefined && content !== "") {
    return content.split("\n").filter((src) => src !== "");
  }
  const MOD_REMOTE_STYLE_SRCS: Record<string, string[]> = {
    "mod: bootstrap": ["https://fonts.googleapis.com/css2?family=Material+Icons"],
  };
  const modLeft = card.name.leftName?.s;
  if (modLeft !== undefined) {
    const srcs = MOD_REMOTE_STYLE_SRCS[modLeft];
    if (srcs !== undefined) return srcs;
  }
  return [];
}

const remoteIncludeTagsView: ViewFn = (ctx) => {
  return styleGroupRemoteLines(ctx)
    .map(
      (src) =>
        `<link href="${h(src)}" media="all" rel="stylesheet" type="text/css" />`,
    )
    .join("\n");
};

const remoteStyleTagsView: ViewFn = (ctx) => {
  const items = styleItemNames(ctx, ctx.fmt.card)
    .map((item) => styleRenderCardView(ctx, item, "remote_include_tags") ?? "")
    .filter((tags) => tags !== "");
  return items.join("\n");
};

const modStylesheetIncludeTagView: ViewFn = (ctx) => {
  const items = styleItemNames(ctx, ctx.fmt.card)
    .map((item) => styleRenderCardView(ctx, item, "stylesheet_include_tag") ?? "")
    .filter((tags) => tags !== "");
  return items.join("\n");
};

const abstractStylesheetIncludeTagView: ViewFn = () => {
  throw new Error(
    "undefined method `stylesheet_include_tag' for the style-group format (card-mod-assets' helper is not in the installed gem set)",
  );
};

function styleAssetOutputUrl(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const childName = `${card.name.s}+*asset output`;
  const child = ctx.fmt.engine.fetchRenderCard?.(childName);
  return localAttachmentUrl(child?.dbContent ?? "");
}

const setStylesheetPathView: ViewFn = (ctx) => {
  return styleAssetOutputUrl(ctx);
};

export const styleProbeSurface = {
  remoteIncludeTagsFrom(srcs: string[]): string {
    return srcs
      .map(
        (src) =>
          `<link href="${h(src)}" media="all" rel="stylesheet" type="text/css" />`,
      )
      .join("\n");
  },
  remoteStyleTagsFrom(arms: string[]): string {
    return arms.filter((tags) => tags !== "").join("\n");
  },
  abstractStylesheetIncludeTagRaise(): never {
    return abstractStylesheetIncludeTagView({} as ViewContext) as never;
  },
};

const modStyleGroupCoreView: ViewFn = (ctx) => {
  const groups = MOD_STYLE_GROUPS[modStyleModname(ctx)];
  if (groups === undefined) return "";
  return modAssetsGroupListHtml(groups);
};

const cardModStyle: DeckoModManifest = {
  name: "style",
  gemName: "card-mod-style",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/01_asset_style",
      formats: {},
    },
    {
      setPath: "abstract/01_css",
      formats: {},
    },
    {
      setPath: "abstract/02_scss",
      formats: {},
    },
    {
      setPath: "abstract/03_asset_css",
      formats: {},
    },
    {
      setPath: "abstract/03_asset_scss",
      formats: {},
    },
    {
      setPath: "abstract/skin_box",
      formats: {
        html: {
          views: [
            { view: "box_bottom", viewFn: skinBoxBottomView },
            { view: "customize_button", viewFn: skinCustomizeButtonView },
            { view: "box_middle", viewFn: skinBoxMiddleView },
          ],
        },
      },
    },
    {
      setPath: "abstract/style_group",
      formats: {
        html: {
          views: [{ view: "stylesheet_include_tag", viewFn: abstractStylesheetIncludeTagView }],
        },
      },
    },
    {
      setPath: "self/style",
      settingOpts: {
        group: "webpage",
        position: 4,
        helpText:
          "Skin (collection of stylesheets) for card's page. [[http://decko.org/skins|more]]",
      },
      formats: {},
    },
    {
      setPath: "self/style_mods",
      formats: {
        html: {
          views: [
            {
              view: "remote_style_tags",
              viewFn: remoteStyleTagsView,
              config: { cache: "deep", perms: "none" },
            },
          ],
        },
      },
    },
    {
      setPath: "type/css",
      formats: {},
      events: [
        {
          event: "validate_css",
          at: "validate",
          on: ["save"],
          changed: ["type_id", "content"],
          fn: validateCssBody,
        },
      ],
    },
    {
      setPath: "type/local_style_folder_group",
      formats: {},
    },
    {
      setPath: "type/local_style_manifest_group",
      formats: {},
    },
    {
      setPath: "type/scss",
      formats: {},
      events: [
        {
          event: "validate_scss_syntax",
          at: "validate",
          on: ["save"],
          changed: ["type_id", "content"],
          fn: validateScssSyntaxBody,
        },
      ],
    },
    {
      setPath: "type/skin",
      formats: {
        css: {
          views: [{ view: "concat", viewFn: skinConcatView }],
        },
      },
      events: [
        {
          event: "no_deletion_if_used",
          at: "validate",
          on: ["delete"],
          fn: noDeletionIfUsedBody,
        },
      ],
    },
    {
      setPath: "type_plus_right/mod/style",
      formats: {
        html: {
          views: [
            { view: "core", viewFn: modStyleGroupCoreView },
            { view: "stylesheet_include_tag", viewFn: modStylesheetIncludeTagView },
            { view: "remote_include_tags", viewFn: remoteIncludeTagsView },
          ],
        },
      },
    },
    {
      setPath: "type_plus_right/set/style",
      formats: {
        html: {
          views: [
            {
              view: "stylesheet_path",
              viewFn: setStylesheetPathView,
              config: { cache: "never", perms: "none" },
            },
          ],
        },
      },
    },
  ],
};

export default cardModStyle;
