import type { ViewContext, ViewFn } from "../../render/format.js";
import { NoMethodError, rubyDefaultInspect, stableIdentity } from "../../render/format.js";
import { localAttachmentUrl } from "../../attachments/asset-output-write.js";
import { listGroup } from "../../render/haml-file-views.js";
import { superView } from "../mod-view-helpers.js";
import type {
  DeckoModManifest,
  ModEventCard,
  ModEventFn,
  ModEventRegistration,
} from "../mod-manifest.js";
import { engineOwnedEvent } from "../mod-manifest.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

function fetchAssetOutputCard(ctx: ViewContext): { dbContent: string } | undefined {
  const card = ctx.fmt.card;
  const childName = `${card.name.s}+*asset output`;
  const engine = ctx.fmt.engine as {
    fetchRenderCard?: (name: string) => { dbContent: string } | undefined;
  };
  return engine.fetchRenderCard?.(childName);
}

function cardAssetOutputUrl(ctx: ViewContext): string {
  const child = fetchAssetOutputCard(ctx);
  return localAttachmentUrl(child?.dbContent ?? "");
}

const assetOutputUrlView: ViewFn = (ctx) => {
  const format = ctx.fmt as unknown as Record<string, unknown>;
  const method = format["asset_output_url"];
  if (typeof method === "function") return String(method.call(ctx.fmt));
  throw new NoMethodError(
    "undefined method `asset_output_url' for " +
      rubyDefaultInspect("Card::Format::CardActionView", stableIdentity(ctx.fmt.card.name.s)),
  );
};

function leftIsAssetOutputter(ctx: ViewContext): boolean {
  const card = ctx.fmt.card;
  if (!card.name.s.includes("+")) return false;
  const leftName = card.name.s.slice(0, card.name.s.lastIndexOf("+"));
  const engine = ctx.fmt.engine as {
    fetchRenderCard?: (name: string) => { setKeys: string } | undefined;
  };
  const left = engine.fetchRenderCard?.(leftName);
  if (left === undefined) return false;
  return left.setKeys.includes("TYPE_PLUS_RIGHT-set-Xstyle") ||
    left.setKeys.includes("TYPE_PLUS_RIGHT-set-Xscript");
}

const assetOutputNotFoundView: ViewFn = (ctx) => {
  if (!leftIsAssetOutputter(ctx)) {
    return superView(ctx, "Right::AssetOutput", "not_found");
  }
  const card = ctx.fmt.card;
  if (card.name.s.endsWith("+*asset output")) {
    return localAttachmentUrl(card.dbContent);
  }
  return cardAssetOutputUrl(ctx);
};


function urlsFor(ctx: ViewContext): string[] {
  const raw = ctx.fmt.card.dbContent ?? "";
  if (raw === "") return [];
  return raw.split("\n").filter((line) => line !== "");
}

const groupRemoteCoreView: ViewFn = (ctx) => listGroup(urlsFor(ctx));

const manifestGroupCoreView: ViewFn = (ctx) =>
  listGroup(
    (ctx.fmt.card.dbContent ?? "")
      .split(/\n+/)
      .map((s) => s.replace(/\[\[|\]\]/g, "").trim())
      .filter((s) => s !== ""),
  );

const javascriptIncludeTagView: ViewFn = (ctx) => {
  const urls = urlsFor(ctx);
  return urls.map((path) => `<script src="${path}"></script>`).join("\n");
};

const stylesheetIncludeTagView: ViewFn = (ctx) => {
  const urls = urlsFor(ctx);
  return urls
    .map((path) => `<link href="${path}" media="all" rel="stylesheet" type="text/css" />`)
    .join("\n");
};

export function modAssetsGroupListHtml(
  groups: ReadonlyArray<readonly [string, readonly string[]]>,
): string {
  return groups
    .map(
      ([title, items]) =>
        `<p>\n<h5>\n${title}\n</h5>\n${listGroupOf(items)}\n</p>\n`,
    )
    .join("");
}

function listGroupOf(items: readonly string[]): string {
  if (items.length === 0) return `<ul class="list-group"></ul>`;
  return (
    `<ul class="list-group">` +
    items
      .map((item) => `<li class="list-group-item">${item}</li>`)
      .join("\n") +
    `</ul>`
  );
}

export const assetsModEventPredicates = {
  "codename?": (card: ModEventCard): boolean => {
    const codename = card.codename;
    return codename !== undefined && codename !== null && codename.trim() !== "";
  },
  "asset_inputter?": (_card: ModEventCard): boolean => true,
} as const;

const cardModAssets: DeckoModManifest = {
  name: "assets",
  gemName: "card-mod-assets",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "right/asset_output",
      events: [
        event({ event: "remove_codename", at: "prepare_to_validate", on: ["delete"], when: "codename?" }),
      ],
      formats: {
        html: {
          views: [{ view: "not_found", viewFn: assetOutputNotFoundView }],
        },
      },
    },
    {
      setPath: "abstract/asset_outputter",
      events: [
        engineOwnedEvent({ event: "update_asset_output_file", at: "finalize", on: ["save"] }),
        engineOwnedEvent({ event: "validate_asset_inputs", at: "validate", on: ["save"], skip: "allowed" }),
      ],
    },
    {
      setPath: "abstract/asset_inputter",
      events: [
        engineOwnedEvent({
          event: "asset_input_changed",
          at: "finalize",
          on: ["save"],
          when: "asset_inputter?",
          changed: ["content"],
          skip: "allowed",
        }),
        engineOwnedEvent({
          event: "asset_input_changed_on_delete",
          before: "clear_references",
          on: ["delete"],
          when: "asset_inputter?",
        }),
      ],
    },
    {
      setPath: "type_plus_right/set/style",
      formats: {
        html: {
          views: [{ view: "asset_output_url", viewFn: assetOutputUrlView }],
        },
      },
    },
    {
      setPath: "type_plus_right/set/script",
      formats: {
        html: {
          views: [{ view: "asset_output_url", viewFn: assetOutputUrlView }],
        },
      },
    },
    {
      setPath: "right/group_remote",
      formats: {
        html: {
          views: [
            { view: "core", viewFn: groupRemoteCoreView },
            {
              view: "javascript_include_tag",
              viewFn: javascriptIncludeTagView,
              config: { cache: "never" },
            },
            {
              view: "stylesheet_include_tag",
              viewFn: stylesheetIncludeTagView,
            },
          ],
        },
      },
    },
    { setPath: "abstract/01_manifest_group" },
    { setPath: "abstract/asset_file" },
    { setPath: "abstract/asset_group" },
    { setPath: "abstract/folder_group" },
    { setPath: "abstract/local_manifest_group" },
    { setPath: "abstract/mod_assets" },
    { setPath: "right/asset_input" },
    { setPath: "type/mod" },
    {
      setPath: "type/local_script_manifest_group",
      formats: { html: { views: [{ view: "core", viewFn: manifestGroupCoreView }] } },
    },
    {
      setPath: "type/local_style_manifest_group",
      formats: { html: { views: [{ view: "core", viewFn: manifestGroupCoreView }] } },
    },
  ],
};

export default cardModAssets;

export { assetOutputUrlView, assetOutputNotFoundView };
