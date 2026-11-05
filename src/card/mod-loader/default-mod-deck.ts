import type { DeckoModManifest } from "./mod-manifest.js";
import type { ModEngineHost } from "./mod-manifest.js";
import type {
  ModEventPredicateTable,
  ModEventRuntime,
} from "./mod-event-dispatch.js";
import { ModLoader, type ModSource } from "../mod-loader.js";
import { setDefaultModLoader, getDefaultModLoader } from "../mod-loader.js";
import { restoreSetTypeAssignments, snapshotSetTypeAssignments } from "../set-patterns/set-type-assignment.js";
import {
  setDefaultContentOverrideRegistry,
} from "../render/content-overrides.js";
import { setDefaultVirtualCardRegistry } from "../render/virtual-card-registry.js";
import { setDefaultModEventRegistry } from "./mod-event-registry.js";

import coreMod, { coreModEventPredicates } from "./mods/core-mod.js";
import cardModCollection, { collectionModEventPredicates } from "./mods/card-mod-collection.js";
import cardModContent, { contentModEventPredicates } from "./mods/card-mod-content.js";
import cardModFormat from "./mods/card-mod-format.js";
import cardModList, { listModEventPredicates } from "./mods/card-mod-list.js";
import cardModMarkdown from "./mods/card-mod-markdown.js";
import cardModPermissions, { permissionsModEventPredicates } from "./mods/card-mod-permissions.js";
import cardModHelp from "./mods/card-mod-help.js";
import cardModSearch from "./mods/card-mod-search.js";
import cardModRules from "./mods/card-mod-rules.js";
import cardModEdit from "./mods/card-mod-edit.js";
import cardModEmail from "./mods/card-mod-email.js";
import cardModIntegrate from "./mods/card-mod-integrate.js";
import cardModAccount, { accountModEventPredicates } from "./mods/card-mod-account.js";
import cardModHistory, { historyModEventPredicates } from "./mods/card-mod-history.js";
import { registerDeckModEventCardStateSources } from "./mod-event-state-sources.js";
import cardModCarrierwave, { carrierwaveModEventPredicates } from "./mods/card-mod-carrierwave.js";
import cardModVirtual from "./mods/card-mod-virtual.js";
import cardModAssets, { assetsModEventPredicates } from "./mods/card-mod-assets.js";
import cardModScript from "./mods/card-mod-script.js";
import cardModAceEditor from "./mods/card-mod-ace_editor.js";
import cardModApiKey from "./mods/card-mod-api_key.js";
import cardModStyle from "./mods/card-mod-style.js";
import cardModBootstrap from "./mods/card-mod-bootstrap.js";
import cardModComment, { commentModEventPredicates } from "./mods/card-mod-comment.js";
import cardModDate from "./mods/card-mod-date.js";
import cardModFollow, { followModEventPredicates } from "./mods/card-mod-follow.js";
import cardModSession from "./mods/card-mod-session.js";
import cardModTabs from "./mods/card-mod-tabs.js";
import cardModLayout from "./mods/card-mod-layout.js";
import cardModRecaptcha, { recaptchaModEventPredicates } from "./mods/card-mod-recaptcha.js";
import cardModTinymceEditor from "./mods/card-mod-tinymce_editor.js";
import { deckLocalMods, type DeckLocalModName } from "./deployment-deck-local-mods.js";

export const COMPILED_IN_OR_ABSENT_MODS = [
  "bar_and_box",
  "delayed_job",
  "defaults",
] as const;

export const ORACLE_BUNDLE_ORDER: readonly string[] = [
  "core",
  "collection",
  "content",
  "format",
  "list",
  "markdown",
  "permissions",
  "help",
  "search",
  "rules",
  "edit",
  "email",
  "integrate",
  "account",
  "history",
  "carrierwave",
  "virtual",
  "assets",
  "script",
  "ace_editor",
  "api_key",
  "style",
  "bar_and_box",
  "bootstrap",
  "comment",
  "date",
  "delayed_job",
  "follow",
  "session",
  "tabs",
  "layout",
  "recaptcha",
  "tinymce_editor",
  "defaults",
];

const MANIFESTS: Record<string, DeckoModManifest> = {
  core: coreMod,
  collection: cardModCollection,
  content: cardModContent,
  format: cardModFormat,
  list: cardModList,
  markdown: cardModMarkdown,
  permissions: cardModPermissions,
  help: cardModHelp,
  search: cardModSearch,
  rules: cardModRules,
  edit: cardModEdit,
  email: cardModEmail,
  integrate: cardModIntegrate,
  account: cardModAccount,
  history: cardModHistory,
  carrierwave: cardModCarrierwave,
  virtual: cardModVirtual,
  assets: cardModAssets,
  script: cardModScript,
  ace_editor: cardModAceEditor,
  api_key: cardModApiKey,
  style: cardModStyle,
  bootstrap: cardModBootstrap,
  comment: cardModComment,
  date: cardModDate,
  follow: cardModFollow,
  session: cardModSession,
  tabs: cardModTabs,
  layout: cardModLayout,
  recaptcha: cardModRecaptcha,
  tinymce_editor: cardModTinymceEditor,
};

export function portedBundleOrder(): string[] {
  return ORACLE_BUNDLE_ORDER.filter((name) => MANIFESTS[name] !== undefined);
}

export function defaultDeckSources(): ModSource[] {
  return portedBundleOrder().map((name) => ({
    manifest: MANIFESTS[name]!,
  }));
}

const DECK_LOCAL_MANIFESTS: Record<DeckLocalModName, DeckoModManifest> = {};

export function enabledDeckLocalSources(): ModSource[] {
  return deckLocalMods().enabled.map((name) => ({ manifest: DECK_LOCAL_MANIFESTS[name] }));
}

export function defaultDeckLoader(): ModLoader {
  const deckLocal = enabledDeckLocalSources();
  const loader = new ModLoader([...defaultDeckSources(), ...deckLocal]);
  loader.resolveOrder({
    gemMods: portedBundleOrder(),
    ...(deckLocal.length > 0
      ? { deckModDirs: [{ modfile: deckLocal.map((source) => source.manifest.name) }] }
      : {}),
  });
  loader.load();
  setDefaultModLoader(loader);
  setDefaultContentOverrideRegistry(loader.contentOverrideRegistry());
  setDefaultVirtualCardRegistry(loader.virtualCardRegistry());
  setDefaultModEventRegistry(loader.eventRegistry());
  return loader;
}

let eventOnlyLoader: ModLoader | undefined;
function eventOnlyDeckLoader(): ModLoader {
  if (eventOnlyLoader === undefined) {
    const loader = new ModLoader(defaultDeckSources(), {});
    loader.resolveOrder({ gemMods: portedBundleOrder() });
    const assignments = snapshotSetTypeAssignments();
    try {
      loader.load();
    } finally {
      restoreSetTypeAssignments(assignments);
    }
    eventOnlyLoader = loader;
  }
  return eventOnlyLoader;
}

const extraEventPredicates: ModEventPredicateTable[] = [];

export function registerModEventPredicates(table: ModEventPredicateTable): void {
  extraEventPredicates.push(table);
}

export function defaultDeckEventPredicates(): ModEventPredicateTable {
  return {
    ...accountModEventPredicates,
    ...assetsModEventPredicates,
    ...carrierwaveModEventPredicates,
    ...collectionModEventPredicates,
    ...contentModEventPredicates,
    ...coreModEventPredicates,
    ...commentModEventPredicates,
    ...followModEventPredicates,
    ...historyModEventPredicates,
    ...listModEventPredicates,
    ...permissionsModEventPredicates,
    ...recaptchaModEventPredicates,
    ...Object.assign({}, ...extraEventPredicates),
  };
}

export function defaultDeckEventRuntime(host?: ModEngineHost): ModEventRuntime {
  const loader = getDefaultModLoader() ?? eventOnlyDeckLoader();
  registerDeckModEventCardStateSources();
  return {
    registry: loader.eventRegistry(),
    moduleOrder: loader.eventModuleOrder(),
    predicates: defaultDeckEventPredicates(),
    ...(host !== undefined ? { host } : {}),
  };
}
