import { DeckoName } from "../../name.js";
import type { ModEngineHost } from "../mod-manifest.js";

export interface AdminRuntimeConfig {
  performDeliveries: boolean;

  allowIrreversibleAdminTasks: boolean;
}

const DEFAULT_ADMIN_RUNTIME_CONFIG: AdminRuntimeConfig = {
  performDeliveries: false,
  allowIrreversibleAdminTasks: false,
};

let adminRuntimeConfigState: AdminRuntimeConfig = {
  ...DEFAULT_ADMIN_RUNTIME_CONFIG,
};

export function adminRuntimeConfig(): AdminRuntimeConfig {
  return adminRuntimeConfigState;
}

export function setAdminRuntimeConfig(
  patch: Partial<AdminRuntimeConfig>,
): void {
  adminRuntimeConfigState = { ...adminRuntimeConfigState, ...patch };
}

export function resetAdminRuntimeConfig(): void {
  adminRuntimeConfigState = { ...DEFAULT_ADMIN_RUNTIME_CONFIG };
}

export const CORE_ADMIN_LOCALE = {
  core_task_empty_trash_link_text: "Empty Trash",
  core_task_empty_trash_description: "Empty Trash!",
  core_task_clear_cache_link_text: "Clear Cache",
  core_task_clear_cache_description: "Clear Cache!",
  core_task_regenerate_assets_link_text: "Regenerate Assets",
  core_task_regenerate_assets_description: "Regen!",
  carrierwave_task_delete_upload_tmp_files_link_text: "Delete upload tmp files",
  carrierwave_task_delete_upload_tmp_files_description: "Delete upload tmp files!",
  core_admin_warn: "Administrator Warning",
  core_admin_email_off:
    "Email delivery is turned off. Change settings in %{path} to send sign up notifications.",
} as const;

export interface AdminTaskConfig {
  mod: string;
  irreversible?: boolean;
  executePolicy?: () => void;
  linkText?: string;
  description?: string;
}

export const CORE_TASK_BASKET: Record<string, AdminTaskConfig> = {
  empty_trash: {
    mod: "core",
    irreversible: true,
    executePolicy: () => undefined,
  },
  clear_cache: {
    mod: "core",
    executePolicy: () => undefined,
  },
  regenerate_assets: {
    mod: "core",
    executePolicy: () => undefined,
  },
  delete_upload_tmp_files: {
    mod: "carrierwave",
    executePolicy: () => undefined,
  },
};

export const CORE_WARNING_BASKET = ["no_email_delivery"] as const;

export const CONFIG_TITLE: Record<string, string> = {
  basic: "Basic configuration",
  editor: "Editor configuration",
};

export function adminItemTitle(category: string, subcategory?: string): string {
  const key = (subcategory ?? category).toString();
  return CONFIG_TITLE[key] ?? capitalize(key);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type AdminConfigValue = string;
export interface AdminConfig {
  [category: string]:
    | AdminConfigValue[]
    | { [subcategory: string]: AdminConfigValue[] };
}

export const ADMIN_CONFIG: Record<string, AdminConfig> = {
  core: {
    cardtypes: { admin: ["mod", "user", "setting", "cardtype"] },
    tasks: ["empty_trash", "clear_cash", "regenerate_assets"],
  },
  account: { cardtypes: { admin: ["role", "signup"] } },
  ace_editor: { configurations: { editor: ["ace"] } },
  bar_and_box: {
    views: ["box", "bar", "mini_bar", "closed", "open", "one_line_content"],
  },
  bootstrap: {
    cardtypes: { styling: ["bootswatch_skin"] },
    views: ["carousel"],
  },
  carrierwave: { cardtypes: { upload: ["file", "image"] } },
  content: { settings: ["structure", "default"] },
  date: { cardtypes: { data: ["date"] } },
  defaults: {
    configurations: { basic: ["home", "main_menu", "getting_started_links"] },
  },
  edit: {
    settings: ["input_type"],
    views: ["edit_form", "edit_inline", "edit_name", "edit_type", "board"],
  },
  email: { cardtypes: { template: ["email_template"] } },
  follow: {
    settings: ["follow_fields", "follow"],
    cardtypes: { template: ["notification_template"] },
  },
  format: {
    configurations: { basic: ["title", "head", "credit"] },
    cardtypes: {
      text: ["basic", "plain_text", "html", "phrase"],
      scripting: ["json"],
      data: ["number", "toggle", "uri"],
    },
    views: [
      "name",
      "link",
      "url_link",
      "content",
      "short_content",
      "core",
      "raw",
      "titled",
      "labeled",
      "smart_label",
      "title",
      "title_link",
    ],
  },
  help: { settings: ["help", "guide"], views: ["help", "guide", "lead"] },
  history: { views: ["creator_credit", "updated_by"] },
  integrate: { settings: ["on_create", "on_update", "on_delete"] },
  layout: {
    settings: ["layout", "head"],
    cardtypes: { styling: ["layout_type"] },
    views: ["modal_link"],
  },
  list: {
    settings: ["content_options", "content_option_view"],
    cardtypes: { organize: ["list", "pointer", "nest_list", "link_list"] },
  },
  permissions: { settings: ["create", "read", "update", "delete"] },
  recaptcha: {
    configurations: { basic: ["recaptcha_settings"] },
    settings: ["captcha"],
  },
  script: {
    settings: ["script"],
    cardtypes: {
      scripting: ["java_script", "coffee_script"],
      assets: [
        "local_script_folder_group",
        "local_script_manifest_group",
      ],
    },
  },
  search: { settings: ["script"], cardtypes: { organize: ["search_type"] } },
  session: { cardtypes: { admin: ["session"] } },
  style: {
    settings: ["style"],
    cardtypes: {
      assets: ["local_style_folder_group", "local_style_manifest_group"],
      styling: ["css", "scss", "skin"],
    },
  },
  tinymce_editor: { configurations: { editor: ["tiny_mce"] } },
};

export interface ModSpec {
  gem: string;
  version: string;
  summary: string;
  description: string;
  deps: string[];
}

export const MOD_SPEC_SHARED = {
  authors: ["Ethan McCutchen", "Philipp Kühl", "Gerry Gleason"],
  email: ["info@decko.org"],
  homepage: "https://decko.org",
  files: [] as string[],
};

export const CARD_GEM_SPEC = {
  gem: "card",
  version: "1.110.0",
  summary: "a simple engine for emergent data structures",
  description:
    'Cards are wiki-inspired data atoms.Card "Sharks" use links, nests, types, patterned names, queries, views, events, and rules to create rich structures.',
  deps: [] as string[],
};

export const MOD_SPECS: Record<string, ModSpec> = {
  account: {
    gem: "card-mod-account",
    version: "0.20.0",
    summary: "Email-based account handling for decko cards",
    description: "",
    deps: ["card", "card-mod-email", "card-mod-permissions", "card-mod-list", "card-mod-integrate", "card-mod-edit"],
  },
  ace_editor: {
    gem: "card-mod-ace_editor",
    version: "0.20.0",
    summary: "Ace editor",
    description: "",
    deps: ["card", "card-mod-edit", "card-mod-script"],
  },
  api_key: {
    gem: "card-mod-api_key",
    version: "0.20.0",
    summary: "API Keys and JWT Tokens for Decko",
    description: "",
    deps: ["card", "card-mod-account"],
  },
  assets: {
    gem: "card-mod-assets",
    version: "0.20.0",
    summary: "decko asset pipeline",
    description: "",
    deps: ["card", "execjs", "card-mod-virtual", "card-mod-format", "card-mod-list", "card-mod-carrierwave", "card-mod-content"],
  },
  bar_and_box: {
    gem: "card-mod-bar_and_box",
    version: "0.20.0",
    summary: "bar and box views",
    description: "",
    deps: ["card", "card-mod-style"],
  },
  bootstrap: {
    gem: "card-mod-bootstrap",
    version: "0.20.0",
    summary: "Bootstrap",
    description: "",
    deps: ["card", "card-mod-edit", "card-mod-bar_and_box", "card-mod-style", "card-mod-script"],
  },
  carrierwave: {
    gem: "card-mod-carrierwave",
    version: "0.20.0",
    summary: "File and Image handling",
    description: "",
    deps: ["card", "carrierwave", "mini_magick", "ssrf_filter", "marcel", "card-mod-history", "card-mod-permissions"],
  },
  collection: {
    gem: "card-mod-collection",
    version: "0.20.0",
    summary: "collection (list and search)",
    description: "",
    deps: ["card"],
  },
  comment: {
    gem: "card-mod-comment",
    version: "0.20.0",
    summary: "card comments",
    description: "",
    deps: ["card", "card-mod-permissions"],
  },
  content: {
    gem: "card-mod-content",
    version: "0.20.0",
    summary: "card content handling",
    description: "",
    deps: ["card"],
  },
  date: {
    gem: "card-mod-date",
    version: "0.20.0",
    summary: "Calendar editor",
    description: "",
    deps: ["card"],
  },
  defaults: {
    gem: "card-mod-defaults",
    version: "0.20.0",
    summary: "Default decko mods",
    description: "",
    deps: [
      "card", "card-mod-account", "card-mod-ace_editor", "card-mod-api_key",
      "card-mod-assets", "card-mod-bar_and_box", "card-mod-bootstrap",
      "card-mod-carrierwave", "card-mod-comment", "card-mod-date",
      "card-mod-delayed_job", "card-mod-follow", "card-mod-help",
      "card-mod-history", "card-mod-integrate", "card-mod-layout",
      "card-mod-list", "card-mod-markdown", "card-mod-permissions",
      "card-mod-recaptcha", "card-mod-rules", "card-mod-search",
      "card-mod-tabs", "card-mod-tinymce_editor",
    ],
  },
  delayed_job: {
    gem: "card-mod-delayed_job",
    version: "0.20.0",
    summary: "Background processing with Delayed Job",
    description: "",
    deps: ["card", "daemons", "delayed_job_active_record", "delayed_job_web"],
  },
  edit: {
    gem: "card-mod-edit",
    version: "0.20.0",
    summary: "Edit handling",
    description: "",
    deps: ["card", "card-mod-list", "card-mod-rules"],
  },
  email: {
    gem: "card-mod-email",
    version: "0.20.0",
    summary: "Email handling",
    description: "",
    deps: ["card", "card-mod-search", "card-mod-list", "card-mod-permissions"],
  },
  follow: {
    gem: "card-mod-follow",
    version: "0.20.0",
    summary: "follower notifications",
    description: "",
    deps: ["card", "card-mod-carrierwave"],
  },
  format: {
    gem: "card-mod-format",
    version: "0.20.0",
    summary: "format",
    description: "",
    deps: ["card", "card-mod-content"],
  },
  help: {
    gem: "card-mod-help",
    version: "0.20.0",
    summary: "card help text and guides",
    description: "",
    deps: ["card", "card-mod-markdown", "card-mod-permissions"],
  },
  history: {
    gem: "card-mod-history",
    version: "0.20.0",
    summary: "Revision histories in acts, actions, and changes",
    description: "",
    deps: ["card"],
  },
  integrate: {
    gem: "card-mod-integrate",
    version: "0.20.0",
    summary: "card configurable integration events",
    description: "",
    deps: ["card", "card-mod-rules"],
  },
  layout: {
    gem: "card-mod-layout",
    version: "0.20.0",
    summary: "decko layouts",
    description: "",
    deps: ["card", "card-mod-account", "card-mod-session", "card-mod-tabs"],
  },
  list: {
    gem: "card-mod-list",
    version: "0.20.0",
    summary: "list of cards",
    description: "",
    deps: ["card", "card-mod-format", "card-mod-collection"],
  },
  markdown: {
    gem: "card-mod-markdown",
    version: "0.20.0",
    summary: "markdown support for decko",
    description: "use markdown in decko card content",
    deps: ["card", "kramdown", "kramdown-syntax-coderay"],
  },
  permissions: {
    gem: "card-mod-permissions",
    version: "0.20.0",
    summary: "decko permissions",
    description: "",
    deps: ["card"],
  },
  recaptcha: {
    gem: "card-mod-recaptcha",
    version: "0.20.0",
    summary: "recaptcha support for decko",
    description: "",
    deps: ["card", "recaptcha"],
  },
  rules: {
    gem: "card-mod-rules",
    version: "0.20.0",
    summary: "rules",
    description: "",
    deps: ["card", "card-mod-format", "card-mod-search"],
  },
  script: {
    gem: "card-mod-script",
    version: "0.20.0",
    summary: "JavaScript, CoffeeScript, etc.",
    description: "",
    deps: ["card", "card-mod-assets", "card-mod-list"],
  },
  search: {
    gem: "card-mod-search",
    version: "0.20.0",
    summary: "search",
    description: "",
    deps: ["card", "card-mod-collection", "card-mod-format", "card-mod-help"],
  },
  session: {
    gem: "card-mod-session",
    version: "0.20.0",
    summary: "session",
    description: "",
    deps: ["card", "card-mod-list"],
  },
  style: {
    gem: "card-mod-style",
    version: "0.20.0",
    summary: "Skins, CSS, SCSS, etc",
    description: "",
    deps: ["card", "card-mod-assets", "card-mod-list"],
  },
  tabs: {
    gem: "card-mod-tabs",
    version: "0.20.0",
    summary: "tabs",
    description: "",
    deps: ["card", "card-mod-bootstrap"],
  },
  tinymce_editor: {
    gem: "card-mod-tinymce_editor",
    version: "0.20.0",
    summary: "TinyMCE editor",
    description: "",
    deps: ["card", "card-mod-edit"],
  },
  virtual: {
    gem: "card-mod-virtual",
    version: "0.20.0",
    summary: "virtual",
    description: "",
    deps: ["card"],
  },
};

export const MOD_DESCRIPTION_KEYS: Record<string, string> = {
  format: "Format mod",
};

export function modDescription(modname: string): string | undefined {
  const localeKey = MOD_DESCRIPTION_KEYS[modname];
  if (localeKey !== undefined) return localeKey;
  const spec = MOD_SPECS[modname];
  if (spec === undefined) return undefined;
  if (spec.description.length > 0) return spec.description;
  return spec.summary;
}

export type ModAssetGroup = readonly [title: string, items: readonly string[]];

const MOD_ASSET_GROUPS_SRC: Readonly<
  Record<string, { styles?: ModAssetGroup[]; scripts?: ModAssetGroup[] }>
> = {
  account: {
    styles: [["group: local", ["account.scss"]]],
    scripts: [["group: local", ["toggle_visibility.js.coffee"]]],
  },
  ace_editor: {
    scripts: [
      ["group: remote", ["https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js"]],
      ["group: ace_config", ["decko_ace_config.js.coffee"]],
    ],
  },
  api_key: { styles: [["group: local", ["api_key_style.scss"]]] },
  bar_and_box: {
    styles: [["group: local", ["bar.scss", "box.scss", "image_box.scss"]]],
    scripts: [["group: local", ["bar_and_box.js.coffee", "click_select.js.coffee"]]],
  },
  bootstrap: {
    styles: [
      ["group: remote", ["https://fonts.googleapis.com/css2?family=Material+Icons"]],
      ["group: bootstrap_decko", ["decko_bootstrap.scss"]],
      [
        "group: libraries",
        ["bootstrap-icons.css", "bootstrap_colorpicker.scss", "_colorpicker.scss"],
      ],
      [
        "group: select2",
        [
          "select2.css",
          "_variables.scss",
          "_layout.scss",
          "_dropdown.scss",
          "_single.scss",
          "_multiple.scss",
          "_disabled.scss",
          "_input-group.scss",
          "_validation.scss",
          "_sizing.scss",
        ],
      ],
    ],
    scripts: [
      [
        "group: remote",
        [
          "https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.1/js/select2.full.min.js",
          "https://kit.fontawesome.com/1366963381.js",
        ],
      ],
      [
        "group: bootstrap",
        [
          "bootstrap.bundle.js",
          "decko_modal.js.coffee",
          "decko_popover.js.coffee",
          "script_load_select2.js.coffee",
          "bootstrap-colorpicker.min.js",
          "script_colorpicker.js.coffee",
        ],
      ],
    ],
  },
  carrierwave: {
    styles: [["group: local", ["file.scss"]]],
    scripts: [["group: local", ["upload.js.coffee"]]],
  },
  comment: { styles: [["group: local", ["comments.scss"]]] },
  edit: {
    styles: [["group: local", ["board.scss", "edit.scss"]]],
    scripts: [
      [
        "group: local",
        [
          "autosave.js.coffee",
          "board.js.coffee",
          "components.js.coffee",
          "doubleclick.js.coffee",
          "editor.js.coffee",
          "name_editor.js.coffee",
          "tooltip.js.coffee",
          "type_editor.js.coffee",
        ],
      ],
    ],
  },
  follow: {
    styles: [["group: local", ["follow.scss"]]],
    scripts: [["group: local", ["follow.js.coffee"]]],
  },
  format: {
    styles: [
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
    scripts: [
      [
        "group: remote",
        [
          "https://code.jquery.com/jquery-3.5.1.min.js",
          "https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js",
        ],
      ],
      [
        "group: jquery",
        [
          "jquery-ui.min.js",
          "jquery.ui.autocomplete.html.js",
          "jquery.autosize.js",
          "jquery.fileupload.js",
          "jquery.iframe-transport.js",
        ],
      ],
      [
        "group: decko",
        [
          "decko.js.coffee",
          "decko_jquery.js.coffee",
          "slot.js.coffee",
          "slotter.js.coffee",
          "slot_ready.js.coffee",
          "clicks_and_hovers.js.coffee",
        ],
      ],
    ],
  },
  help: { styles: [["group: local", ["help.scss"]]] },
  history: { styles: [["group: local", ["history.scss"]]] },
  layout: {
    styles: [["group: local", ["layout.scss", "modal.scss", "overlay.scss"]]],
    scripts: [["group: local", ["layout.js.coffee", "modal.js.coffee", "overlay.js.coffee"]]],
  },
  list: {
    styles: [["group: local", ["list.scss"]]],
    scripts: [["group: local", ["pointer_config.js.coffee", "pointer_list_editor.js.coffee"]]],
  },
  permissions: { styles: [["group: local", ["permissions.scss"]]] },
  recaptcha: { scripts: [["group: local", ["recaptcha.js.coffee"]]] },
  rules: {
    styles: [["group: local", ["rules.scss"]]],
    scripts: [["group: local", ["rules.js.coffee"]]],
  },
  search: {
    styles: [["group: local", ["search.scss"]]],
    scripts: [["group: local", ["autocomplete.js.coffee", "search_box.js.coffee"]]],
  },
  style: {
    styles: [["group: local", ["jquery_ui_decko.scss", "jquery_ui_smoothness.css"]]],
  },
  tabs: { scripts: [["group: local", ["tab.js.coffee"]]] },
  tinymce_editor: {
    styles: [["group: local", ["nest_editor.scss"]]],
    scripts: [
      [
        "group: local",
        [
          "image_editor.js.coffee",
          "link_editor.js.coffee",
          "nest_editor.js.coffee",
          "nest_editor_name.js.coffee",
          "nest_editor_options.js.coffee",
          "nest_editor_rules.js.coffee",
          "script_tinymce.js",
          "tinymce_config.js.coffee",
        ],
      ],
    ],
  },
};

export function modAssetGroups(
  modname: string,
  subpath: "style" | "script",
): readonly ModAssetGroup[] | undefined {
  return subpath === "style"
    ? MOD_ASSET_GROUPS_SRC[modname]?.styles
    : MOD_ASSET_GROUPS_SRC[modname]?.scripts;
}

const MOD_CHILD_ASSET_GROUPS_SRC: Readonly<
  Record<string, readonly ModAssetGroup[]>
> = {
  "tinymce_editor/script": [
    [
      "group: local",
      [
        "image_editor.js.coffee",
        "link_editor.js.coffee",
        "nest_editor.js.coffee",
        "nest_editor_name.js.coffee",
        "nest_editor_options.js.coffee",
        "nest_editor_rules.js.coffee",
        "script_tinymce.js",
        "tinymce_config.js.coffee",
      ],
    ],
  ],
  "tinymce_editor/style": [["group: local", ["nest_editor.scss"]]],
};

export function modChildAssetGroups(
  modname: string,
  subpath: "style" | "script",
): readonly ModAssetGroup[] | undefined {
  const parent = modAssetGroups(modname, subpath);
  if (parent !== undefined) return parent;
  return MOD_CHILD_ASSET_GROUPS_SRC[`${modname}/${subpath}`];
}

const MOD_BAR_RIGHT_ASSETS: Readonly<Record<string, { scripts?: boolean; styles?: boolean }>> = {
  account: { scripts: true, styles: true },
  ace_editor: { scripts: true },
  api_key: { styles: true },
  bar_and_box: { scripts: true, styles: true },
  bootstrap: { scripts: true, styles: true },
  carrierwave: { scripts: true, styles: true },
  comment: { styles: true },
  content: {},
  core: {},
  date: {},
  defaults: {},
  edit: { scripts: true, styles: true },
  email: {},
  follow: { scripts: true, styles: true },
  format: { scripts: true, styles: true },
  help: { styles: true },
  history: { styles: true },
  integrate: {},
  layout: { scripts: true, styles: true },
  list: { scripts: true, styles: true },
  permissions: { styles: true },
  recaptcha: { scripts: true },
  rules: { scripts: true, styles: true },
  script: {},
  search: { scripts: true, styles: true },
  session: {},
  shades: { scripts: true },
  style: { styles: true },
  tabs: { scripts: true },
  tinymce_editor: { scripts: true, styles: true },
};

export function modBarRightSections(modname: string): string {
  const config = ADMIN_CONFIG[modname];
  const assets = MOD_BAR_RIGHT_ASSETS[modname] ?? {};
  const sections: string[] = [];
  if (Object.values(CORE_TASK_BASKET).some((t) => t.mod === modname)) sections.push("tasks");
  if (config?.settings !== undefined) sections.push("settings");
  if (config?.configurations !== undefined) sections.push("configurations");
  if (config?.cardtypes !== undefined) sections.push("cardtypes");
  if (assets.scripts === true) sections.push("scripts");
  if (assets.styles === true) sections.push("styles");
  return sections.join(", ");
}

export interface AdminRuntimeState {
  readonly codenameToName: Map<string, string>;
  readonly rolesByCardCodename: Map<string, string[]>;
  readonly modCards: Array<{ name: string; codename: string }>;
}

const runtimeStates = new WeakMap<ModEngineHost, AdminRuntimeState>();

export function adminRuntimeState(
  host: ModEngineHost,
): AdminRuntimeState | undefined {
  return runtimeStates.get(host);
}

interface BatchRows {
  rows: Array<Record<string, unknown>>;
}

function rowsOf(results: unknown[], index: number): Array<Record<string, unknown>> {
  const entry = results[index] as BatchRows | undefined;
  return entry?.rows ?? [];
}

export async function prepareAdminRuntime(host: ModEngineHost): Promise<void> {
  await host.codenames.ensureLoaded();
  const selfId = host.codenames.peekId("self");
  const starId = host.codenames.peekId("star");
  const typePatternId = host.codenames.peekId("type");
  const allId = host.codenames.peekId("all");
  const updateId = host.codenames.peekId("update");
  const modTypeId = host.codenames.peekId("mod");

  const codenameRows = await host.batch([
    {
      sql: "SELECT * FROM cards WHERE trash = 0 AND codename IS NOT NULL",
      params: [],
    },
  ]);
  const codenameRowList = rowsOf(codenameRows, 0);
  const composedCodenameRecords = (await host.composeAndCacheRows(
    codenameRowList,
  )) as Array<{ id?: number; name?: { s: string } }>;
  const composedById = new Map<number, { name?: { s: string } }>();
  for (const record of composedCodenameRecords) {
    if (record.id !== undefined) composedById.set(record.id, record);
  }
  const codenameRecords: Array<{
    id: number;
    codename: string;
    name: string;
  }> = [];
  for (const row of codenameRowList) {
    const id = row.id as number;
    const codename = row.codename as string;
    const record = composedById.get(id);
    if (record?.name?.s === undefined) continue;
    codenameRecords.push({ id, codename, name: record.name.s });
  }

  const modCards: AdminRuntimeState["modCards"] = [];
  if (modTypeId !== undefined) {
    const modRows = await host.batch([
      {
        sql: "SELECT id, codename FROM cards WHERE trash = 0 AND type_id = ?",
        params: [modTypeId],
      },
    ]);
    for (const row of rowsOf(modRows, 0)) {
      const record = await host.fetchById(row.id as number);
      if (record?.name?.s === undefined) continue;
      await host.cacheFetchedRecord(record);
      const codename = row.codename;
      modCards.push({
        name: record.name.s,
        codename:
          typeof codename === "string" && codename !== ""
            ? codename
            : nameToCodename(record.name.s),
      });
    }
  }

  const rulesByCardId = new Map<number, string>();
  if (selfId !== undefined && updateId !== undefined) {
    const selfRules = await host.batch([
      {
        sql:
          "SELECT c.id AS card_id, r.db_content AS rule_content " +
          "FROM cards c " +
          "JOIN cards s ON s.left_id = c.id AND s.right_id = ? AND s.trash = 0 " +
          "JOIN cards r ON r.left_id = s.id AND r.right_id = ? AND r.trash = 0 " +
          "WHERE c.trash = 0 AND c.codename IS NOT NULL",
        params: [selfId, updateId],
      },
    ]);
    for (const row of rowsOf(selfRules, 0)) {
      rulesByCardId.set(row.card_id as number, (row.rule_content as string) ?? "");
    }
  }
  if (starId !== undefined && updateId !== undefined) {
    const starRules = await host.batch([
      {
        sql:
          "SELECT r.db_content AS rule_content " +
          "FROM cards r " +
          "WHERE r.trash = 0 AND r.left_id = ? AND r.right_id = ?",
        params: [starId, updateId],
      },
    ]);
    const starContent = rowsOf(starRules, 0)[0]?.rule_content as string | undefined;
    if (starContent !== undefined) {
      for (const record of codenameRecords) {
        if (rulesByCardId.has(record.id)) continue;
        if (!DeckoName.parse(record.name).isStar) continue;
        rulesByCardId.set(record.id, starContent);
      }
    }
  }
  if (typePatternId !== undefined && updateId !== undefined) {
    const typeRules = await host.batch([
      {
        sql:
          "SELECT c.id AS card_id, r.db_content AS rule_content " +
          "FROM cards c " +
          "JOIN cards s ON s.left_id = c.type_id AND s.right_id = ? AND s.trash = 0 " +
          "JOIN cards r ON r.left_id = s.id AND r.right_id = ? AND r.trash = 0 " +
          "WHERE c.trash = 0 AND c.codename IS NOT NULL",
        params: [typePatternId, updateId],
      },
    ]);
    for (const row of rowsOf(typeRules, 0)) {
      const cardId = row.card_id as number;
      if (!rulesByCardId.has(cardId)) {
        rulesByCardId.set(cardId, (row.rule_content as string) ?? "");
      }
    }
  }
  if (allId !== undefined && updateId !== undefined) {
    const allRules = await host.batch([
      {
        sql:
          "SELECT r.db_content AS rule_content " +
          "FROM cards r " +
          "WHERE r.trash = 0 AND r.left_id = ? AND r.right_id = ?",
        params: [allId, updateId],
      },
    ]);
    const allContent = rowsOf(allRules, 0)[0]?.rule_content as string | undefined;
    if (allContent !== undefined) {
      for (const record of codenameRecords) {
        if (!rulesByCardId.has(record.id)) {
          rulesByCardId.set(record.id, allContent);
        }
      }
    }
  }

  const cardtypeTypeId = host.codenames.peekId("cardtype");
  const settingTypeId = host.codenames.peekId("setting");
  const rightPatternId = host.codenames.peekId("right");
  const rstarId = host.codenames.peekId("rstar");
  const allPlusId = host.codenames.peekId("all_plus");
  if (updateId !== undefined) {
    const anchorlessRule = async (setId: number | undefined): Promise<string | undefined> => {
      if (setId === undefined) return undefined;
      const res = await host.batch([
        {
          sql: "SELECT db_content AS rule_content FROM cards WHERE trash = 0 AND left_id = ? AND right_id = ?",
          params: [setId, updateId],
        },
      ]);
      const row = rowsOf(res, 0)[0];
      return row === undefined ? undefined : ((row.rule_content as string | null) ?? "");
    };
    const scopedRules = async (
      typeId: number | undefined,
      patternId: number | undefined,
    ): Promise<Map<number, string | undefined> | undefined> => {
      if (typeId === undefined || patternId === undefined) return undefined;
      const res = await host.batch([
        {
          sql:
            "SELECT c.id AS card_id, r.db_content AS rule_content " +
            "FROM cards c " +
            "LEFT JOIN cards s ON s.left_id = c.id AND s.right_id = ? AND s.trash = 0 " +
            "LEFT JOIN cards r ON r.left_id = s.id AND r.right_id = ? AND r.trash = 0 " +
            "WHERE c.trash = 0 AND c.codename IS NOT NULL AND c.type_id = ?",
          params: [patternId, updateId, typeId],
        },
      ]);
      const out = new Map<number, string | undefined>();
      for (const row of rowsOf(res, 0)) {
        const cardId = row.card_id as number;
        const content = row.rule_content as string | null | undefined;
        if (content !== null && content !== undefined) out.set(cardId, content);
        else if (!out.has(cardId)) out.set(cardId, undefined);
      }
      return out;
    };
    const applyScoped = (
      scoped: Map<number, string | undefined> | undefined,
      fallback: string | undefined,
    ): void => {
      if (scoped === undefined) return;
      for (const [cardId, content] of scoped) {
        const resolved = content ?? fallback;
        if (resolved !== undefined) rulesByCardId.set(cardId, resolved);
        else rulesByCardId.delete(cardId);
      }
    };
    const allContent = await anchorlessRule(allId);
    applyScoped(await scopedRules(cardtypeTypeId, typePatternId), allContent);
    const settingScoped = await scopedRules(settingTypeId, rightPatternId);
    if (settingScoped !== undefined) {
      const fallback =
        (await anchorlessRule(rstarId)) ?? (await anchorlessRule(allPlusId)) ?? allContent;
      applyScoped(settingScoped, fallback);
    }
  }

  const itemNameKeys = new Set<string>();
  for (const content of rulesByCardId.values()) {
    for (const item of pointerItems(content)) {
      itemNameKeys.add(DeckoName.parse(item).key);
    }
  }
  const codenameByKey = new Map<string, string>();
  if (itemNameKeys.size > 0) {
    const keys = [...itemNameKeys];
    const itemRows = await host.batch([
      {
        sql: `SELECT key, codename FROM cards WHERE trash = 0 AND codename IS NOT NULL AND key IN (${keys.map(() => "?").join(",")})`,
        params: keys,
      },
    ]);
    for (const row of rowsOf(itemRows, 0)) {
      codenameByKey.set(row.key as string, row.codename as string);
    }
  }

  const rolesByCardCodename = new Map<string, string[]>();
  for (const record of codenameRecords) {
    const content = rulesByCardId.get(record.id);
    if (content === undefined) continue;
    const roles: string[] = [];
    for (const item of pointerItems(content)) {
      const codename = codenameByKey.get(DeckoName.parse(item).key);
      if (codename !== undefined) roles.push(codename);
    }
    rolesByCardCodename.set(record.codename, roles);
  }

  runtimeStates.set(host, {
    codenameToName: new Map(
      codenameRecords
        .filter((r) => r.codename !== "")
        .map((r) => [r.codename, r.name]),
    ),
    rolesByCardCodename,
    modCards,
  });
}

function pointerItems(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function nameToCodename(name: string): string {
  return DeckoName.parse(name).key;
}
