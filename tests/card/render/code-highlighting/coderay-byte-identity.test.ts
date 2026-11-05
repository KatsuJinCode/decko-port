// Stream M1 (coderay-highlighting) byte-identity tests.
//
// Each fixture under fixtures/captured/coderay/ was produced by
// `CodeRay.scan(card-content, :LANG).div` on the local Ruby oracle (the
// gem at coderay-1.1.3, the card-mod-format/layout/style cardtypes). The
// port's job is to reproduce those bytes exactly for every card the
// corpus seeds; this file is the gate.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  highlight,
  langForTypeCode,
  wrapDiv,
  type HighlightLanguage,
} from "../../../../src/card/render/code-highlighting/index.js";
import { scanJson } from "../../../../src/card/render/code-highlighting/scanners/json.js";
import { scanCss } from "../../../../src/card/render/code-highlighting/scanners/css.js";
import { scanHtml } from "../../../../src/card/render/code-highlighting/scanners/html.js";
import { coderayEscape } from "../../../../src/card/render/code-highlighting/escape.js";
import { ALPHA_STYLES } from "../../../../src/card/render/code-highlighting/alpha-style.js";

const FIXTURES = "C:/localProjects/decko-ts/fixtures/corpus";
const CAPTURED = "C:/localProjects/decko-ts/fixtures/captured/coderay";

interface Case {
  readonly fixture: string;
  readonly lang: HighlightLanguage;
  readonly shard: string;
  readonly cardId: number;
}

const CASES: readonly Case[] = [
  { fixture: "json-tinymce-corpus-53", lang: "json", shard: "shard-000000.jsonl", cardId: 53 },
  { fixture: "css-corpus-198", lang: "css", shard: "shard-000000.jsonl", cardId: 198 },
  { fixture: "html-layout-corpus-314", lang: "html", shard: "shard-000000.jsonl", cardId: 314 },
  { fixture: "html-layout-shard1-2339", lang: "html", shard: "shard-000001.jsonl", cardId: 2339 },
  { fixture: "html-layout-shard1-2347", lang: "html", shard: "shard-000001.jsonl", cardId: 2347 },
  { fixture: "html-layout-shard1-2575", lang: "html", shard: "shard-000001.jsonl", cardId: 2575 },
];

function loadContent(shard: string, cardId: number): string {
  const lines = readFileSync(resolve(FIXTURES, shard), "utf8").split("\n");
  for (const line of lines) {
    if (line === "") continue;
    const d = JSON.parse(line) as { id: number; record: { content: string } };
    if (d.id === cardId) return d.record.content;
  }
  throw new Error(`card ${cardId} not in ${shard}`);
}

function loadOracle(fixture: string): string {
  // The Ruby capture script wrote a trailing newline; readFileSync preserves
  // it so we can byte-compare directly.
  return readFileSync(resolve(CAPTURED, `${fixture}.html`), "utf8");
}

describe("code-highlighting: byte-identity vs Ruby oracle", () => {
  for (const c of CASES) {
    it(`${c.fixture} reproduces the captured ${c.lang} output verbatim`, () => {
      const content = loadContent(c.shard, c.cardId);
      const oracle = loadOracle(c.fixture);
      const actual = highlight(content, c.lang);
      expect(actual).toBe(oracle);
    });
  }
});

describe("code-highlighting: scanner-level byte-identity", () => {
  // The DIV wrapping is identical across languages, so exercising the
  // scanner outputs in isolation catches any regression where a future
  // change adds a stray span wrapper that survives into the assembled HTML.
  for (const c of CASES) {
    it(`${c.fixture}: inner spans are wrapped by the CodeRay DIV template`, () => {
      const content = loadContent(c.shard, c.cardId);
      const oracle = loadOracle(c.fixture);
      const inner = oracle.slice("<div class=\"CodeRay\">\n  <div class=\"code\"><pre>".length, -"</pre></div>\n</div>\n".length);
      const scanned =
        c.lang === "json" ? scanJson(content)
        : c.lang === "css" ? scanCss(content)
        : scanHtml(content);
      expect(scanned).toBe(inner);
    });
  }
});

describe("code-highlighting: langForTypeCode dispatch", () => {
  it.each([
    ["json", "json"],
    ["css", "css"],
    ["scss", "css"],
    ["layout_type", "html"],
    ["head", "html"],
    ["basic", undefined],
    ["search_type", undefined],
    [undefined, undefined],
  ] as const)("maps type_code %s -> %s", (input, expected) => {
    expect(langForTypeCode(input)).toBe(expected);
  });
});

describe("code-highlighting: escape + DIV template shape", () => {
  it("escapes HTML entities and control codes per CodeRay", () => {
    expect(coderayEscape("<&>\"")).toBe("&lt;&amp;&gt;&quot;");
    expect(coderayEscape("\n")).toBe("\n"); // 0x0A not in the escape set
    expect(coderayEscape("\x00")).toBe(" ");
    expect(coderayEscape("\t")).toBe("        "); // tab -> 8 spaces
  });

  it("wraps a scan in the CodeRay DIV template", () => {
    expect(wrapDiv("XYZ")).toBe(
      "<div class=\"CodeRay\">\n  <div class=\"code\"><pre>XYZ</pre></div>\n</div>\n",
    );
  });

  it("alpha theme table covers the kinds the corpus fixtures exercise", () => {
    const kinds = new Set(ALPHA_STYLES.map((e) => e.kind));
    expect(kinds.has("error")).toBe(true);
    expect(kinds.has("tag")).toBe(true);
    expect(kinds.has("doctype")).toBe(true);
    expect(kinds.has("inline")).toBe(true);
  });
});
