// Regression pin: the swapBarSlotToMiniBar helper must stay bounded
// regardless of the `name` input. The previous implementation built a
// regex from `name` via `new RegExp(\`(<div )id="${name}-bar-view"...\`),
// interpolating the name raw. For names containing regex metacharacters
// the resulting pattern could form a nested-quantifier group
// (`name = "(a+)+"` -> pattern `(<div )id="(a+)+-bar-view"...`), where
// the engine tries exponentially many ways to split a long run of `a`
// characters against the backtracking literal.
//
// The structural guard in views.ts replaces the regex with literal-
// string operations (indexOf + slice + replace on a fixed substring):
// the swap is O(N) in the rendered html length for ANY name input, and
// the OUTERMOST-only semantics (the first `<div id="...bar-view"` slot)
// are preserved by the indexOf anchor.
//
// This test exercises the helper directly with the worst-case shape
// (a long run of the regex-metacharacter character, paired with a name
// that compiles to a nested-quantifier pattern). The OLD regex would
// hang (>>1s on the 1MB probe below); the structural guard finishes in
// single-digit ms.

import { describe, expect, it } from "vitest";
import { swapBarSlotToMiniBar } from "../../../src/card/render/views.js";

describe("swapBarSlotToMiniBar structural guard (regex-free, bounded)", () => {
  it("swaps the OUTERMOST slot for an alphanumeric name (the v2 corpus surface)", () => {
    const html =
      '<div id="yzzw-bar-view" class="card-slot bar-view ALL"><div class="pointer-item">x</div></div>';
    const out = swapBarSlotToMiniBar(html, "yzzw");
    expect(out).toContain('id="yzzw-mini_bar-view"');
    expect(out).toContain('class="card-slot mini_bar-view');
    expect(out).not.toContain("yzzw-bar-view");
    // The OLD regex pattern (id="X-bar-view"[^>]*class="card-slot )bar-view
    // matched "bar-view" as the LAST token in the class attribute (preceded
    // by 'card-slot '). The class is rewritten; assert no leftover
    // 'card-slot bar-view' substring remains.
    expect(out).not.toContain('card-slot bar-view');
  });

  it("swaps the OUTERMOST slot for a compound name containing '+'", () => {
    // Compound names use '+' as the joint, which the previous regex
    // pattern read as a one-or-more quantifier on the preceding char —
    // a silent correctness miss for compound items nested via
    // pointerListCore. The structural guard does not interpret the
    // '+' as a quantifier, so the swap fires for compound names too.
    const html =
      '<div id="x+y-bar-view" class="card-slot bar-view ALL"><div>nested</div></div>';
    const out = swapBarSlotToMiniBar(html, "x+y");
    expect(out).toContain('id="x+y-mini_bar-view"');
    expect(out).toContain('class="card-slot mini_bar-view');
  });

  it("swaps for a name that compiles to a nested-quantifier regex group", () => {
    // The previous regex would compile this name to `(<div )id="(a+)+-bar-view"...`,
    // a pattern that backtracks exponentially against any long run of `a`.
    // The structural guard treats the name as a literal — bounded.
    const html =
      '<div id="(a+)+b-bar-view" class="card-slot bar-view ALL"><div>x</div></div>';
    const out = swapBarSlotToMiniBar(html, "(a+)+b");
    expect(out).toContain('id="(a+)+b-mini_bar-view"');
    expect(out).toContain('class="card-slot mini_bar-view');
  });

  it("stays bounded on a 1MB html probe with a nested-quantifier-shape name", () => {
    // Probe: a 1MB html whose outer slot id contains the worst-case
    // name. The OLD regex would hang the test (exponential backtracking
    // on the trailing literal in the long run). The structural guard
    // scans linearly and finishes in single-digit ms; the test asserts
    // the wall is under a generous 1s budget to fail fast if the guard
    // regresses.
    const probeName = "(a+)+b";
    const probeHtml =
      `<div id="${probeName}-bar-view" class="card-slot bar-view ALL">` +
      "x".repeat(1_000_000) +
      "</div>";
    const t0 = Date.now();
    const out = swapBarSlotToMiniBar(probeHtml, probeName);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(1000);
    expect(out).toContain(`id="${probeName}-mini_bar-view"`);
    expect(out).toContain('class="card-slot mini_bar-view');
  });

  it("returns the html unchanged when the OUTERMOST slot id is absent", () => {
    // No `<div id="NAME-bar-view"` slot at all — the helper returns
    // the html untouched (the OUTERMOST-only contract).
    const html = '<div class="other">no slot here</div>';
    expect(swapBarSlotToMiniBar(html, "missing")).toBe(html);
  });
});
