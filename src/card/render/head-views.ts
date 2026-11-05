import { h } from "./slot-html.js";
import { attachmentUrl } from "./views.js";
import { mainStylesheetRevisionDigits } from "./deployment-follow-live-config.js";
import type { SQLStatement } from "../../server/driver.js";

export const CLOUD_URL_PREFIX = "http://s3.amazonaws.com//files/";

export interface HeadReadSet {
  titleSetting: string | undefined;
  faviconSource: string | undefined;
  styleAssetOutput: string | undefined;
}

export const HEAD_READ_SET_KEYS = [
  "*title",
  "*favicon",
  "*all+*style",
  "*all+*style+*asset_output",
  "*all+*script",
  "*all+*script+*asset_output",
  "*recent settings",
  "*recent_settings",
  "*recent_setting",
] as const;

export function headViewReadStatement(): SQLStatement {
  const placeholders = HEAD_READ_SET_KEYS.map(() => "?").join(",");
  return {
    sql: `SELECT * FROM cards WHERE key IN (${placeholders}) AND trash = 0`,
    params: [...HEAD_READ_SET_KEYS],
  };
}

export function pageTitleBytes(read: HeadReadSet, safeName: string): string {
  const parts: string[] = [];
  if (safeName !== "") parts.push(safeName);
  if (read.titleSetting !== undefined && read.titleSetting.trim() !== "") {
    parts.push(read.titleSetting);
  }
  return parts.join(" - ");
}

export function pageTitleTagBytes(read: HeadReadSet, safeName: string): string {
  return `<title>${h(pageTitleBytes(read, safeName))}</title>`;
}

export function faviconTagBytes(read: HeadReadSet): string {
  const src = cloudAttachmentUrl(read.faviconSource, "small");
  if (src === undefined) return "";
  return `<link rel="shortcut icon" href="${src}" />`;
}

export function stylesheetTagsBytes(read: HeadReadSet): string {
  return [
    REMOTE_STYLE_TAG,
    `<link media="all" rel="stylesheet" type="text/css" href="${
      applyDeploymentCssRevision(cloudAttachmentUrl(read.styleAssetOutput) ?? "")
    }" />`,
  ].join("\n");
}

export function applyDeploymentCssRevision(url: string): string {
  const digits = mainStylesheetRevisionDigits();
  if (digits === undefined) return url;
  return url.replace(/(\/\d+\/)(\d{10})(\.css)$/, `$1${digits}$3`);
}

export const REMOTE_STYLE_TAG =
  `<link href="https://fonts.googleapis.com/css2?family=Material+Icons" media="all" rel="stylesheet" type="text/css" />`;

export const META_TAGS =
  `<meta charset='UTF-8'>\n<meta content='width=device-width, initial-scale=1.0' name='viewport'>`;

export const HEAD_VIEWS: readonly string[] = [
  "page_title_tag",
  "meta_tags",
  "favicon_tag",
  "stylesheet_tags",
  "universal_edit_button",
  "rss_links",
  "javascript_tags",
  "script_variables",
  "script_calls",
];

export function cloudAttachmentUrl(
  content: string | null | undefined,
  size?: string,
): string | undefined {
  if (content === undefined || content === null) return undefined;
  const variant = size !== undefined && /\.svg\s*$/i.test(content) ? undefined : size;
  const source = attachmentUrl(content, variant);
  if (source === "") return undefined;
  return source;
}
