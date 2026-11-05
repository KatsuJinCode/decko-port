

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

describe("pointer/list trailing-newline byte-level pin (M3 family: unclassified:L/~/exp=\\n/act=<)", () => {
  it(
    "*home content view ends with </div>\\n</div> — closing div chain is spaced so the outer slot-wrap close lands on its own line",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(77);
      baseIds.add(34840);
      baseIds.add(6568);
      storage = await createStructureSeededStorageFor(baseIds);
      const html = await storage.engine.render("*home", "content");

      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      expect(html).toContain('id="yzzw-mini_bar-view"');
      expect(html).toContain('<span class="denied">');

      const expectedCloseChain = "</div>\n</div></div></div>\n</div>";
      expect(html).toContain(expectedCloseChain);

      expect(html).not.toContain("</div>\n</div></div></div></div>");

    },
  );

  it(
    "rule+permission-right simple wrapper (`<div class=\"pointer-list\">`) also appends \\n before its closing </div>",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(275);

      baseIds.add(6568);
      storage = await createStructureSeededStorageFor(baseIds);
      await seedCard(storage, {
        id: 9020,
        name: "bifaarykabanhm",
        typeId: 22281,
        readRuleId: 6568,
        readRuleClass: "*all",
      });
      const html = await storage.engine.render("*all+*layout", "content");

      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      expect(html).toContain("</div>\n</div></div></div>\n</div>");

      expect(html).not.toContain("</div>\n</div></div></div></div>");
    },
  );

  it(
    "rule+permission-right simple wrapper (`<div class=\"pointer-list\">`) does NOT append \\n before its closing </div> (M4 family: unclassified:L/~/exp=</act=\\n)",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(6551);
      baseIds.add(6568);
      storage = await createStructureSeededStorageFor(baseIds);
      await seedCard(storage, {
        id: 9010,
        name: "irjkznnbpewjpr",
        typeId: 22281,
        readRuleId: 6568,
        readRuleClass: "*all",
      });
      const html = await storage.engine.render("*star+*create", "content");

      expect(html).toContain('<div class="pointer-list">');
      expect(html).not.toContain('<div class="card-list card-list-bar pointer-list">');

      expect(html).toContain("</div>\n</div></div></div></div>");

      expect(html).not.toContain("</div>\n</div></div></div>\n</div>");
    },
  );
});
