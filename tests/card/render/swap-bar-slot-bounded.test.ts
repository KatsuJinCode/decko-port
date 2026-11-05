

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

    expect(out).not.toContain('card-slot bar-view');
  });

  it("swaps the OUTERMOST slot for a compound name containing '+'", () => {

    const html =
      '<div id="x+y-bar-view" class="card-slot bar-view ALL"><div>nested</div></div>';
    const out = swapBarSlotToMiniBar(html, "x+y");
    expect(out).toContain('id="x+y-mini_bar-view"');
    expect(out).toContain('class="card-slot mini_bar-view');
  });

  it("swaps for a name that compiles to a nested-quantifier regex group", () => {

    const html =
      '<div id="(a+)+b-bar-view" class="card-slot bar-view ALL"><div>x</div></div>';
    const out = swapBarSlotToMiniBar(html, "(a+)+b");
    expect(out).toContain('id="(a+)+b-mini_bar-view"');
    expect(out).toContain('class="card-slot mini_bar-view');
  });

  it("stays bounded on a 1MB html probe with a nested-quantifier-shape name", () => {

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

    const html = '<div class="other">no slot here</div>';
    expect(swapBarSlotToMiniBar(html, "missing")).toBe(html);
  });
});
