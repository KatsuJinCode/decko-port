// View-permission contract tests: the task-resolution table, the skip
// paths, and the denial substitution (src/card/permissions/view-perms.ts).
//
// Ruby truth under test:
// - view_perms (card-1.110.0 lib/card/view/permission.rb:13-15):
//   `setting(:perms) || :read`.
// - skip_check? (permission.rb:25-27): the skip_perms render option
//   (view/options.rb:73) or a perms-:none directive.
// - denial (permission.rb:46-50) -> view_for_denial (lib/card/format/
//   error.rb:27-31): the `denial:` view or :denial; the quiet span
//   (card-mod-format set/all/html/error.rb:185-189) carries
//   `crud?(task) && task` (permission.rb:49) — the task label for CRUD,
//   "" for method predicates.
// - format/error.rb:5-8 ok?: `task = :create if task == :update &&
//   card.new_card?`.
//
// Corpus proof (fixtures/corpus/shard-000000..000009, the
// captureCorpusDenialLabels census below): every one of the 124,632
// captured denial spans labels task READ and no other label occurs
// anywhere — the captured surface (closed/title/content/open only) never
// renders a non-read-task view, so the non-read byte contract is proven
// against the gems (the directive table's citations) and pinned here
// synthetically, per docs/view-perms-notes.md.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  quietDenial,
  resolveViewPerms,
  viewDenialView,
  viewPerms,
  viewPermissionDenial,
  viewRequiresTask,
  renderOptSkipPerms,
} from "../../../src/card/permissions/view-perms.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("view perms registry (permission.rb:13-15 setting(:perms) || :read)", () => {
  it("resolves perms-:none views from the gems' directives", () => {
    // card-mod-format set/all/title.rb:2, base.rb:109, error.rb:14,
    // html/header.rb:5, html/head.rb:31, base.rb:35 ...
    for (const view of [
      "title", "blank", "denial", "header", "head", "link",
      "name", "unknown", "errors", "not_found", "last_action", "followed",
    ]) {
      expect(resolveViewPerms(view)).toEqual({ check: false });
    }
  });

  it("resolves the all-set non-read CRUD directives", () => {
    // card-mod-edit set/all/edit_content.rb:28 (update), new.rb:4 (create)
    expect(resolveViewPerms("edit")).toEqual({
      check: true, predicate: false, task: "update",
    });
    expect(resolveViewPerms("new")).toEqual({
      check: true, predicate: false, task: "create",
    });
  });

  it("defaults every other view to the :read task", () => {
    // the four captured views carry no perms directive (html/views.rb:10,
    // base.rb:85/120, bar_and_box set/all/bar.rb:38/44)
    for (const view of ["content", "core", "open", "closed", "titled", "menu", "bar"]) {
      expect(resolveViewPerms(view)).toEqual({
        check: true, predicate: false, task: "read",
      });
    }
  });

  it("keeps the legacy collapsed shape and the task-demand trigger", () => {
    expect(viewPerms("title")).toBe("none");
    expect(viewPerms("edit")).toBe("read"); // collapsed: checked (task rides resolveViewPerms)
    expect(viewRequiresTask("edit")).toBe(true);
    expect(viewRequiresTask("new")).toBe(true);
    expect(viewRequiresTask("content")).toBe(false);
    expect(viewRequiresTask("title")).toBe(false);
  });
});

describe("skip_check? (permission.rb:25-27)", () => {
  it("reads the skip_perms render option (view/options.rb:73)", () => {
    expect(renderOptSkipPerms({ skip_perms: true })).toBe(true);
    expect(renderOptSkipPerms({})).toBe(false);
    expect(renderOptSkipPerms({ skip_perms: false })).toBe(false);
  });

  it("skips the whole check for perms-:none views even when denied", () => {
    expect(viewPermissionDenial("title", deniedGate())).toBeUndefined();
    expect(viewPermissionDenial("denial", deniedGate())).toBeUndefined();
  });

  it("skips the whole check when the render options carry skip_perms", () => {
    expect(
      viewPermissionDenial("content", { ...deniedGate(), renderOpts: { skip_perms: true } }),
    ).toBeUndefined();
  });
});

describe("denial substitution (permission.rb:46-50 + format/error.rb:27-31)", () => {
  it("replaces a denied read view with the quiet span", () => {
    expect(viewPermissionDenial("content", deniedGate())).toBe(quietDenial("read"));
  });

  it("renders a denied view configured denial: :blank as nothing (menu)", () => {
    // card-mod-format set/all/html/menu.rb:8
    expect(viewDenialView("menu")).toBe("blank");
    expect(viewPermissionDenial("menu", deniedGate())).toBe("");
  });

  it("leaves allowed views alone", () => {
    expect(viewPermissionDenial("content", allowedGate())).toBeUndefined();
  });

  it("labels a denied non-read task in the span", () => {
    // perms :update view (card-mod-edit set/all/edit_content.rb:28) failing
    // ok_to_update? -> "(update)" label (permission.rb:49 crud? && task)
    expect(viewPermissionDenial("edit", { ...allowedGate(), taskAllowed: (t) => t !== "update" }))
      .toBe(quietDenial("update"));
  });

  it("maps :update to :create for new cards (format/error.rb:6)", () => {
    // create allowed, update denied: the MAPPED task (create) decides
    expect(
      viewPermissionDenial("edit", {
        renderOpts: {},
        isNewCard: true,
        taskAllowed: (t) => t === "create",
      }),
    ).toBeUndefined();
    // create denied too: the span labels the MAPPED task (create), not the
    // requested one (update) - the error.rb:6 mapping proof
    expect(
      viewPermissionDenial("edit", {
        renderOpts: {},
        isNewCard: true,
        taskAllowed: () => false,
      }),
    ).toBe(quietDenial("create"));
  });
});

/** The quiet span bytes: (read) default, custom CRUD task, empty for the
 *  false label a method-predicate task produces (permission.rb:49
 *  `crud?(task) && task`; Ruby interpolates false as ""). */
describe("quiet_denial bytes (html/error.rb:185-189)", () => {
  it("interpolates the task label", () => {
    expect(quietDenial()).toBe(
      '<span class="denied"><!-- Sorry, you don\'t have permission (read) --></span>',
    );
    expect(quietDenial("update")).toBe(
      '<span class="denied"><!-- Sorry, you don\'t have permission (update) --></span>',
    );
    expect(quietDenial("")).toBe(
      '<span class="denied"><!-- Sorry, you don\'t have permission () --></span>',
    );
  });

  it("matches the corpus: every captured denial label is (read)", () => {
    const labels = captureCorpusDenialLabels();
    expect(labels.size).toBe(1);
    expect(labels.has("read")).toBe(true);
  });
});

/** The gate input for a viewer every task denies (taskAllowed false). */
function deniedGate() {
  return {
    renderOpts: {} as Record<string, unknown>,
    taskAllowed: () => false,
  };
}

function allowedGate() {
  return {
    renderOpts: {} as Record<string, unknown>,
    taskAllowed: () => true,
  };
}

/** The distinct "Sorry, you don't have permission (X)" labels across the
 *  whole corpus capture. */
function captureCorpusDenialLabels(): Set<string> {
  const labels = new Set<string>();
  const pattern = /Sorry, you don't have permission \(([a-z_]*)\)/g;
  for (let i = 0; i < 10; i++) {
    const shard = `fixtures/corpus/shard-${String(i).padStart(6, "0")}.jsonl`;
    const text = readFileSync(`${REPO_ROOT}${shard}`, "utf8");
    for (const match of text.matchAll(pattern)) {
      labels.add(match[1] ?? "");
    }
  }
  return labels;
}
