

import { describe, it, expect, afterAll } from "vitest";
import {
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { type RenderTestStorage, seedCard } from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

describe("pointer/list open-view accordion-body omits the content-view slot wrap (permfix48 family: unclassified:L/~/exp=c/act=i)", () => {
  it(
    "*star+*create list rule open view: accordion-body contains the pointer-list directly (no X-content-view wrap)",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(6551);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);
      const html = await storage.engine.render("*star+*create", "open");

      expect(html).toContain('id="Xstar-Xcreate-open-view"');

      expect(html).toContain("accordion-body");

      expect(html).toContain('<div class="pointer-list">');

      expect(html).toContain('id="irjkznnbpewjpr-mini_bar-view"');

      const accordionBodyIdx = html.indexOf("accordion-body");
      const accordionBodySlice = html.slice(accordionBodyIdx);
      expect(accordionBodySlice).not.toContain(
        'id="Xstar-Xcreate-content-view"',
      );
      expect(accordionBodySlice).not.toContain("card-slot content-view");

      expect(accordionBodySlice).toMatch(
        /accordion-body[^>]*>\s*<div class="pointer-list">/,
      );
    },
  );

  it(
    "*home pointer open view: the options-card parse boundary raises (corpus:77 truth) — and with a valid *content options rule the card-list-bar wrapper renders INSIDE a content-view slot wrap (CLUSTER 3 set-card-pointer-list-vs-nested-content)",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(77);
      baseIds.add(34840);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);
      await seedCard(storage, {
        id: 9020,
        name: "yzzw",
        typeId: 22281,
        readRuleId: 22283,
        readRuleClass: "*type",
      });
      let captured: unknown;
      try {
        await storage.engine.render("*home", "open");
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).constructor.name).toBe("Card::Error::BadQuery");
      expect((captured as Error).message).toBe("Invalid JSON search query: fr");

      await seedCard(storage, { id: 9021, name: "wrapper probe", typeId: 34840, dbContent: "" });
      await seedCard(storage, {
        id: 9022,
        name: "wrapper probe+*self",
        leftId: 9021,
        rightId: 264,
        typeId: 259,
      });
      await seedCard(storage, {
        id: 9023,
        name: "wrapper probe+*self+*content options",
        leftId: 9022,
        rightId: 86,
        typeId: 30,
        dbContent: '{"type":"Basic"}',
      });
      const html = await storage.engine.render("wrapper_probe", "open");

      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');

      expect(html).toContain('id="wrapper_probe-content-view"');
      expect(html).toContain('class="card-slot content-view');

      const accordionBodyIdx = html.indexOf("accordion-body");
      const accordionBodySlice = html.slice(accordionBodyIdx);
      expect(accordionBodySlice).toMatch(
        /accordion-body[^>]*>\s*<div id="wrapper_probe-content-view"[^>]*card-slot content-view[^>]*>\s*<div class="card-list card-list-bar pointer-list">/,
      );
    },
  );
});
