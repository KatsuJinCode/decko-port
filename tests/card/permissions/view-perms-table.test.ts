

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

    for (const view of [
      "title", "blank", "denial", "header", "head", "link",
      "name", "unknown", "errors", "not_found", "last_action", "followed",
    ]) {
      expect(resolveViewPerms(view)).toEqual({ check: false });
    }
  });

  it("resolves the all-set non-read CRUD directives", () => {

    expect(resolveViewPerms("edit")).toEqual({
      check: true, predicate: false, task: "update",
    });
    expect(resolveViewPerms("new")).toEqual({
      check: true, predicate: false, task: "create",
    });
  });

  it("defaults every other view to the :read task", () => {

    for (const view of ["content", "core", "open", "closed", "titled", "menu", "bar"]) {
      expect(resolveViewPerms(view)).toEqual({
        check: true, predicate: false, task: "read",
      });
    }
  });

  it("keeps the legacy collapsed shape and the task-demand trigger", () => {
    expect(viewPerms("title")).toBe("none");
    expect(viewPerms("edit")).toBe("read");
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

    expect(viewDenialView("menu")).toBe("blank");
    expect(viewPermissionDenial("menu", deniedGate())).toBe("");
  });

  it("leaves allowed views alone", () => {
    expect(viewPermissionDenial("content", allowedGate())).toBeUndefined();
  });

  it("labels a denied non-read task in the span", () => {

    expect(viewPermissionDenial("edit", { ...allowedGate(), taskAllowed: (t) => t !== "update" }))
      .toBe(quietDenial("update"));
  });

  it("maps :update to :create for new cards (format/error.rb:6)", () => {

    expect(
      viewPermissionDenial("edit", {
        renderOpts: {},
        isNewCard: true,
        taskAllowed: (t) => t === "create",
      }),
    ).toBeUndefined();

    expect(
      viewPermissionDenial("edit", {
        renderOpts: {},
        isNewCard: true,
        taskAllowed: () => false,
      }),
    ).toBe(quietDenial("create"));
  });
});

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
