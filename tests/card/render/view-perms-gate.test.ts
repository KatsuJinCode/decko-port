// The render-format view-permission gate end to end: RenderFormat.renderView
// routing through viewPermissionDenial (src/card/permissions/view-perms.ts)
// with a stub engine supplying the verdict maps — the exact contract the
// real RenderEngine implements via isDenied + the isTaskDenied hook (the
// render.ts wiring is the coordinator patch documented in
// docs/view-perms-notes.md).
//
// Byte contracts proven here:
// - a denied read view is REPLACED by the quiet span (no slot wrapper) —
//   the corpus shape (fixtures/corpus/*: 124,632 "(read)" spans);
// - a denied view configured denial: :blank renders "" (menu, html/menu.rb:8);
// - a perms-:none view renders unchanged on a denied card (title);
// - a denied NON-read task labels the span with its task ("(update)") —
//   the corpus never captures a non-read label (its four views are
//   read/none), so this half is gem-proven, not corpus-proven;
// - the skip_perms render option skips the check (permission.rb:26).

import { describe, it, expect } from "vitest";
import { RenderFormat, type RenderCard, type RenderEngineLike } from "../../../src/card/render/format.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import { DeckoName } from "../../../src/card/name.js";
import type { CardRecord } from "../../../src/card/fetch/card-record.js";
import type { CrudTask } from "../../../src/card/permissions/view-perms.js";

/** A real stored card (id present). */
function card(id: number, name: string, content: string): RenderCard {
  const deckoName = DeckoName.parse(name);
  const record: CardRecord = {
    id,
    codename: undefined,
    leftId: undefined,
    rightId: undefined,
    typeId: undefined,
    dbContent: content,
    trash: false,
    creatorId: undefined,
    updaterId: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    currentRevisionId: undefined,
    readRuleClass: undefined,
    readRuleId: undefined,
    referencesExpired: undefined,
    name: deckoName,
    key: deckoName.key,
    isNew: false,
    fromTrash: false,
    uncacheable: false,
  };
  return {
    record,
    name: deckoName,
    key: deckoName.key,
    typeName: undefined,
    typeId: undefined,
    typeCode: undefined,
    id,
    dbContent: content,
    setKeys: "",
  };
}

interface StubOptions {
  readDenied?: boolean;
  /** task -> ALLOWED, for the engine's taskAllowed hook (write tasks only;
   *  undefined = unverifiable, the canReadByRuleLookup contract). */
  taskAllowedByTask?: Partial<Record<"create" | "update" | "delete", boolean>>;
  withTaskHook?: boolean;
}

function stubEngine(opts: StubOptions): RenderEngineLike {
  const engine: RenderEngineLike = {
    views: HTML_VIEWS,
    fetchRenderCard: () => undefined,
    executeSearch: () => [],
    isDenied: () => opts.readDenied === true,
    resolveView: (_card, view) => HTML_VIEWS[view],
  };
  if (opts.withTaskHook !== false) {
    engine.taskAllowed = (_card, task) => opts.taskAllowedByTask?.[task];
  }
  return engine;
}

describe("render-format view-permission gate", () => {
  it("replaces a read-denied view with the quiet span (corpus bytes)", () => {
    const fmt = new RenderFormat(card(1, "Secret Thing", "body"), stubEngine({ readDenied: true }));
    expect(fmt.renderView("content")).toBe(
      '<span class="denied"><!-- Sorry, you don\'t have permission (read) --></span>',
    );
  });

  it("renders a read-denied menu as blank (denial: :blank, html/menu.rb:8)", () => {
    const fmt = new RenderFormat(card(1, "Secret Thing", "body"), stubEngine({ readDenied: true }));
    expect(fmt.renderView("menu")).toBe("");
  });

  it("renders the perms-:none title unchanged on a denied card", () => {
    const denied = new RenderFormat(
      card(1, "Secret Thing", "body"),
      stubEngine({ readDenied: true }),
    );
    const allowed = new RenderFormat(card(1, "Secret Thing", "body"), stubEngine({}));
    expect(denied.renderView("title")).toBe(allowed.renderView("title"));
    expect(denied.renderView("title")).toContain("card-title");
  });

  it("labels a denied update task in the quiet span", () => {
    const fmt = new RenderFormat(
      card(1, "Secret Thing", "body"),
      stubEngine({ readDenied: false, taskAllowedByTask: { update: false } }),
    );
    // :edit is unregistered (the ported registry carries no edit view yet),
    // but the check runs BEFORE dispatch (permission.rb:19-23 ->
    // view.rb:85-88 ok_view before render.rb:59-63 view_method), so the
    // denial replaces the view instead of raising.
    expect(fmt.renderView("edit")).toBe(
      '<span class="denied"><!-- Sorry, you don\'t have permission (update) --></span>',
    );
  });

  it("renders an update-allowed view body through to dispatch", () => {
    const fmt = new RenderFormat(
      card(1, "Open Thing", "visible body"),
      stubEngine({ readDenied: false, taskAllowedByTask: { update: true } }),
    );
    expect(fmt.renderView("content")).toContain("visible body");
  });

  it("renders without the check when the options carry skip_perms", () => {
    const fmt = new RenderFormat(card(1, "Secret Thing", "body"), stubEngine({ readDenied: true }));
    // :core's body is process_content(_render_raw) (base.rb:85-87) - no
    // permission-checked sub-render - so the skipped check shows directly.
    // (:content would still show the inner denial span: html/views.rb:12-14
    // renders render_core with a fresh, unchecked-opts voo - Ruby-correct.)
    expect(fmt.renderView("core", { skip_perms: true })).toBe("body");
  });

  it("falls through to dispatch when no task hook is installed", () => {
    // Engines without isTaskDenied (the current RenderEngine until the
    // coordinator patch lands) leave non-read tasks unverified-allowed:
    // an unregistered view then raises the unsupported-view error, which
    // is the honest signal (Ruby would render the real edit view).
    const fmt = new RenderFormat(
      card(1, "Secret Thing", "body"),
      stubEngine({ readDenied: false, withTaskHook: false }),
    );
    expect(() => fmt.renderView("edit")).toThrowError(/not supported/);
  });

  it("never checks unknown cards (alter_unknown owns them)", () => {
    const unknownCard = card(1, "Ghost Thing", "");
    unknownCard.unknown = true;
    unknownCard.id = undefined;
    const fmt = new RenderFormat(
      unknownCard,
      stubEngine({ readDenied: true, taskAllowedByTask: { update: false } }),
    );
    // alter_unknown substitutes the view; no denial span may appear.
    expect(fmt.renderView("content")).not.toContain("denied");
  });
});

describe("taskAllowed hook contract", () => {
  it("receives only non-read tasks (read rides isDenied)", () => {
    const seen: string[] = [];
    const engine = stubEngine({ readDenied: false });
    engine.taskAllowed = (_card, task: Exclude<CrudTask, "read">) => {
      seen.push(task);
      return false;
    };
    const fmt = new RenderFormat(card(1, "Thing", "body"), engine);
    fmt.renderView("content"); // read task -> isDenied, hook untouched
    expect(seen).toEqual([]);
    fmt.renderView("edit"); // update task -> hook, then the (update) denial
    expect(seen).toEqual(["update"]);
    expect(fmt.voo).toBeUndefined();
  });
});
