

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

describe("pointer/list content view: outer-wrapper branch + phantom-item mini_bar (M3 fix pins)", () => {
  it(
    "*star+*create list rule card renders the simple <div class=\"pointer-list\"> outer wrapper (no card-list-bar prefix)",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(6551);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);
      const html = await storage.engine.render("*star+*create", "content");

      expect(html).toContain('<div class="pointer-list">');
      expect(html).not.toContain('<div class="card-list card-list-bar pointer-list">');

      expect(html).toContain('<div class="pointer-item item-bar">');
      expect(html).toContain('id="irjkznnbpewjpr-mini_bar-view"');
      expect(html).toContain('id="wautvrx-mini_bar-view"');
    },
  );

  it(
    "*all+*layout list rule card (non-permission right) still renders the full <div class=\"card-list card-list-bar pointer-list\"> prefix",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(275);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);

      const html = await storage.engine.render("*all+*layout", "content");

      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      expect(html).not.toMatch(/<div class="pointer-list">/);
    },
  );

  it(
    "non-rule pointer card renders the full card-list-bar prefix (the previous default shape is preserved)",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(77);
      baseIds.add(34840);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);

      const html = await storage.engine.render("*home", "content");
      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
    },
  );

  it(
    "phantom pointer/list item renders the mini_bar slot wrap + bar body + two denied spans",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(77);
      baseIds.add(34840);
      baseIds.add(22283);

      storage = await createStructureSeededStorageFor(baseIds);
      const html = await storage.engine.render("*home", "content");

      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');

      expect(html).toContain('id="yzzw-mini_bar-view"');
      expect(html).toContain('class="card-slot mini_bar-view');
      expect(html).toMatch(/data-slot="[^"]*&quot;view&quot;:&quot;bar&quot;/);

      expect(html).toContain("<div class='bar ALL TYPE-basic_c with-bar-menu nodblclick d-flex _card-link'");

      const deniedCount = (html.match(/<span class="denied"><!-- Sorry, you don't have permission \(read\) --><\/span>/g) || []).length;
      expect(deniedCount).toBe(2);

      expect(html).toContain('data-card-type-id="22281"');

      expect(html).toContain('data-card-type-name="swtktey"');

      expect(html).toContain("data-card-type-id='22281'");
      expect(html).toContain("data-card-type-name='CustomBasic'");
    },
  );
});