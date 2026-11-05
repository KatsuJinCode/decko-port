import type { ViewContext } from "../../render/format.js";
import { h } from "../../render/slot-html.js";
import type { DeckoModManifest, ModPatternRegistration } from "../mod-manifest.js";
import { getDefaultModLoader, type ModLoader } from "../../mod-loader.js";
import { setModuleShortname, setPathPattern } from "../mod-registrar.js";
import { writePathEnabled } from "../../../server/write-routes.js";
import {
  catalogEntryFor,
  type ModCatalogEntry,
} from "./marketplace-mod-catalog.js";

export const MARKETPLACE_CARD_NAME = "*marketplace";

export const MARKETPLACE_VIEW = "marketplace";

export const MOD_DETAIL_VIEW = "mod_detail";

export interface ModRegistrationSurface {
  readonly modName: string;
  readonly setModules: readonly string[];
  readonly views: readonly string[];
  readonly cardtypes: readonly string[];
  readonly settings: readonly string[];
  readonly events: readonly string[];
  readonly contentOverrides: readonly string[];
  readonly patterns: readonly string[];
}

function settingCodenameFor(setPath: string): string {
  return setPath
    .split("/")
    .slice(1)
    .join("_")
    .replace(/^\d+_/, "");
}

export function registrationSurface(loader: ModLoader): ModRegistrationSurface[] {
  const basket = loader.setModules();
  const registeredModules = [...basket.base, ...basket.abstract, ...basket.allNonbase()];
  const settings = loader.settingsRegistry();
  const overrides = loader.contentOverrideRegistry();
  const eventsByMod = new Map<string, string[]>();
  for (const event of loader.eventRegistry().all()) {
    const list = eventsByMod.get(event.modName) ?? [];
    if (!list.includes(event.event)) list.push(event.event);
    eventsByMod.set(event.modName, list);
  }
  const overridePathsByMod = new Map<string, string[]>();
  for (const path of overrides.paths()) {
    const modName = overrides.forPath(path)?.modName;
    if (modName === undefined) continue;
    const list = overridePathsByMod.get(modName) ?? [];
    if (!list.includes(path)) list.push(path);
    overridePathsByMod.set(modName, list);
  }

  const out: ModRegistrationSurface[] = [];
  const seen = new Set<string>();
  for (const modName of loader.modNames()) {
    if (seen.has(modName)) continue;
    seen.add(modName);
    const modules = registeredModules.filter((m) => m.modName === modName);
    const pathsByShortname = new Map<string, string>();
    for (const module of modules) {
      const path = basket.setPathFor(module.shortname);
      if (path !== undefined) pathsByShortname.set(module.shortname, path);
    }
    const source = loader.fetchMod(modName);
    const views = new Set<string>();
    for (const file of source?.manifest.setModules ?? []) {
      const shortname = setModuleShortname(file.setPath);
      if (!pathsByShortname.has(shortname)) continue;
      for (const block of Object.values(file.formats ?? {})) {
        for (const view of block?.views ?? []) views.add(view.view);
      }
    }
    const settingsOut = new Set<string>();
    for (const file of source?.manifest.setModules ?? []) {
      if (file.settingOpts === undefined) continue;
      if (!pathsByShortname.has(setModuleShortname(file.setPath))) continue;
      const codename = settingCodenameFor(file.setPath);
      for (const group of settings.groups.values()) {
        for (const entry of group) {
          if (entry !== null && entry.codename === codename) settingsOut.add(codename);
        }
      }
    }
    out.push({
      modName,
      setModules: modules.map((m) => m.shortname),
      views: [...views].sort(),
      cardtypes: modules
        .map((m) => pathsByShortname.get(m.shortname))
        .filter((p): p is string => p !== undefined && setPathPattern(p) === "type")
        .map((p) => setModuleShortname(p))
        .sort(),
      settings: [...settingsOut].sort(),
      events: [...(eventsByMod.get(modName) ?? [])].sort(),
      contentOverrides: [...(overridePathsByMod.get(modName) ?? [])].sort(),
      patterns: (source?.manifest.setPatterns ?? []).map((p: ModPatternRegistration) => p.code).sort(),
    });
  }
  return out;
}

export type ModInstallKind = "content-bundle" | "compiled-code";

export interface ApplyGate {
  readonly writePathEnabled: boolean;
  readonly signedIn: boolean;
  readonly canApply: boolean;
  readonly blockedReason?: string;
}

export function applyGate(ctx: ViewContext): ApplyGate {
  const writePath = writePathEnabled();
  const signedIn = ctx.fmt.engine.pageSession?.signedIn === true;
  if (writePath && signedIn) {
    return { writePathEnabled: true, signedIn: true, canApply: true };
  }
  const reason = !writePath
    ? "This host has the write path turned off (DECKO_WRITE_PATH is not \"1\"), so no card can be created here. A browse-only host renders no create action."
    : "You are not signed in. The write path authenticates every write and rejects an anonymous actor (HTTP 403), so no create action is offered.";
  return { writePathEnabled: writePath, signedIn, canApply: false, blockedReason: reason };
}

export function installKindFor(surface: ModRegistrationSurface): ModInstallKind {
  return surface.cardtypes.length > 0 || surface.contentOverrides.length > 0
    ? "content-bundle"
    : "compiled-code";
}

function contentRegistrations(surface: ModRegistrationSurface): string {
  const parts: string[] = [];
  if (surface.cardtypes.length > 0) {
    parts.push(
      plural(surface.cardtypes.length, "cardtype") + ` (${surface.cardtypes.join(", ")})`,
    );
  }
  if (surface.contentOverrides.length > 0) {
    parts.push(
      plural(surface.contentOverrides.length, "content override") +
        ` (${surface.contentOverrides.join(", ")})`,
    );
  }
  return parts.join(" and ");
}

function compiledRegistrations(surface: ModRegistrationSurface): string {
  const parts: string[] = [];
  if (surface.views.length > 0) parts.push(plural(surface.views.length, "view"));
  if (surface.setModules.length > 0) parts.push(plural(surface.setModules.length, "set module"));
  if (surface.settings.length > 0) parts.push(plural(surface.settings.length, "setting"));
  if (surface.events.length > 0) parts.push(plural(surface.events.length, "event"));
  if (surface.patterns.length > 0) parts.push(plural(surface.patterns.length, "set pattern"));
  if (parts.length === 0) return "no registrations at all in this deck";
  return parts.join(", ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function installNote(surface: ModRegistrationSurface, kind: ModInstallKind): string {
  if (kind === "content-bundle") {
    return `This deck registers ${contentRegistrations(surface)} for this mod - card content, which is what the write path creates. The registrations are compiled in and already active. The create action below adds a card named after this mod, carrying the content you type; it does not set that card's type, and it does not install, remove, or reconfigure the mod. Installing or removing the mod itself is the v2 boundary.`;
  }
  return `This deck registers no cardtype and no content override for this mod. What it does register is ${compiledRegistrations(surface)} - compiled code the render path calls, none of it something the write path can create - so there is no card content here for a create action to add. The registrations are compiled in and already active. Installing or removing the mod itself is the v2 boundary.`;
}

function marketplaceView(ctx: ViewContext): string {
  const loader = getDefaultModLoader();
  if (loader === undefined) {
    return shell(
      '<p class="marketplace-empty">No mod loader is bound, so there is no catalog to show. The marketplace reads the loaded deck\'s own registries; with no deck loaded there are no mods to list.</p>',
    );
  }
  const surfaces = registrationSurface(loader);
  const cards = surfaces.map((surface) =>
    catalogCard(surface, catalogEntryFor(surface.modName)),
  );
  return shell(
    `<p class="marketplace-lede">${h(
      `${surfaces.length} mods are loaded into this deck. Every one is compiled in: the deck composes them at boot, so each is present and its registrations are live. There is no per-mod enable switch, and installing new third-party code is not part of this version.`,
    )}</p>${cards.join("")}`,
  );
}

function shell(inner: string): string {
  return `<div class="marketplace-deck">${inner}</div>`;
}

function catalogCard(
  surface: ModRegistrationSurface,
  entry: ModCatalogEntry | undefined,
): string {
  const name = h(surface.modName);
  const gem =
    entry?.gemName === undefined
      ? ""
      : `<span class="marketplace-gem">${h(entry.gemName)}</span>`;
  const summary =
    entry === undefined
      ? '<p class="marketplace-summary marketplace-summary-unsourced">No catalog entry describes this mod. It is loaded and its registrations are counted below, but this version\'s catalog carries no sourced description for it.</p>'
      : `<p class="marketplace-summary">${h(entry.summary)} <span class="marketplace-source">Source: ${h(entry.sourceFile)}:${entry.sourceLine}</span></p>` +
        `<p class="marketplace-provenance">The paragraph above describes the Ruby gem this mod was ported from, so its numbers describe that gem and not this port. Every list below is this deck's own registrations, counted live at render time.</p>`;
  return (
    `<div class="marketplace-card" data-mod="${name}">` +
    `<h3 class="marketplace-name">${name}${gem}</h3>` +
    summary +
    surfaceList(surface) +
    `<p class="marketplace-state">Loaded and active: this mod is part of the deck's composition, so its registrations are live. The deck has no per-mod on/off switch, which is why every entry reads the same way.</p>` +
    `<p class="marketplace-detail-hint">Detail view: <code>{{${h(MARKETPLACE_CARD_NAME)}|${MOD_DETAIL_VIEW}: ${name}}}</code></p>` +
    `</div>`
  );
}

function surfaceList(surface: ModRegistrationSurface): string {
  const rows: Array<[string, readonly string[]]> = [
    ["Cardtypes", surface.cardtypes],
    ["Set modules", surface.setModules],
    ["Views", surface.views],
    ["Settings", surface.settings],
    ["Events", surface.events],
    ["Content overrides", surface.contentOverrides],
    ["Set patterns", surface.patterns],
  ];
  return `<ul class="marketplace-surfaces">${rows
    .map(([label, values]) => surfaceRow(label, values))
    .join("")}</ul>`;
}

function surfaceRow(label: string, values: readonly string[]): string {
  const key = label.toLowerCase().replace(/\s+/g, "-");
  const body =
    values.length === 0
      ? '<span class="marketplace-none">none</span>'
      : values.map((v) => `<code>${h(v)}</code>`).join(", ");
  return `<li class="marketplace-surface" data-surface="${h(key)}"><span class="marketplace-surface-label">${h(label)}</span>: ${body}</li>`;
}

function modDetailView(ctx: ViewContext): string {
  const loader = getDefaultModLoader();
  if (loader === undefined) {
    return shell('<p class="marketplace-empty">No mod loader is bound, so there is no mod to detail.</p>');
  }
  const requested =
    typeof ctx.voo.opts["mod"] === "string" ? (ctx.voo.opts["mod"] as string) : undefined;
  if (requested === undefined) {
    return marketplaceView(ctx);
  }
  const surfaces = registrationSurface(loader);
  const surface = surfaces.find((s) => s.modName === requested);
  if (surface === undefined) {
    const known = surfaces.map((s) => `<code>${h(s.modName)}</code>`).join(", ");
    return (
      shell(
        `<h3 class="marketplace-name">No mod named ${h(requested)} is loaded</h3>` +
          `<p class="marketplace-summary">This deck composes ${surfaces.length} mods, and that name is not one of them, so there are no registrations here to detail. This page does not guess why: the loader records which mods a deck holds, not why a name is missing from one. A mod detail names one through the nest option, for example <code>{{${h(MARKETPLACE_CARD_NAME)}|${MOD_DETAIL_VIEW}: date}}</code>. The mods in this deck are: ${known}.</p>`,
      )
    );
  }
  const entry = catalogEntryFor(surface.modName);
  const kind = installKindFor(surface);
  return (
    shell(
      `<div class="marketplace-detail" data-mod="${h(surface.modName)}">` +
        `<h3 class="marketplace-name">${h(surface.modName)}${
          entry?.gemName === undefined
            ? ""
            : `<span class="marketplace-gem">${h(entry.gemName)}</span>`
        }</h3>` +
        (entry === undefined
          ? '<p class="marketplace-summary marketplace-summary-unsourced">No catalog entry describes this mod; the lists below are read from the deck.</p>'
          : `<p class="marketplace-summary">${h(entry.summary)} <span class="marketplace-source">Source: ${h(entry.sourceFile)}:${entry.sourceLine}</span></p>` +
            `<p class="marketplace-provenance">The paragraph above describes the Ruby gem this mod was ported from, so its numbers describe that gem and not this port. Every list below is this deck's own registrations, counted live at render time.</p>`) +
        `<p class="marketplace-install">${h(installNote(surface, kind))}</p>` +
        detailSection(
          "Cardtypes",
          surface.cardtypes,
          "The mod's set/type/* set modules - a mod's cardtypes are exactly the set files under the type pattern.",
        ) +
        detailSection(
          "Settings",
          surface.settings,
          "Setting codenames the mod registered via setting_opts, checked against the loader's setting registry.",
        ) +
        detailSection(
          "Views",
          surface.views,
          "View names the mod registered across its set modules' format blocks.",
        ) +
        detailSection(
          "Set modules",
          surface.setModules,
          "Every set module the mod's set/ tree registers, as the loader's module basket records it.",
        ) +
        detailSection(
          "Events",
          surface.events,
          "Event names the mod declared. The execution seam fires them at their stage; v1's catalog records the declaration, it does not run it.",
        ) +
        detailSection(
          "Content overrides",
          surface.contentOverrides,
          "Set paths carrying a set-module def content override.",
        ) +
        detailSection(
          "Set patterns",
          surface.patterns,
          "Set patterns the mod registered. No ported mod of the composed deck registers one; the core patterns stay in their own order.",
        ) +
        applySection(applyGate(ctx), kind, surface) +
        `</div>`,
    )
  );
}

function detailSection(label: string, values: readonly string[], why: string): string {
  const body =
    values.length === 0
      ? '<span class="marketplace-none">none</span>'
      : `<ul class="marketplace-detail-list">${values
          .map((v) => `<li><code>${h(v)}</code></li>`)
          .join("")}</ul>`;
  return (
    `<section class="marketplace-detail-section" data-section="${h(label.toLowerCase())}">` +
    `<h4 class="marketplace-detail-label">${h(label)}</h4>` +
    `<p class="marketplace-detail-why">${h(why)}</p>` +
    body +
    `</section>`
  );
}

function applySection(
  gate: ApplyGate,
  kind: ModInstallKind,
  surface: ModRegistrationSurface,
): string {
  const modName = surface.modName;
  if (kind !== "content-bundle") {
    return (
      `<section class="marketplace-apply marketplace-apply-unavailable" data-mod="${h(modName)}">` +
      `<h4 class="marketplace-detail-label">Apply</h4>` +
      `<p class="marketplace-apply-note" data-gate="compiled-code">No create action is offered for this mod: this deck registers no card content for it - no cardtype, no content override - for the write path to create. The boundary it sits on is stated above.</p>` +
      `</section>`
    );
  }
  if (!gate.canApply) {
    return (
      `<section class="marketplace-apply marketplace-apply-blocked" data-mod="${h(modName)}">` +
      `<h4 class="marketplace-detail-label">Apply</h4>` +
      `<p class="marketplace-apply-note" data-gate="${gate.writePathEnabled ? "signed-out" : "write-path-disabled"}">${h(
        gate.blockedReason ?? "The create action is unavailable.",
      )}</p>` +
      `</section>`
    );
  }
  const id = h(modName);
  return (
    `<section class="marketplace-apply marketplace-apply-available" data-mod="${id}">` +
    `<h4 class="marketplace-detail-label">Apply</h4>` +
    `<p class="marketplace-apply-note">This deck registers ${h(
      contentRegistrations(surface),
    )} for this mod, so card content here is something the write path can create and a create action is offered. The form below posts to the deck's own create route: it adds a card named ${h(
      modName,
    )}, carrying the content you type. It does not set that card's type, and it does not install, remove, or reconfigure the mod.</p>` +
    `<form class="marketplace-apply-form" method="post" action="/">` +
    `<input type="hidden" name="card[name]" value="${id}">` +
    `<label class="marketplace-apply-label" for="marketplace-apply-content-${id}">Card content</label>` +
    `<textarea class="marketplace-apply-content" id="marketplace-apply-content-${id}" name="card[content]" rows="3"></textarea>` +
    `<button class="marketplace-apply-submit" type="submit">Create card</button>` +
    `</form>` +
    `</section>`
  );
}

const cardModMarketplace: DeckoModManifest = {
  name: "marketplace",
  group: "custom",
  setModules: [
    {
      setPath: "all/marketplace",
      formats: {
        html: {
          views: [
            { view: MARKETPLACE_VIEW, viewFn: marketplaceView, config: { cache: "never" } },
            { view: MOD_DETAIL_VIEW, viewFn: modDetailView, config: { cache: "never" } },
          ],
        },
      },
    },
  ],
};

export function marketplaceModSource(): { manifest: DeckoModManifest } {
  return { manifest: cardModMarketplace };
}

export default cardModMarketplace;
