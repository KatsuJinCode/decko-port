import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { gradeRun } from "../grade-lib.mjs";
import { normalizeHtml, sameFailure } from "../normalize.mjs";
import { HARNESS } from "./helpers.mjs";

const v2 = path.join(HARNESS, "fixtures", "synthetic-v2");

describe("the canonical forms a comparison reached", () => {
  it("names nothing for html that no canonical form matches", () => {
    const applied = new Set();
    normalizeHtml("<p>plain text</p>", { applied });
    assert.deepEqual([...applied], []);
  });

  it("names N1, N3 and N4 while preserving literal duration text", () => {
    const applied = new Set();
    const html =
      '<div data-slot-id="0123456789abcdef0123" class="b a">card-foo-123-collapse-id</div>' +
      "<p>less than a minute</p>";
    normalizeHtml(html, { applied });
    assert.deepEqual([...applied].sort(), ["N1", "N3", "N4"]);
  });

  it("does not name N3 when class-token order is off", () => {
    const applied = new Set();
    normalizeHtml('<div class="b a">x</div>', { classTokenOrder: false, applied });
    assert.deepEqual([...applied], []);
  });

  it("names N3 only for a class attribute with two or more tokens", () => {
    const applied = new Set();
    normalizeHtml('<div class="only">x</div>', { applied });
    assert.deepEqual([...applied], []);
  });

  it("names N6 and N7 only for a debug-page title with a frame and a capture-host path", () => {
    const applied = new Set();
    const title =
      "&lt;h3&gt;Error message (visible to admin only)&lt;/h3&gt;&lt;p&gt;boom&lt;/p&gt;" +
      "&lt;div&gt;C:/Ruby33/gems/x.rb:1:in `x'&lt;br&gt;\n/a/c.rb:2:in `y'&lt;/div&gt;";
    normalizeHtml(`<span title="${title}">x</span>`, { applied });
    assert.deepEqual([...applied].sort(), ["N6", "N7"]);
  });

  it("names N8 only when a recorded class name actually changes", () => {
    const changed = new Set();
    assert.equal(
      sameFailure({ class: "Card::Error::CodenameNotFound", message: "m" }, { class: "CodenameNotFoundError", message: "m" }, changed),
      true,
    );
    assert.deepEqual([...changed], ["N8"]);
    const canonical = new Set();
    sameFailure({ class: "CodenameNotFound", message: "m" }, { class: "CodenameNotFound", message: "m" }, canonical);
    assert.deepEqual([...canonical], []);
  });

  it("a grade over synthetic-v2 names every form its operations reach", () => {
    const report = gradeRun({ fixture: v2, actual: path.join(v2, "expected"), diagnostic: true });
    for (const rule of ["N1", "N2", "N3", "N4", "N8"]) {
      assert.ok(report.normalization.includes(rule), `${rule} is named (${report.normalization.join(", ")})`);
    }
  });
});
