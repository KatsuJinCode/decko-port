export interface ModCatalogEntry {
  readonly name: string;

  readonly gemName?: string;

  readonly summary: string;

  readonly sourceFile: string;

  readonly sourceLine: number;
}

export const MOD_CATALOG: readonly ModCatalogEntry[] = [
  {
    name: "core",
    gemName: "card-mod-core",
    summary:
      "Decko's own registration layer: the set patterns every other mod registers against, the compiled-in base views, the admin surface (the *admin task table, the settings lists), and the basket the mod contributions register into. In this port core is a composed manifest (default-mod-deck.ts:130), not the compiled-in seed tables it stands in for.",
    sourceFile: "src/card/mod-loader/mods/core-mod.ts",
    sourceLine: 1,
  },
  {
    name: "collection",
    gemName: "card-mod-collection",
    summary:
      "The collection surface: the count and paging views that put a total and page links under a set of cards, plus the Abstract::PagingLinks data structure behind them. Its three declared html views (count, paging, paging_urls) are the ones the engine did not already cover.",
    sourceFile: "src/card/mod-loader/mods/card-mod-collection.ts",
    sourceLine: 1,
  },
  {
    name: "content",
    gemName: "card-mod-content",
    summary:
      "The content editing surface: the +*self+*default and +*structure rule cards, the Abstract::Sources file-content pipeline, the content chunk parsers (nest, link, reference, query-reference, uri, view-stub, escaped-literal), and the three protected input views (code content, haml file, read-only).",
    sourceFile: "src/card/mod-loader/mods/card-mod-content.ts",
    sourceLine: 1,
  },
  {
    name: "format",
    gemName: "card-mod-format",
    summary:
      "The format layer: the base/abstract/html/css/csv/data/file/json/jsonld/js/rss/text/xml/yaml format classes, the name and date and content view families, the path generator, the link-to helpers, and the error / not-found / denial / server-error views. It also carries the two Cardio config keys the engine models as its per-render switches (default_html_view, rss_enabled).",
    sourceFile: "src/card/mod-loader/mods/card-mod-format.ts",
    sourceLine: 3,
  },
  {
    name: "list",
    gemName: "card-mod-list",
    summary:
      "The pointer and list item surface: the editor and one-line views for items inside a list, plus the per-editor helper views. Its html views live in set/abstract/01_list.rb and set/abstract/01_list/html_views.rb.",
    sourceFile: "src/card/mod-loader/mods/card-mod-list.ts",
    sourceLine: 1,
  },
  {
    name: "markdown",
    gemName: "card-mod-markdown",
    summary:
      "The Markdown cardtype: one set file (set/type/markdown.rb) whose :core view runs a card's content through the Markdown renderer, plus the seed card that declares the cardtype. The smallest complete mod in the deck - one cardtype, one view.",
    sourceFile: "src/card/mod-loader/mods/card-mod-markdown.ts",
    sourceLine: 2,
  },
  {
    name: "permissions",
    gemName: "card-mod-permissions",
    summary:
      "The read-permission surface: the rule walk that decides who may read a card, the read-rule and set-read-rule events, and the denial views. Four html views are declared, of which the compat report counts one as already covered by the engine.",
    sourceFile: "src/card/mod-loader/mods/card-mod-permissions.ts",
    sourceLine: 1,
  },
  {
    name: "help",
    gemName: "card-mod-help",
    summary:
      "The help surface: the :help, :help_text and :lead views, the :guide view (which runs a card's content through Markdown), and the *help and *guide settings whose help text people see while editing. The reference port proving the loader mechanism end to end.",
    sourceFile: "src/card/mod-loader/mods/card-mod-help.ts",
    sourceLine: 2,
  },
  {
    name: "search",
    gemName: "card-mod-search",
    summary:
      "The search surface: the CQL-backed semantics behind the count views, the search-family one_line_content override, and the autocomplete item views. Twenty-nine set files, mostly under the right pattern, are where the search params and the per-right search views live.",
    sourceFile: "src/card/mod-loader/mods/card-mod-search.ts",
    sourceLine: 2,
  },
  {
    name: "rules",
    gemName: "card-mod-rules",
    summary:
      "The configuration surface built on rule cards: the rule bar family, the rule editor views, the set card's Rules section, the setting categories, and the cardtype groups. Thirty-two set files, the largest set-module tree in the deck.",
    sourceFile: "src/card/mod-loader/mods/card-mod-rules.ts",
    sourceLine: 5,
  },
  {
    name: "edit",
    gemName: "card-mod-edit",
    summary:
      "The editing surface: the new and edit forms, the edit rules, the type editor, the board, the conflict tracker, and the haml-driven templates. Twenty-one set modules across the all/right/self/type patterns; four of the all/ files are haml template services.",
    sourceFile: "src/card/mod-loader/mods/card-mod-edit.ts",
    sourceLine: 1,
  },
  {
    name: "email",
    gemName: "card-mod-email",
    summary:
      "The email surface: the email-template cardtypes, the email_text and email_html format families, the *to/*from/*cc/*bcc/*subject/*attach right-side settings, and the email-document wrapper that turns an html render into a multipart body.",
    sourceFile: "src/card/mod-loader/mods/card-mod-email.ts",
    sourceLine: 1,
  },
  {
    name: "integrate",
    gemName: "card-mod-integrate",
    summary:
      "The integrate-stage surface: eight set files declaring no html views at all. In Ruby the stage's work is the director's integrate hooks; what the manifest records is the set-module basket those hooks would be reached through.",
    sourceFile: "src/card/mod-loader/mods/card-mod-integrate.ts",
    sourceLine: 1,
  },
  {
    name: "account",
    gemName: "card-mod-account",
    summary:
      "User accounts: signin, signup, the +*account cardtype, password reset, and the related closure lifecycle. Twenty-two set files across six patterns plus six haml templates; most of the gem is Rails-runtime machinery (the validate/encrypt/reset events, the Auth integration).",
    sourceFile: "src/card/mod-loader/mods/card-mod-account.ts",
    sourceLine: 3,
  },
  {
    name: "history",
    gemName: "card-mod-history",
    summary:
      "History tracking: the acts, actions and changes records behind a card's Recent Changes. Eleven set files under set/, twelve lib/ files, one stylesheet, and an admin config. The write side (assign_action, finalize_action, finalize_act, update_ancestor_timestamps, drafts) is ported against this gem's event file.",
    sourceFile: "src/card/mod-loader/mods/card-mod-history.ts",
    sourceLine: 2,
  },
  {
    name: "carrierwave",
    gemName: "card-mod-carrierwave",
    summary:
      "File and image attachments: mounts CarrierWave onto the File and Image sets, wires 24 event hooks (storage-type writes, file deletes, upload-cache lifecycle, public-link symlinks, cloud bucket management), and contributes the admin task table entries the ops basket reads.",
    sourceFile: "src/card/mod-loader/mods/card-mod-carrierwave.ts",
    sourceLine: 3,
  },
  {
    name: "virtual",
    gemName: "card-mod-virtual",
    summary:
      "Virtual-card materialization: the card_virtuals cache, so a virtual card never saves its own row and its content is materialized into a card_virtuals row keyed by (left_id, right_id). One set file, one lib file, no views, no assets.",
    sourceFile: "src/card/mod-loader/mods/card-mod-virtual.ts",
    sourceLine: 1,
  },
  {
    name: "assets",
    gemName: "card-mod-assets",
    summary:
      "The asset pipeline driver: twelve set files (eight abstract, three right, one type), a lib module that boots the pipeline, a haml template, and a manifest.yml transform. The two html views the engine did not already cover are the javascript_include_tag and stylesheet_include_tag helpers.",
    sourceFile: "src/card/mod-loader/mods/card-mod-assets.ts",
    sourceLine: 1,
  },
  {
    name: "script",
    gemName: "card-mod-script",
    summary:
      "The Script cardtype: sixteen set files (seven abstract, one all, one right, one self, four type, two type_plus_right), two lib modules and two config initializers. Its effect is card content - a script card and the input types that edit it.",
    sourceFile: "src/card/mod-loader/mods/card-mod-script.ts",
    sourceLine: 1,
  },
  {
    name: "ace_editor",
    gemName: "card-mod-ace_editor",
    summary:
      "The Ace editor: two set files, no lib, no set_pattern, no events, and zero html views declared. What it contributes is the *ace setting's help text body, which the setting-help-text registry serves.",
    sourceFile: "src/card/mod-loader/mods/card-mod-ace_editor.ts",
    sourceLine: 1,
  },
  {
    name: "api_key",
    gemName: "card-mod-api_key",
    summary:
      "API keys: the *api_key right set's events and methods, plus its mod-specific views - the core/current/token-link/buttons/generate-button family and the json :token view, with the titled/content/titled_content family alongside.",
    sourceFile: "src/card/mod-loader/mods/card-mod-api_key.ts",
    sourceLine: 1,
  },
  {
    name: "style",
    gemName: "card-mod-style",
    summary:
      "The stylesheet and skin surface: the Css, Scss and Skin cardtypes, the *style setting, and the SkinBox abstract. Sixteen set files across four patterns, three validate/delete events, no lib and no set_pattern.",
    sourceFile: "src/card/mod-loader/mods/card-mod-style.ts",
    sourceLine: 2,
  },
  {
    name: "bootstrap",
    gemName: "card-mod-bootstrap",
    summary:
      "The rendering side of the bootstrap skin: eleven set files (four abstract, two all, two self, two type, one type_plus_right) and eleven haml templates, over a lib tree of sixteen files that build the modular bootstrap helper surface the set files consume. It also carries the Bootswatch skin cardtype.",
    sourceFile: "src/card/mod-loader/mods/card-mod-bootstrap.ts",
    sourceLine: 2,
  },
  {
    name: "comment",
    gemName: "card-mod-comment",
    summary:
      "Comments: a comment_box subslot on every card, and a discussion cardtype whose open/open_content/titled/titled_content and core/input views show the comment form after the standard content. Three set files and one seed card.",
    sourceFile: "src/card/mod-loader/mods/card-mod-comment.ts",
    sourceLine: 1,
  },
  {
    name: "date",
    gemName: "card-mod-date",
    summary:
      "The Date cardtype plus the *when created, *when last edited and now virtual cards. Five set files across four patterns; the three set-module content overrides (right/when_created, right/when_last_edited, self/now) are the virtual cards' formatted timestamps.",
    sourceFile: "src/card/mod-loader/mods/card-mod-date.ts",
    sourceLine: 1,
  },
  {
    name: "follow",
    gemName: "card-mod-follow",
    summary:
      "Following and notifications: thirty-two set files, two haml templates and two lib files, overwhelmingly Rails-runtime. The notification pipeline (silence_notifications, notify_followers_after_save, stash_followers, notify_followers_after_delete) drives the director plus the delayed_job hook plus mailer delivery; the follow rule walk uses Card.search and Rule.preference.",
    sourceFile: "src/card/mod-loader/mods/card-mod-follow.ts",
    sourceLine: 2,
  },
  {
    name: "session",
    gemName: "card-mod-session",
    summary:
      "The Session cardtype, whose content lives in the request session hash instead of the database, plus the all-cards location-history bookkeeping behind the previous-page redirect. Two set files, one lib file, one admin config, one seed file.",
    sourceFile: "src/card/mod-loader/mods/card-mod-session.ts",
    sourceLine: 1,
  },
  {
    name: "tabs",
    gemName: "card-mod-tabs",
    summary:
      "Bootstrap tab and pill panels: the lazy-loading :tabs and :pills views every card carries as an all-set registration, plus the static variants under the abstract pattern. Two set files, two lib classes (Card::Tab, Card::LazyTab) and two haml templates.",
    sourceFile: "src/card/mod-loader/mods/card-mod-tabs.ts",
    sourceLine: 1,
  },
  {
    name: "layout",
    gemName: "card-mod-layout",
    summary:
      "Page layouts: the Card::Layout support class, the set/all/process_layout page renderer, and the layout cardtype that carries a layout's body. Twenty-three set files across the abstract/all/right/self/type patterns, three event hooks, and an admin config with no mod.yml - its registration surface is the admin config alone.",
    sourceFile: "src/card/mod-loader/mods/card-mod-layout.ts",
    sourceLine: 4,
  },
  {
    name: "recaptcha",
    gemName: "card-mod-recaptcha",
    summary:
      "The captcha guard: all eight set files the gem's set/ tree ships (one abstract, one all, three right, three self), the one html view the gem declares, and the basket warnings the *admin :warning view walks. Its effect on a save is the :recaptcha validate event - a guard, not card content.",
    sourceFile: "src/card/mod-loader/mods/card-mod-recaptcha.ts",
    sourceLine: 1,
  },
  {
    name: "tinymce_editor",
    gemName: "card-mod-tinymce_editor",
    summary:
      "The TinyMCE editor: eight set-module files, one no-set-module helper, one lib file and ten haml templates, with no events and no set_pattern. It contributes the nested image editor's js-format views (change_create_to_update, open_nest_editor) and the *tinyMCE setting's help text.",
    sourceFile: "src/card/mod-loader/mods/card-mod-tinymce_editor.ts",
    sourceLine: 3,
  },
];

export function catalogEntryFor(modName: string): ModCatalogEntry | undefined {
  return MOD_CATALOG.find((entry) => entry.name === modName);
}
