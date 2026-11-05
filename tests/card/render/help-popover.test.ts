

import { describe, expect, it } from "vitest";
import { installHelpRules } from "../../../src/card/render/help-popover.js";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

const SET_TYPE_ID = 10;
const SETTING_TYPE_ID = 11;
const BASIC_TYPE_ID = 2;

async function seedCodenameCards(storage: RenderTestStorage): Promise<void> {
  await seedCard(storage, { id: 5, name: "Cardtype", typeId: 5 });
  await seedCard(storage, { id: 2, name: "Basic", typeId: 5 });
  await seedCard(storage, { id: 10, name: "Set", codename: "set", typeId: 5 });
  await seedCard(storage, { id: 11, name: "Setting", codename: "setting", typeId: 5 });
  await seedCard(storage, { id: 12, name: "User", codename: "user", typeId: 5 });
}

function helpContentOf(html: string): string {
  const marker = 'data-bs-content="';
  const start = html.indexOf(marker);
  expect(start, "menu help anchor present").toBeGreaterThanOrEqual(0);
  const rest = html.slice(start + marker.length);
  const end = rest.indexOf('"');
  return rest.slice(0, end);
}

describe("menu help popover (help.rb + popover_opts + board_rules_editor port)", () => {
  it("renders a readable *help rule card: d-none edit-link span + rule content", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);

      await seedCard(storage, { id: 100, name: "Wysiwyg Card", typeId: BASIC_TYPE_ID });
      await seedCard(storage, { id: 101, name: "*help", codename: "help", typeId: SETTING_TYPE_ID });
      await seedCard(storage, { id: 104, name: "*self", codename: "self", typeId: SETTING_TYPE_ID });
      await seedCard(storage, {
        id: 102, leftId: 100, rightId: 104, typeId: SET_TYPE_ID,
      });
      await seedCard(storage, {
        id: 103, leftId: 102, rightId: 101, typeId: SETTING_TYPE_ID,
        dbContent: "<p>custom help bytes</p>",
      });
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      await resolver.prepare();

      const html = await storage.engine.render("Wysiwyg Card", "closed");
      expect(helpContentOf(html)).toBe(
        "&lt;span class=&#39;d-none&#39;&gt;" +

        "&lt;a rel=&quot;nofollow&quot; class=&quot;edit-link slotter&quot; title=&quot;Edit&quot;" +
        " data-bs-toggle=&quot;tooltip&quot; data-bs-placement=&quot;bottom&quot;" +
        " data-slotter-mode=&quot;modal&quot; data-modal-class=&quot;modal-lg&quot;" +
        " href=&quot;/Wysiwyg_Card+*self+*help/rule_edit&quot; data-remote=&quot;true&quot;&gt;" +
        "&lt;i class=&quot;notranslate material-icons&quot;&gt;edit&lt;/i&gt; &lt;/a&gt;" +
        "&lt;/span&gt;" +
        "&lt;p&gt;custom help bytes&lt;/p&gt;",
      );
    } finally {
      storage.close();
    }
  });

  it("keeps the &nbsp; placeholder for cards with no help rule and no setting text", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);
      await seedCard(storage, { id: 110, name: "Plain Card", typeId: BASIC_TYPE_ID });
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      await resolver.prepare();

      const html = await storage.engine.render("Plain Card", "closed");
      expect(helpContentOf(html)).toBe("&amp;nbsp;");
    } finally {
      storage.close();
    }
  });

  it("serves the setting help_text to the setting card itself, links processed", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);
      await seedCard(storage, {
        id: 200, name: "*thanks", codename: "thanks", typeId: SETTING_TYPE_ID,
      });
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      await resolver.prepare();

      const html = await storage.engine.render("*thanks", "closed");
      expect(helpContentOf(html)).toBe(
        "Destination after card is created. " +
        "&lt;a target=&quot;_blank&quot; class=&quot;external-link&quot;" +
        " href=&quot;http://decko.org/Custom_thank_you_messages_for_forms&quot;&gt;more&lt;/a&gt;",
      );
    } finally {
      storage.close();
    }
  });

  it("serves the right-set help_text to cards whose right is the setting card", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);
      await seedCard(storage, { id: 210, name: "*thanks", codename: "thanks", typeId: SETTING_TYPE_ID });
      await seedCard(storage, { id: 211, name: "Lesson", typeId: BASIC_TYPE_ID });
      await seedCard(storage, {
        id: 212, leftId: 211, rightId: 210, typeId: BASIC_TYPE_ID, dbContent: "x",
      });
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      await resolver.prepare();

      const html = await storage.engine.render("Lesson+*thanks", "closed");
      expect(helpContentOf(html)).toContain("Destination after card is created.");

      expect(helpContentOf(html)).not.toContain("ms-auto");
    } finally {
      storage.close();
    }
  });

  it("renders the RULE-card variant: joined setting_link with the live rule count", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);

      await seedCard(storage, { id: 300, name: "*default", codename: "default", typeId: SETTING_TYPE_ID });
      await seedCard(storage, { id: 305, name: "*right", codename: "right", typeId: SETTING_TYPE_ID });
      await seedCard(storage, {
        id: 301, name: "*content options", codename: "content_options", typeId: SETTING_TYPE_ID,
      });
      await seedCard(storage, {
        id: 302, leftId: 301, rightId: 305, typeId: SET_TYPE_ID,
      });
      await seedCard(storage, {
        id: 303, leftId: 302, rightId: 300, typeId: SETTING_TYPE_ID, dbContent: "pointer",
      });
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      await resolver.prepare();

      const html = await storage.engine.render("*content options+*right+*default", "closed");
      expect(helpContentOf(html)).toBe(
        " &lt;div class=&quot;ms-auto&quot;&gt;" +
        "&lt;a class=&quot;text-muted known-card&quot; href=&quot;/*default&quot;&gt;" +
        " (1 default rules)&lt;/a&gt;&lt;/div&gt;",
      );
    } finally {
      storage.close();
    }
  });

  it("renders internal link chunks as wanted-card anchors (the :link view)", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);
      await seedCard(storage, { id: 400, name: "*read", codename: "read", typeId: SETTING_TYPE_ID });
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      await resolver.prepare();

      const html = await storage.engine.render("*read", "closed");

      expect(helpContentOf(html)).toBe(
        "Who can view cards in the " +
        "&lt;a class=&quot;wanted-card&quot; href=&quot;/Set&quot;&gt;" +
        "&lt;span class=&quot;card-title&quot; title=&quot;Set&quot;&gt;Set&lt;/span&gt;&lt;/a&gt;.",
      );
    } finally {
      storage.close();
    }
  });

  it("resolves the rule chain in pattern precedence: a *self rule beats *all", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);
      await seedCard(storage, { id: 500, name: "*help", codename: "help", typeId: SETTING_TYPE_ID });
      await seedCard(storage, { id: 501, name: "*all", codename: "all", typeId: SET_TYPE_ID });
      await seedCard(storage, { id: 502, leftId: 501, rightId: 500, typeId: SETTING_TYPE_ID, dbContent: "ALL HELP" });
      await seedCard(storage, { id: 520, name: "*self", codename: "self", typeId: SETTING_TYPE_ID });
      await seedCard(storage, { id: 510, name: "Specific Card", typeId: BASIC_TYPE_ID });
      await seedCard(storage, { id: 511, leftId: 510, rightId: 520, typeId: SET_TYPE_ID });
      await seedCard(storage, {
        id: 512, leftId: 511, rightId: 500, typeId: SETTING_TYPE_ID, dbContent: "SELF HELP",
      });
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      await resolver.prepare();

      const html = await storage.engine.render("Specific Card", "closed");
      expect(helpContentOf(html)).toContain("SELF HELP");
      const allHtml = await storage.engine.render("*all", "closed");
      expect(helpContentOf(allHtml)).toContain("ALL HELP");
    } finally {
      storage.close();
    }
  });

  it("query shape: one prepare batch per engine, warm re-renders stay at zero", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);
      await seedCard(storage, { id: 600, name: "Queried Card", typeId: BASIC_TYPE_ID });
      await seedCard(storage, { id: 601, name: "*help", codename: "help", typeId: SETTING_TYPE_ID });
      await seedCard(storage, { id: 602, leftId: 600, rightId: 601, typeId: SET_TYPE_ID });
      await seedCard(storage, {
        id: 603, leftId: 602, rightId: 601, typeId: SETTING_TYPE_ID, dbContent: "<p>help</p>",
      });
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      const beforePrepare = storage.counting.snapshot();
      await resolver.prepare();
      const afterPrepare = storage.counting.snapshot();

      await storage.engine.render("Queried Card", "closed");
      const afterFirstRender = storage.counting.snapshot();
      await storage.engine.render("Queried Card", "closed");
      await storage.engine.render("Queried Card", "open");
      const afterWarmRenders = storage.counting.snapshot();

      expect(afterPrepare.roundTrips - beforePrepare.roundTrips).toBeLessThanOrEqual(2);

      expect(afterWarmRenders.roundTrips).toBe(afterFirstRender.roundTrips);
      expect(afterWarmRenders.statements).toBe(afterFirstRender.statements);
    } finally {
      storage.close();
    }
  });

  it("setting_rule_count honors read_rules_hash: rules readable by the viewer only", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCodenameCards(storage);
      await seedCard(storage, { id: 700, name: "*default", codename: "default", typeId: SETTING_TYPE_ID });
      await seedCard(storage, { id: 701, name: "*right", codename: "right", typeId: SETTING_TYPE_ID });

      await seedCard(storage, { id: 702, name: "Set A", typeId: SET_TYPE_ID });
      await seedCard(storage, { id: 703, name: "Set B", typeId: SET_TYPE_ID });
      await seedCard(storage, { id: 704, name: "Set C", typeId: SET_TYPE_ID });

      await seedCard(storage, { id: 705, leftId: 702, rightId: 701, typeId: SET_TYPE_ID });
      await seedCard(storage, { id: 706, leftId: 703, rightId: 701, typeId: SET_TYPE_ID });
      await seedCard(storage, { id: 707, leftId: 704, rightId: 701, typeId: SET_TYPE_ID });

      await seedCard(storage, { id: 710, leftId: 705, rightId: 700, typeId: SETTING_TYPE_ID, dbContent: "A default" });
      await seedCard(storage, { id: 711, leftId: 706, rightId: 700, typeId: SETTING_TYPE_ID, dbContent: "B default", readRuleId: 7000 });
      await seedCard(storage, { id: 712, leftId: 707, rightId: 700, typeId: SETTING_TYPE_ID, dbContent: "C default", readRuleId: 8000 });

      const engineHost = storage.engine as unknown as {
        readPermission?: {
          readableRuleIds: ReadonlySet<number>;
          alwaysOk: boolean;
        };
      };
      engineHost.readPermission = {
        readableRuleIds: new Set<number>([7000]),
        alwaysOk: false,
      };
      const resolver = installHelpRules(storage.engine, storage.fetcher);
      await resolver.prepare();

      const ruleHtml = await storage.engine.render("Set A+*right+*default", "closed");
      expect(helpContentOf(ruleHtml)).toContain("(2 default rules)");
    } finally {
      storage.close();
    }
  });
});
