import { describe, expect, it } from "vitest";
import {
  RANDOMIZED_SLOT_ATTRIBUTE,
  byteDiff,
  compareNormalized,
  normalizeSlotIds,
} from "../../src/testing/diff.js";

const HEX20 = "abcdef0123456789abcd"; // exactly 20 lowercase hex chars
const hexId = (quote: string) => `data-slot-id=${quote}${HEX20}${quote}`;

describe("normalizeSlotIds (the recording-layer rule)", () => {
  it("replaces a double-quoted 20-hex slot id with the placeholder", () => {
    expect(normalizeSlotIds(`<div ${hexId('"')} class="card-slot">`)).toBe(
      `<div ${RANDOMIZED_SLOT_ATTRIBUTE} class="card-slot">`
    );
  });

  it("replaces a single-quoted slot id (search-result bars) with the double-quoted placeholder", () => {
    expect(normalizeSlotIds(`<div class='bar' ${hexId("'")}>`)).toBe(
      `<div class='bar' ${RANDOMIZED_SLOT_ATTRIBUTE}>`
    );
  });

  it("normalizes every occurrence in one document", () => {
    const html = `<a ${hexId('"')}><b ${hexId("'")}><c ${hexId('"')}>`;
    expect(normalizeSlotIds(html)).toBe(
      `<a ${RANDOMIZED_SLOT_ATTRIBUTE}><b ${RANDOMIZED_SLOT_ATTRIBUTE}><c ${RANDOMIZED_SLOT_ATTRIBUTE}>`
    );
  });

  it("is idempotent: the placeholder itself is never re-matched", () => {
    const once = normalizeSlotIds(`<div ${hexId('"')}>`);
    expect(normalizeSlotIds(once)).toBe(once);
    expect(once).toContain(RANDOMIZED_SLOT_ATTRIBUTE);
  });

  it("is strict about length: 19 or 21 hex chars survive so the byte diff surfaces them", () => {
    expect(normalizeSlotIds(`data-slot-id="${"a".repeat(19)}"`)).toBe(
      `data-slot-id="${"a".repeat(19)}"`
    );
    expect(normalizeSlotIds(`data-slot-id="${"a".repeat(21)}"`)).toBe(
      `data-slot-id="${"a".repeat(21)}"`
    );
  });

  it("is strict about case: uppercase hex survives (Ruby emits lowercase)", () => {
    const upper = `data-slot-id="${"A".repeat(20)}"`;
    expect(normalizeSlotIds(upper)).toBe(upper);
  });

  it("leaves non-slot attributes and bare hex text untouched", () => {
    const html = `<div data-other-id="${HEX20}" data-slot-id-other="${HEX20}">${HEX20}</div>`;
    expect(normalizeSlotIds(html)).toBe(html);
  });

  it("preserves attribute presence: occurrence count is unchanged", () => {
    const html = `<div ${hexId('"')}><span ${hexId("'")}></div>`;
    expect(normalizeSlotIds(html).split(RANDOMIZED_SLOT_ATTRIBUTE).length - 1).toBe(2);
  });
});

describe("byteDiff (exact bytes, no tolerance)", () => {
  it("reports equality with byte sizes", () => {
    const diff = byteDiff("same", "same");
    expect(diff.equal).toBe(true);
    expect(diff.firstDifference).toBeNull();
    expect(diff.expectedBytes).toBe(4);
    expect(diff.actualBytes).toBe(4);
  });

  it("counts UTF-8 bytes, not code units, for multibyte content", () => {
    const diff = byteDiff("\u00e9ab", "\u00e9ab");
    expect(diff.equal).toBe(true);
    expect(diff.expectedBytes).toBe(4);
  });

  it("locates the first differing byte with escaped chars and excerpts", () => {
    const diff = byteDiff('<span class="card-title"', '<span class="card-titlz"');
    expect(diff.equal).toBe(false);
    const first = diff.firstDifference;
    expect(first).not.toBeNull();
    expect(first!.codeUnitOffset).toBe(22);
    expect(first!.byteOffset).toBe(22); // ASCII prefix: byte offset == code-unit offset
    expect(first!.expectedChar).toBe('"e"');
    expect(first!.actualChar).toBe('"z"');
    expect(first!.expectedExcerpt).toContain("card-title");
    expect(first!.actualExcerpt).toContain("card-titlz");
  });

  it("reports a UTF-8 byte offset that differs from the code-unit offset after multibyte chars", () => {
    const diff = byteDiff("\u00e9abc", "\u00e9abx");
    expect(diff.firstDifference!.codeUnitOffset).toBe(3);
    expect(diff.firstDifference!.byteOffset).toBe(4); // "\u00e9" is 2 bytes in UTF-8
  });

  it("handles a length mismatch at end-of-string (one side exhausted)", () => {
    const diff = byteDiff("abcd", "ab");
    expect(diff.equal).toBe(false);
    const first = diff.firstDifference!;
    expect(first.codeUnitOffset).toBe(2);
    expect(first.expectedChar).toBe('"c"');
    expect(first.actualChar).toBe('""');
  });

  it("handles an entirely empty actual side", () => {
    const diff = byteDiff("expected bytes", "");
    expect(diff.equal).toBe(false);
    expect(diff.firstDifference!.codeUnitOffset).toBe(0);
    expect(diff.actualBytes).toBe(0);
  });

  it("respects a custom context radius for excerpts", () => {
    const long = "x".repeat(200) + "!" + "y".repeat(200);
    const diff = byteDiff(long, long.replace("!", "?"), 5);
    expect(diff.firstDifference!.expectedExcerpt.length).toBeLessThan(20);
  });
});

describe("compareNormalized (both sides normalized, then exact bytes)", () => {
  it("matches engine output carrying fresh random slot ids against fixture placeholder bytes", () => {
    const fixtureHtml = `<div id="x" ${RANDOMIZED_SLOT_ATTRIBUTE} data-slot="{&quot;view&quot;:&quot;open&quot;}">body</div>`;
    const engineHtml = fixtureHtml.replace(RANDOMIZED_SLOT_ATTRIBUTE, hexId('"'));
    expect(compareNormalized(fixtureHtml, engineHtml).equal).toBe(true);
  });

  it("still fails when any other byte differs", () => {
    const fixtureHtml = `<div ${RANDOMIZED_SLOT_ATTRIBUTE}>body</div>`;
    const engineHtml = `<div ${RANDOMIZED_SLOT_ATTRIBUTE}>Body</div>`;
    const diff = compareNormalized(fixtureHtml, engineHtml);
    expect(diff.equal).toBe(false);
    expect(diff.firstDifference!.codeUnitOffset).toBe(fixtureHtml.indexOf(">b") + 1);
  });
});
