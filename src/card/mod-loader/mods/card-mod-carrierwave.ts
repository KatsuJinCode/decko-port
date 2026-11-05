import { RenderFormat } from "../../render/format.js";
import { NoMethodError, str } from "../../render/format.js";

import type { ViewContext, ViewFn } from "../../render/format.js";
import { allHtmlViewsOneLineContentView } from "./card-mod-format.js";
import {
  cloudImageUrl,
  derivedCloudAttachmentSource,
  formatFileCore,
  formatImageCore,
  HTML_VIEWS,
  imageSizeVariant,
  localStorageUrl,
} from "../../render/views.js";
import { h } from "../../render/slot-html.js";
import {
  lastContentActionIdFromIdentifier,
  parseLocalAttachmentIdentifier,
} from "../../attachments/attachment-content.js";
import type {
  DeckoModManifest,
  ModEventCard,
  ModEventFn,
  ModEventRegistration,
} from "../mod-manifest.js";
import { engineOwnedEvent } from "../mod-manifest.js";
import { CardActionError } from "../../actions/types.js";
import { numberToHumanSize } from "./rails-number-to-human-size.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

function storageTypeFromContent(content: string): "cloud" | "web" | "local" | "coded" | "unknown" {
  const trimmed = content.trim();
  if (trimmed === "") return "unknown";
  if (/^\(/.test(trimmed)) return "cloud";
  if (/^https?:/.test(trimmed)) return "web";
  if (/^~/.test(trimmed)) return "local";
  if (/^:/.test(trimmed)) return "coded";
  return "unknown";
}

function contextualizePath(content: string, cardId?: number): string {
  const trimmed = content.trim();
  if (trimmed === "") return "";
  const type = storageTypeFromContent(trimmed);
  if (type === "web") return trimmed;
  if (type === "cloud") {
    return derivedCloudAttachmentSource(trimmed);
  }
  if (type === "local" || type === "coded") {
    return localStorageUrl(trimmed, undefined, cardId);
  }
  return "";
}

function fileSource(ctx: ViewContext): string {
  const raw = (ctx.fmt.card.dbContent ?? "").trim();
  return contextualizePath(raw, ctx.fmt.card.id);
}

const fileCoreView: ViewFn = (ctx) => {
  return formatFileCore(ctx.fmt.card.dbContent, {
    cardName: ctx.fmt.card.name.s,
    contextNames: ctx.fmt.contextNames,
    cardId: ctx.fmt.card.id,
  });
};

function imageSource(ctx: ViewContext): string {
  const raw = (ctx.fmt.card.dbContent ?? "").trim();
  const type = storageTypeFromContent(raw);
  if (type === "web") return raw;
  if (type === "cloud") {
    const size = ctx.voo?.opts.size ?? (ctx.fmt.isMain ? "large" : undefined);
    return cloudImageUrl(raw, size, ctx.fmt.engine.imageCdnHost);
  }
  if (type === "local" || type === "coded") {
    const svg = /\.svg$/i.test(raw);
    return localStorageUrl(raw, svg ? undefined : imageSizeVariant(ctx.voo?.opts.size), ctx.fmt.card.id);
  }
  return contextualizePath(raw, ctx.fmt.card.id);
}

const imageInlineView: ViewFn = (ctx) => ctx.fmt.renderView("core");
const imageOneLineContentView: ViewFn = (ctx) => {
  if (ctx.fmt.card.typeCode !== "image") {
    return allHtmlViewsOneLineContentView(ctx);
  }
  return ctx.fmt.renderView("core", { size: "icon" });
};


const imageHtmlCoreView: ViewFn = (ctx) =>
  formatImageCore(
    ctx.fmt.card.dbContent,
    ctx.fmt.card.id,
    ctx.fmt.card.name.s,
    ctx.voo?.opts.size ?? (ctx.fmt.isMain ? "large" : "medium"),
    ctx.fmt.engine.imageCdnHost,
  );

const imageHtmlFullWidthView: ViewFn = (ctx) => {
  const src = imageSource(ctx);
  if (src === "") {
    return "";
  }
  if (src === "missing") {
    return `<!-- invalid image for ${h(ctx.fmt.card.name.s)}; source: ${h(src)} -->`;
  }
  return `<img alt="${h(ctx.fmt.card.name.s)}" class="w-100" src="${h(src)}" />`;
};

const CODED_ORIGINAL_FILENAMES: Record<string, string> = {
  favicon: "image.png",
};

function codedOriginalFilename(source: string): string | undefined {
  const match = /\/files\/:([a-z0-9_-]+)\//.exec(source);
  if (match === null) return undefined;
  return CODED_ORIGINAL_FILENAMES[match[1].toLowerCase()];
}

const imageHtmlPreviewView: ViewFn = (ctx) => {
  const inner = ctx.fmt.renderView("core", { size: "medium" });
  if (inner === "") return "";
  const source = str(ctx.fmt.renderView("source", { size: "medium" }));
  const originalName =
    codedOriginalFilename(source) ?? ctx.fmt.card.name.s;
  return `<div class="attachment-preview" id="${h(originalName)}-preview">${inner}</div>`;
};

function renderAddedChunk(text: string): string {
  return `<ins class='diffins diff-added'>${text}</ins>`;
}

const imageHtmlContentChangesView: ViewFn = (ctx) => {
  const reader = ctx.fmt.engine.historyRenderReader?.();
  if (reader === undefined) {
    throw new Error("content_changes: the history render seam is not prepared for this render (card.last_action is unreadable)");
  }
  const action = reader.cardLastAction;
  if (action === undefined) {
    throw new Error("content_changes: card has no last action (Ruby nil.id NoMethodError, html_views.rb:75)");
  }
  if (reader.previousValue(action, "db_content") !== undefined) {
    throw new Error("content_changes: old_image for an earlier db_content change is not ported (html_views.rb:58-66)");
  }
  return renderAddedChunk(str(ctx.fmt.renderView("core")));
};

function faviconSource(ctx: ViewContext): string {
  const typeName = ctx.fmt.card.typeName;
  if (typeName === "Image") return imageSource(ctx);
  return "";
}

const faviconLinkTagView: ViewFn = (ctx) => {
  const smallCtx = {
    ...ctx,
    voo: { ...(ctx.voo ?? {}), opts: { ...(ctx.voo?.opts ?? {}), size: "small" } },
  } as unknown as typeof ctx;
  const src = imageSource(smallCtx);
  if (src === "") return "";
  return `<link rel="shortcut icon" href="${h(src)}" />`;
};

const FAVICON_RAW_HELP_TEXT =
  "A favicon (or shortcut icon) is a small image used by browsers to help identify " +
  "your website. [[http://www.decko.org/favicon|How to customize your favicon]]";

const searchJsonImageCompleteView: ViewFn = ({ fmt }) => {
  const seat = fmt.engine.imageCompleteSeat?.(fmt.card);
  if (seat === undefined) throw new Error("image_complete rendered without its prepare seat");
  if (seat.failure !== undefined) throw seat.failure;
  return seat.items.map(item => {
    const html = new RenderFormat(item, fmt.engine, {
      parent: fmt, formatName: "html", maxDepth: fmt.maxDepth, nestQuietErrors: fmt.nestQuietErrors,
    });
    return { id: item.name.s, href: item.name.urlKey, text: str(html.renderView("goto_autocomplete_item", {})) };
  });
};

function noUpload(ctx: ViewContext): boolean {
  const engine = ctx.fmt.engine as { fileStorage?: string } | undefined;
  return engine?.fileStorage === "web";
}

function textFieldContentBytes(ctx: ViewContext): string {
  const content = ctx.fmt.card.dbContent ?? "";
  return (
    `<input class="d0-card-content form-control" type="text" value="${h(content)}" ` +
    'name="card[content]" id="card_content" />'
  );
}

function fileChooserActionText(ctx: ViewContext, mount: "file" | "image" = "file"): string {
  const card = ctx.fmt.card as { id?: number; record?: { isNew?: boolean } };
  const isNew = card.record?.isNew === true || card.id === undefined;
  const humanized = mount === "image" ? "Image" : "File";
  return `${isNew ? "Add" : "Replace"} ${humanized}...`;
}

function fileChooserBytes(ctx: ViewContext, mount: "file" | "image" = "file"): string {
  const card = ctx.fmt.card as { typeId?: number };
  const typeId = card.typeId ?? "";
  const urlKey = ctx.fmt.urlKey();
  return (
    "<div class='choose-file'>\n" +
    previewLine(ctx, mount) +
    "<span class='btn btn-secondary fileinput-button'>\n" +
    '<i class="notranslate material-icons">cloud_upload</i>\n' +
    `<span>${fileChooserActionText(ctx, mount)}</span>\n` +
    `<input class='file-upload slotter form-control' id='card_${mount}' name='card[${mount}]' type='file'>\n` +
    `<input type="hidden" name="attachment_type_id" id="attachment_type_id" value="${typeId}" autocomplete="off" />\n` +
    `<input class="attachment_card_name form-control" value="" autocomplete="off" type="hidden" name="card[${mount}]" id="card_${mount}" />\n` +
    `<input type="hidden" name="file_card_name" id="file_card_name" value="${h(urlKey)}" autocomplete="off" />\n` +
    "</span>\n" +
    "</div>\n" +
    "<div class='progress mb-2' id='progress' style='display: none;'>\n" +
    "<div class='progress-bar progress-bar-success' style='width: 0%;'></div>\n" +
    "</div>\n" +
    "<div class='chosen-file'></div>\n"
  );
}

function previewLine(
  ctx: ViewContext,
  mount: "file" | "image",
  preliminaryIdentifier?: string,
): string {
  if (mount !== "image") return "\n";
  if (preliminaryIdentifier !== undefined) {
    const parsed = parseLocalAttachmentIdentifier(preliminaryIdentifier);
    if (parsed !== undefined) {
      const inner = formatImageCore(
        preliminaryIdentifier,
        ctx.fmt.card.id,
        ctx.fmt.card.name.s,
        "medium",
        ctx.fmt.engine.imageCdnHost,
      );
      return `<div class="attachment-preview" id="${h(`${parsed.actionId}${parsed.ext}`)}-preview">${inner}</div>\n`;
    }
  }
  const card = ctx.fmt.card as { id?: number; record?: { isNew?: boolean } };
  const isNew = card.record?.isNew === true || card.id === undefined;
  return isNew ? "\n" : `${imageHtmlPreviewView(ctx)}\n`;
}

const fileInputView: ViewFn = (ctx) => {
  if (ctx.fmt.card.typeCode === "image") return imageInputView(ctx);
  if (noUpload(ctx)) return textFieldContentBytes(ctx);
  return fileChooserBytes(ctx);
};

const imageInputView: ViewFn = (ctx) => {
  if (noUpload(ctx)) return textFieldContentBytes(ctx);
  return fileChooserBytes(ctx, "image");
};

function cachedUploadCardName(ctx: ViewContext): string {
  const raw = ctx.voo.opts["attachment_upload"];
  if (typeof raw !== "string") {
    throw new NoMethodError("undefined method `gsub' for nil");
  }
  return raw.replace(/\[\w+\]$/, "[action_id_of_cached_upload]");
}

const filePreviewEditorView: ViewFn = (ctx) => {
  const uploadCardName = cachedUploadCardName(ctx);
  const card = ctx.fmt.card;
  const optAction = ctx.voo.opts["selected_action_id"];
  const actionId = typeof optAction === "number"
    ? optAction
    : typeof optAction === "string" && /^\d+$/.test(optAction)
    ? Number(optAction)
    : lastContentActionIdFromIdentifier(card.dbContent);
  const optIdentifier = ctx.voo.opts["cached_upload_identifier"];
  const preliminaryIdentifier = typeof optIdentifier === "string" && optIdentifier !== ""
    ? optIdentifier
    : undefined;
  const name = typeof ctx.voo.opts["original_filename"] === "string"
    ? (ctx.voo.opts["original_filename"] as string)
    : "";
  const size = typeof ctx.voo.opts["attachment_size"] === "number"
    ? (ctx.voo.opts["attachment_size"] as number)
    : 0;
  return (
    "<div class='chosen-file'>\n" +
    `<input name='${h(uploadCardName)}' type='hidden' value='${actionId ?? ""}'>\n` +
    "<div class='d-flex'>\n" +
    previewLine(ctx, ctx.fmt.card.typeCode === "image" ? "image" : "file", preliminaryIdentifier) +
    "<div class='d-flex flex-column justify-content-between ml-2 w-100'>\n" +
    "<div>\n" +
    "<p class='name'>\n" +
    `${h(name)}\n` +
    "</p>\n" +
    "<span class='size'>\n" +
    `${numberToHumanSize(size)}\n` +
    "</span>\n" +
    "</div>\n" +
    "<div class='align-self-end'>\n" +
    "<button class='btn btn-danger delete cancel-upload' data-type='DELETE'>\n" +
    '<i class="notranslate material-icons">delete</i>\n' +
    "<span>\n" +
    "Delete\n" +
    "</span>\n" +
    "</button>\n" +
    "</div>\n" +
    "</div>\n" +
    "</div>\n" +
    "</div>\n"
  );
};

const polymorphicSourceView: ViewFn = (ctx) => {
  if (ctx.fmt.card.typeCode === "image") return imageSource(ctx);
  return fileSource(ctx);
};

const BASE_CORE: ViewFn | undefined = HTML_VIEWS["core"];
const polymorphicCoreView: ViewFn = (ctx) => {
  if (ctx.fmt.card.typeCode === "image") return imageHtmlCoreView(ctx);
  if (ctx.fmt.card.typeCode === "file" || ctx.fmt.card.typeName === "File") {
    return fileCoreView(ctx);
  }
  if (BASE_CORE === undefined) return "";
  return BASE_CORE(ctx);
};

function deprecatedModFile(content: string | null | undefined): boolean {
  if (content === undefined || content === null) return false;
  if (content.trim() === "") return false;
  if (/^~/.test(content)) return false;
  return content.split("\n").length === 4;
}

export function rubyStorageTypeFromContent(
  content: string | null | undefined,
  configured: string,
): string {
  if (content === undefined || content === null) return configured;
  if (/^\(/.test(content)) return "cloud";
  if (/^https?:/.test(content)) return "web";
  if (/^~/.test(content)) return "local";
  if (/^:/.test(content)) return "coded";
  return deprecatedModFile(content) ? "coded" : configured;
}

export function rubyBucketFromContent(content: string | null | undefined): string | undefined {
  if (content === undefined || content === null) return undefined;
  const m = /^\(([^)]+)\)/.exec(content);
  return m !== null ? m[1] : undefined;
}

export function rubyModFromContent(content: string | null | undefined): string | undefined {
  if (content === undefined || content === null) return undefined;
  const m = /^:[:\w/+]+\/([^./]+)\./.exec(content);
  if (m !== null) return m[1];
  return deprecatedModFile(content)
    ? (content.split("\n").at(-1) ?? undefined)
    : undefined;
}

export const RUBY_STORAGE_TYPES: readonly string[] = ["cloud", "web", "coded", "local"];

export const validateStorageTypeFn: ModEventFn = (card) => {
  const storageType = card.storageType;
  if (storageType === undefined || RUBY_STORAGE_TYPES.includes(storageType)) return;
  const message = `unknown storage type ${storageType}`;
  throw new CardActionError(
    "validation-failed",
    message,
    `STORAGE TYPE: ${message}`,
    { storage_type: message },
    card.name,
  );
};

function present(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function truthy(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

function storageTypeIs(card: ModEventCard, type: string): boolean {
  return card.storageType === type;
}

export const carrierwaveModEventPredicates = {
  "store_file_event?": (card: ModEventCard): boolean =>
    !storageTypeIs(card, "coded") || card.storeCodedFiles === true,
  "store_image_event?": (card: ModEventCard): boolean =>
    !storageTypeIs(card, "coded") || card.storeCodedFiles === true,
  "incorrect_identifier?": (card: ModEventCard): boolean =>
    !storageTypeIs(card, "web") &&
    present(card.attachmentIdentifierContent) &&
    card.dbContent !== card.attachmentIdentifierContent,
  "write_identifier?": (card: ModEventCard): boolean => !storageTypeIs(card, "web"),
  "file_ready_to_save?": (card: ModEventCard): boolean =>
    card.attachmentPresent === true &&
    !truthy(card.params?.["attachment_upload"]) &&
    !present(card.actionIdOfCachedUpload) &&
    card.attachmentIsChanging === true,
  "preliminary_upload?": (card: ModEventCard): boolean =>
    truthy(card.params?.["attachment_upload"]),
  "save_preliminary_upload?": (card: ModEventCard): boolean =>
    present(card.actionIdOfCachedUpload),
  "storage_changed?": (card: ModEventCard): boolean =>
    card.storageType !== card.currentStorageType ||
    card.currentStorageBucket !== card.savedStorageBucket ||
    card.currentStorageMod !== card.savedStorageMod,
  "coded?": (card: ModEventCard): boolean => storageTypeIs(card, "coded"),
  "local?": (card: ModEventCard): boolean => storageTypeIs(card, "local"),
  "change_bucket_if_read_only?": (card: ModEventCard): boolean =>
    storageTypeIs(card, "cloud") &&
    card.bucketReadOnly === true &&
    card.attachmentIsChanging === true,
  "uncode?": (card: ModEventCard): boolean =>
    card.explicitStorageType !== "coded" &&
    !present(card.assignedMod) &&
    storageTypeIs(card, "coded") === false &&
    card.currentStorageType === "coded",
} as const;

const cardModCarrierwave: DeckoModManifest = {
  name: "carrierwave",
  gemName: "card-mod-carrierwave",
  group: "gem-defaults",
  setModules: [
    {
    setPath: "type/file",
    events: [
      engineOwnedEvent({ event: "store_file_event", at: "finalize", when: "store_file_event?" }),
      event({ event: "remove_file_event", at: "finalize", on: ["delete"], when: "no_history?" }),
      event({ event: "mark_remove_file_false_event", at: "finalize", on: ["update"] }),
      event({ event: "reset_previous_changes_for_file_event", at: "finalize", when: "no_history?" }),
      event({ event: "remove_previously_stored_file_event", at: "finalize", on: ["update"], when: "no_history?" }),
    ],
      formats: {
        html: {
          views: [
            { view: "source", viewFn: polymorphicSourceView },
            { view: "core", viewFn: polymorphicCoreView },
            { view: "input", viewFn: fileInputView },
            {
              view: "preview_editor",
              viewFn: filePreviewEditorView,
              config: { unknown: true, cache: "never" },
            },
          ],
        },
      },
    },

    {
      setPath: "type/image",
      events: [
        engineOwnedEvent({ event: "store_image_event", at: "finalize", when: "store_image_event?" }),
        event({ event: "remove_image_event", at: "finalize", on: ["delete"], when: "no_history?" }),
        event({ event: "mark_remove_image_false_event", at: "finalize", on: ["update"] }),
        event({ event: "reset_previous_changes_for_image_event", at: "finalize", when: "no_history?" }),
        event({ event: "remove_previously_stored_image_event", at: "finalize", on: ["update"], when: "no_history?" }),
      ],
      formats: {
        html: {
          views: [
            { view: "source", viewFn: polymorphicSourceView, config: { unknown: "blank" } },
            { view: "inline", viewFn: imageInlineView },
            { view: "one_line_content", viewFn: imageOneLineContentView },
          ],
        },
      },
    },

    {
      setPath: "type/image/html_views",
      formats: {
        html: {
          views: [
            { view: "core", viewFn: polymorphicCoreView },
            { view: "full_width", viewFn: imageHtmlFullWidthView },
            { view: "content_changes", viewFn: imageHtmlContentChangesView },
          ],
        },
      },
    },

    {
      setPath: "self/favicon",
      formats: {
        html: {
          views: [
            { view: "source", viewFn: polymorphicSourceView },
            {
              view: "link_tag",
              viewFn: faviconLinkTagView,
              config: { perms: "none" },
            },
          ],
        },
      },
    },

    {
      setPath: "self/search",
      formats: {
        json: {
          views: [
            {
              view: "image_complete",
              viewFn: searchJsonImageCompleteView,
              config: { cache: "never" },
            },
          ],
        },
      },
    },

    { setPath: "self/new_file" },

    { setPath: "self/new_image" },

    {
      setPath: "self/admin",
      basketTasks: [
        {
          task: "delete_upload_tmp_files",
          mod: "carrierwave",
          linkText: "Delete upload tmp files",
          description: "Delete upload tmp files!",
        },
      ],
    },

    {
      setPath: "abstract/attachment",
      events: [
        event({ event: "select_file_revision", after: "select_action" }),
        engineOwnedEvent({ event: "correct_identifier", at: "finalize", on: ["save"], when: "incorrect_identifier?" }),
        engineOwnedEvent({ event: "save_original_filename", at: "prepare_to_store", on: ["save"], when: "file_ready_to_save?" }),
        engineOwnedEvent({ event: "validate_file_exist", at: "validate", on: ["create"], skip: "allowed" }),
        engineOwnedEvent({ event: "write_identifier", after: "save_original_filename", when: "write_identifier?" }),
      ],
    },
    {
      setPath: "abstract/attachment/00_upload_cache",
      events: [
        engineOwnedEvent({ event: "prepare_attachment", at: "prepare_to_validate", on: ["save"], when: "preliminary_upload?" }),
        engineOwnedEvent({ event: "assign_attachment_on_create", at: "initialize", after: "assign_action", on: ["create"], when: "save_preliminary_upload?" }),
        engineOwnedEvent({ event: "assign_attachment_on_update", at: "initialize", after: "assign_action", on: ["update"], when: "save_preliminary_upload?" }),
        engineOwnedEvent({ event: "delete_cached_upload_file_on_create", at: "integrate", on: ["create"], when: "save_preliminary_upload?" }),
        event({ event: "clear_draft_files", at: "integrate_with_delay", priority: 100, on: ["create"] }),
        engineOwnedEvent({ event: "delete_cached_upload_file_on_update", at: "integrate", on: ["update"], when: "save_preliminary_upload?" }),
      ],
    },
    {
      setPath: "abstract/attachment/01_storage_type",
      events: [
        event({ event: "update_storage", at: "store", on: ["update"], when: "storage_changed?" }),
        event({ event: "validate_storage_type", at: "validate", on: ["save"], fn: validateStorageTypeFn }),
      ],
    },
    {
      setPath: "abstract/attachment/cloud",
      events: [
        event({ event: "change_bucket_if_read_only", at: "initialize", on: ["update"], when: "change_bucket_if_read_only?" }),
      ],
    },
    {
      setPath: "abstract/attachment/coded",
      events: [
        event({ event: "uncode_attachment_storage", at: "initialize", on: ["update"], when: "uncode?" }),
        event({ event: "validate_coded_storage_type", at: "validate", on: ["save"], when: "coded?" }),
      ],
    },
    {
      setPath: "abstract/attachment/local",
      events: [
        event({ event: "update_public_link_on_create", at: "integrate", on: ["create"], when: "local?" }),
        event({ event: "remove_public_link_on_delete", at: "integrate", on: ["delete"], when: "local?" }),
        event({ event: "update_public_link", after: "update_read_rule", when: "local?" }),
      ],
    },
    { setPath: "abstract/attachment/paths" },
    { setPath: "abstract/attachment/web" },
    { setPath: "all/file_utils" },
  ],
};

export default cardModCarrierwave;
export {
  contextualizePath,
  storageTypeFromContent,
  fileCoreView,
  imageHtmlCoreView,
  imageHtmlFullWidthView,
  imageHtmlPreviewView,
  imageHtmlContentChangesView,
  imageOneLineContentView,
  faviconLinkTagView,
  searchJsonImageCompleteView,
  FAVICON_RAW_HELP_TEXT,
  fileInputView,
  imageInputView,
  filePreviewEditorView,
  numberToHumanSize,
};
