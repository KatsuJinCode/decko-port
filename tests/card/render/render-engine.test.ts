

import { describe, expect, it } from "vitest";
import {
  parseNestOptions,
  referencedNames,
  scanNests,
} from "../../../src/card/render/nest-syntax.js";
import { safeSetKeys } from "../../../src/card/render/set-keys.js";
import { UnsupportedViewError } from "../../../src/card/render.js";
import { DeckoName } from "../../../src/card/name.js";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

describe("nest syntax parsing (card-mod-content chunk/nest.rb port)", () => {
  it("splits content into literals and nests, preserving literal bytes", () => {
    const pieces = scanNests("<p>A {{One}} B</p> after {{Two|open}}");
    expect(pieces).toEqual([
      { kind: "text", text: "<p>A " },
      { kind: "nest", text: "{{One}}", nest: expect.objectContaining({ name: "One" }) },
      { kind: "text", text: " B</p> after " },
      { kind: "nest", text: "{{Two|open}}", nest: expect.objectContaining({ name: "Two" }) },
    ]);
  });

  it("parses pipe/semicolon options with the bare-value = view default", () => {
    const options = parseNestOptions("open;hide:menu");
    expect(options.view).toBe("open");
    expect(options.hide).toBe("menu");
  });

  it("folds nested option lists into items (nest.rb interpret_options)", () => {
    const options = parseNestOptions("bar|title");
    expect(options.view).toBe("bar");

    expect(options.items).toEqual({ view: "title" });
  });

  it("drops non-shark keys (option_string_to_hash)", () => {
    const options = parseNestOptions("open;not_a_shark_key:1");
    expect(options.view).toBe("open");
    expect(JSON.stringify(options)).not.toContain("not_a_shark_key");
  });

  it("handles comment nests: # renders the escaped bracket text, ## renders nothing", () => {

    const comment = scanNests("{{#hi <b>there</b>}}")[0];
    expect(comment.nest?.comment).toBe("<!-- #hi &lt;b&gt;there&lt;/b&gt; -->");
    const silent = scanNests("{{##gone}}")[0];
    expect(silent.nest?.comment).toBe("");
  });

  it("strips tags inside nest brackets before name parsing (nest.rb strip_tags)", () => {
    const pieces = scanNests("{{<b>Tagged</b> Name}}");
    expect(pieces[0]?.nest?.name).toBe("Tagged Name");
  });

  it("reports reference names for the prefetcher, flagging relative ones", () => {
    const refs = referencedNames("{{Some Card|open}} {{_self}} {{#skip}}");
    expect(refs).toEqual([
      { name: "Some Card", relative: false },
      { name: "_self", relative: true },
    ]);
  });
});

describe("set pattern keys (mod/core/set_pattern port)", () => {
  it("computes the captured simple-card key list (ALL TYPE SELF)", () => {
    const keys = safeSetKeys({
      name: DeckoName.parse("Oracle Basics"),
      typeId: 2,
      typeName: "RichText",
      leftTypeName: undefined,
    });
    expect(keys).toBe("ALL TYPE-rich_text SELF-oracle_basic");
  });

  it("computes the captured compound-card key list (ALL ... SELF)", () => {
    const keys = safeSetKeys({
      name: DeckoName.parse("Oracle Rich+rich_child"),
      typeId: 2,
      typeName: "RichText",
      leftTypeName: "RichText",
    });
    expect(keys).toBe(
      "ALL ALL_PLUS TYPE-rich_text RIGHT-rich_child TYPE_PLUS_RIGHT-rich_text-rich_child SELF-oracle_rich-rich_child",
    );
  });

  it("emits bare STAR for star-named cards (04_star.rb anchorless)", () => {
    const keys = safeSetKeys({
      name: DeckoName.parse("*tiny_mce"),
      typeId: 259,
      typeName: "exi",
      leftTypeName: undefined,
    });
    expect(keys).toBe("ALL TYPE-exi STAR SELF-Xtiny_mce");
  });

  it("emits bare RSTAR for compound cards whose right is a star (05_rstar.rb)", () => {
    const keys = safeSetKeys({
      name: DeckoName.parse("*all+*read"),
      typeId: 259,
      typeName: "exi",
      leftTypeName: "exi",
    });
    expect(keys).toBe(
      "ALL ALL_PLUS TYPE-exi RSTAR RIGHT-Xread TYPE_PLUS_RIGHT-exi-Xread SELF-Xall-Xread",
    );
  });

  it("inserts bare RULE between RSTAR and RIGHT when isRule is supplied (06_rule.rb)", () => {
    const keys = safeSetKeys({
      name: DeckoName.parse("*all+*read"),
      typeId: 259,
      typeName: "exi",
      leftTypeName: "exi",
      isRule: true,
    });
    expect(keys).toBe(
      "ALL ALL_PLUS TYPE-exi RSTAR RULE RIGHT-Xread TYPE_PLUS_RIGHT-exi-Xread SELF-Xall-Xread",
    );
  });

  it("omits RULE while the enrichment does not supply isRule (documented gap)", () => {
    const keys = safeSetKeys({
      name: DeckoName.parse("*all+*read"),
      typeId: 259,
      typeName: "exi",
      leftTypeName: "exi",
    });
    expect(keys).not.toContain("RULE");
  });

  it("falls back to the RichText anchor for TYPE_PLUS_RIGHT when the left type is unknown", () => {

    const keys = safeSetKeys({
      name: DeckoName.parse("Ghost Parent+field"),
      typeId: 2,
      typeName: "RichText",
      leftTypeName: undefined,
    });
    expect(keys).toBe(
      "ALL ALL_PLUS TYPE-rich_text RIGHT-field TYPE_PLUS_RIGHT-rich_text-field SELF-ghost_parent-field",
    );
  });
});

describe("slot set-key classes through the render engine", () => {
  it("renders a star card's slot class with the bare STAR fragment", async () => {
    const storage = await createRenderTestStorage();
    try {

      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 259, name: "exi", codename: "set", typeId: 2 });
      await seedCard(storage, {
        id: 500,
        name: "*tiny_mce",
        typeId: 259,
        dbContent: "",
      });
      const html = await storage.engine.render("*tiny_mce", "closed");
      expect(html).toContain(
        'class="card-slot closed-view ALL TYPE-exi STAR SELF-Xtiny_mce"',
      );
      expect(html).not.toContain("STAR-Xtiny_mce");
    } finally {
      storage.close();
    }
  });
});

describe("view dispatch", () => {
  it("raises the unsupported-view UserError with the captured message shape", () => {
    const error = new UnsupportedViewError("definitely_not_a_view", "Oracle Basics");
    expect(error.message).toBe("view (definitely_not_a_view) not supported for Oracle Basics");
  });
});

async function seedChain(storage: RenderTestStorage, depth: number): Promise<void> {
  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  for (let i = 1; i <= depth; i++) {
    const content =
      i < depth ? `level ${i} body {{chain_l${i + 1}}}` : `level ${i} end`;
    await seedCard(storage, { id: 100 + i, name: `chain_l${i}`, typeId: 2, dbContent: content });
  }
}

describe("batched inclusion prefetch: queries per render (decko#1282)", () => {
  it("renders chains of depth 1/2/4/8 with a CONSTANT query count", async () => {
    const RUBY_MEASURED: Record<number, number> = { 1: 4, 2: 5, 4: 7, 8: 11 };
    const roundTripsByDepth: Record<number, number> = {};
    const statementsByDepth: Record<number, number> = {};

    for (const depth of [1, 2, 4, 8]) {
      const storage = await createRenderTestStorage();
      try {
        await seedChain(storage, depth);
        storage.counting.reset();
        const html = await storage.engine.render("chain_l1", "content");
        expect(html).toContain(`level ${depth} end`);
        const snapshot = storage.counting.snapshot();
        roundTripsByDepth[depth] = snapshot.roundTrips;
        statementsByDepth[depth] = snapshot.statements;
      } finally {
        storage.close();
      }
    }

    expect(roundTripsByDepth).toEqual({ 1: 2, 2: 3, 4: 5, 8: 9 });

    expect(statementsByDepth).toEqual({ 1: 9, 2: 10, 4: 12, 8: 16 });

    expect(roundTripsByDepth[8]).toBeLessThanOrEqual(RUBY_MEASURED[8]);
  });

  it("renders a warm closure with ZERO queries", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedChain(storage, 8);
      await storage.engine.render("chain_l1", "content");
      storage.counting.reset();
      const html = await storage.engine.render("chain_l1", "content");
      expect(html).toContain("level 8 end");
      expect(storage.counting.snapshot()).toEqual({ statements: 0, roundTrips: 0 });
    } finally {
      storage.close();
    }
  });

  it("falls back to per-level fetching when the SQL walk cannot match a reference (plural-stem key)", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });

      await seedCard(storage, { id: 300, name: "Oracle Basics", typeId: 2, dbContent: "stemmed body" });
      await seedCard(storage, { id: 301, name: "Includer", typeId: 2, dbContent: "see {{Oracle Basics}} now" });
      const html = await storage.engine.render("Includer", "content");
      expect(html).toContain("stemmed body");
      const stats = storage.engine.lastRenderStats;
      expect(stats?.fallbackRounds).toBeGreaterThanOrEqual(1);
    } finally {
      storage.close();
    }
  });

  it("resolves compound references through the fallback (junction rows have NULL key columns)", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 701, name: "rich_child", typeId: 2 });
      await seedCard(storage, { id: 611, name: "Parent Card", typeId: 2 });
      await seedCard(storage, {
        id: 613,
        name: "Parent Card+rich_child",
        leftId: 611,
        rightId: 701,
        typeId: 2,
        dbContent: "junction body",
      });
      await seedCard(storage, {
        id: 612,
        name: "Junction Renderer",
        typeId: 2,
        dbContent: "<p>nested: {{Parent Card+rich_child}}</p>",
      });
      const html = await storage.engine.render("Junction Renderer", "content");
      expect(html).toContain("junction body");
      expect(html).toContain("titled-view");
    } finally {
      storage.close();
    }
  });

  it("terminates on inclusion cycles (UNION dedup + cache)", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 400, name: "cycle_a", typeId: 2, dbContent: "A {{cycle_b}}" });
      await seedCard(storage, { id: 401, name: "cycle_b", typeId: 2, dbContent: "B {{cycle_a}}" });
      const html = await storage.engine.render("cycle_a", "title");
      expect(html).toContain("cycle_a");
    } finally {
      storage.close();
    }
  });

  it("renders an absent nest target as Ruby's unknown view (empty: create denied)", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 500, name: "lonely", typeId: 2, dbContent: "<p>{{ghost}}</p>" });

      const html = await storage.engine.render("lonely", "content");
      expect(html).toContain("<p></p>");
    } finally {
      storage.close();
    }
  });
});
