// Unit pin for the blank nest reference (`{{}}`): Ruby's fetch layer returns
// NIL for a blank mark (lib/card/fetch.rb#retrieve_existing `return unless
// mark.present?` -> results.rb#results `return if card.nil?`), so the blank
// reference renders neither a card nor an unknown card - it surfaces the
// html denial span (card-mod-format-0.20.0 set/all/html/error.rb
// #quiet_denial with task :read).
//
// Corpus oracle: fixtures/corpus/shard-000000.jsonl entry 636
// (thez+*right+*default) carries `{{}}` mid-text and its captured content
// view shows the literal text joined directly onto
// `<span class="denied"><!-- Sorry, you don't have permission (read)
// --></span>`. (The full entry is not replayed in
// unknown-nest-corpus-replay.test.ts because its slot classes carry the
// RULE set-key the set-keys stream has in flight - observed-not-mine.)

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("blank nest reference ({{}})", () => {
  it("renders Ruby's quiet denial span where the blank reference stood", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 900,
        name: "blank ref source",
        typeId: 2,
        dbContent: "<p>before{{}}after</p>",
      });
      const html = await storage.engine.render("blank_ref_source", "content");
      expect(html).toContain("<p>before<span class=\"denied\"><!-- Sorry, you don't have permission (read) --></span>after</p>");
    } finally {
      storage.close();
    }
  });
});
