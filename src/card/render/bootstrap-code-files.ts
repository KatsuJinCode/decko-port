import type { RenderFormat } from "./format.js";
import { edgeAssetSources } from "../../../vendor/edge-bootstrap-scss-snapshot.js";

interface NodeSyncFs {
  readFileSync(path: string | URL, encoding: string): string;
  existsSync?(path: string | URL): boolean;
}

let nodeFsCache: NodeSyncFs | undefined;
function nodeFsOrNull(): NodeSyncFs | undefined {
  if (nodeFsCache !== undefined) return nodeFsCache;
  try {
    const proc = (
      globalThis as unknown as {
        process?: { getBuiltinModule?: (id: string) => unknown };
      }
    ).process;
    const fs = proc?.getBuiltinModule?.("node:fs") as NodeSyncFs | undefined;
    if (fs !== undefined) nodeFsCache = fs;
    return fs ?? undefined;
  } catch {
    return undefined;
  }
}

let bootstrapScssDir: URL | undefined;
function bootstrapScssDirectory(): URL {
  if (bootstrapScssDir !== undefined) return bootstrapScssDir;
  const fromSrc = new URL("fixtures/vendor/bootstrap-scss/", new URL("../../..", import.meta.url));
  const fromDist = new URL("fixtures/vendor/bootstrap-scss/", new URL("../../../..", import.meta.url));
  const fs = nodeFsOrNull();
  bootstrapScssDir =
    fs?.existsSync !== undefined && !fs.existsSync(fromSrc) && fs.existsSync(fromDist) ? fromDist : fromSrc;
  return bootstrapScssDir;
}

const BOOTSTRAP_MIXIN_STYLESHEETS = [
  "deprecate", "breakpoints", "color-scheme", "image", "resize",
  "visually-hidden", "reset-text", "text-truncate", "utilities", "alert",
  "backdrop", "buttons", "caret", "pagination", "lists", "list-group",
  "forms", "table-variants", "border-radius", "box-shadow", "gradients",
  "transition", "clearfix", "container", "grid",
] as const;

const BOOTSTRAP_MAIN_STYLESHEETS = [
  "utilities", "root", "reboot", "type", "images", "containers", "grid",
  "tables",
] as const;

const BOOTSTRAP_FORM_STYLESHEETS = [
  "labels", "form-text", "form-control", "form-select", "form-check",
  "form-range", "floating-labels", "input-group", "validation",
] as const;

const BOOTSTRAP_AFTER_FORM_STYLESHEETS = [
  "buttons", "transitions", "dropdown", "button-group", "nav", "navbar",
  "card", "accordion", "breadcrumb", "pagination", "badge", "alert",
  "progress", "list-group", "close", "toasts", "modal", "tooltip",
  "popover", "carousel", "spinners", "offcanvas", "placeholders",
] as const;

const BOOTSTRAP_HELPER_STYLESHEETS = [
  "clearfix", "colored-links", "ratio", "position", "stacks",
  "visually-hidden", "stretched-link", "text-truncation", "vr",
] as const;

const BOOTSTRAP_CORE_FILES: readonly string[] = [
  "_variables.scss",
  "vendor/_rfs.scss",
  ...BOOTSTRAP_MIXIN_STYLESHEETS.map((m) => `mixins/_${m}.scss`),
  ...BOOTSTRAP_MAIN_STYLESHEETS.map((m) => `_${m}.scss`),
  ...BOOTSTRAP_FORM_STYLESHEETS.map((m) => `forms/_${m}.scss`),
  ...BOOTSTRAP_AFTER_FORM_STYLESHEETS.map((m) => `_${m}.scss`),
  ...BOOTSTRAP_HELPER_STYLESHEETS.map((m) => `helpers/_${m}.scss`),
  "utilities/_api.scss",
];

function loadStylesheets(files: readonly string[]): string {
  const fs = nodeFsOrNull();
  if (files.length > 0 && fs !== undefined) {
    let base: URL | undefined;
    try {
      base = bootstrapScssDirectory();
    } catch {
      base = undefined;
    }
    if (base !== undefined && (fs.existsSync === undefined || fs.existsSync(new URL(files[0]!, base)))) {
      return files.map((f) => fs.readFileSync(new URL(f, base!), "utf8")).join("\n");
    }
  }
  return files
    .map((f) => {
      const embedded = edgeAssetSources[`bootstrap-scss/${f}`];
      if (embedded === undefined) {
        throw new Error(`vendored bootstrap scss not found in the edge snapshot: bootstrap-scss/${f}`);
      }
      return embedded;
    })
    .join("\n");
}

export function bootstrapCoreScss(): string {
  return loadStylesheets(BOOTSTRAP_CORE_FILES);
}

export function bootstrapFunctionsScss(): string {
  return loadStylesheets(["_functions.scss"]);
}

export function bootstrapVariablesScss(): string {
  return loadStylesheets(["_variables.scss"]);
}

export function bootstrapCoreContent(_fmt: RenderFormat): string {
  return bootstrapCoreScss();
}

export function bootstrapFunctionsContent(_fmt: RenderFormat): string {
  return bootstrapFunctionsScss();
}
