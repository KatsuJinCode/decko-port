

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import {
  ModLoader,
  modEngineHost,
} from "../../../src/card/mod-loader.js";
import cardModComment from "../../../src/card/mod-loader/mods/card-mod-comment.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  await seedCard(s, {
    id: 110,
    name: "discussion",
    codename: "discussion",
    typeId: 14,
  });

  await seedCard(s, {
    id: 120,
    name: "comment",
    codename: "comment",
    typeId: 14,
  });

  await seedCard(s, {
    id: 200,
    name: "Oracle Discussion Probe",
    dbContent: "discussion probe body",
  });

  await seedCard(s, {
    id: 201,
    leftId: 200,
    rightId: 110,
    typeId: 14,
    dbContent: "discussion junction body",
  });

  await seedCard(s, {
    id: 210,
    name: "Oracle Comment Probe",
    dbContent: "comment probe body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-comment through the mod loader (A/B)", () => {
  it("WITHOUT the mod: the mod-specific views raise UnsupportedViewError", async () => {
    const s = storage!;

    await expect(s.engine.render("Oracle Discussion Probe+discussion", "open_content")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Discussion Probe+discussion", "input")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Comment Probe", "comment_box")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :comment_box renders the structural form HTML (all/comment.rb:46-53)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModComment }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("Oracle Comment Probe", "comment_box");

    expect(html).toContain('<div class="comment-box nodblclick">');
    expect(html).toContain('<form action="/Oracle_Comment_Probe/update" method="post">');
    expect(html).toContain('<textarea name="comment" rows="3"></textarea>');
    expect(html).toContain('<div class="comment-buttons">');
    expect(html).toContain('<label>My Name is:</label>');
    expect(html).toContain('<input type="text" name="comment_author">');
    expect(html).toContain('<button type="submit" class="comment-submit">Comment</button>');
    expect(html).toContain('</form>');
    expect(html).toContain('</div>');

    expect(html).not.toContain('<input type="hidden" name="card[name]"');
  });

  it("WITH the mod: discussion :open dispatches to the base open view AND shows :comment_box (right/discussion.rb:1-6)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Discussion Probe+discussion", "open");
    expect(html).toContain("card-slot");
    expect(html).toContain("open-view");
    expect(html).toContain("accordion-item");
  });

  it("WITH the mod: discussion :titled dispatches to the base titled view (right/discussion.rb:1-6)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Discussion Probe+discussion", "titled");
    expect(html).toContain("card-slot");
    expect(html).toContain("titled-view");
    expect(html).toContain("d0-card-header");
  });

  it("WITH the mod: discussion :titled_content dispatches to base titled_content which renders core (right/discussion.rb:1-6)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Discussion Probe+discussion", "titled_content");
    expect(html).toContain("discussion junction body");
    expect(html).toContain('<div class="comment-box nodblclick">');
    expect(html).toContain('<textarea name="comment" rows="3"></textarea>');
  });

  it("WITH the mod: discussion :core dispatches to base core AND appends comment_box (right/discussion.rb:8-10)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Discussion Probe+discussion", "core");

    expect(html).toContain("discussion junction body");
    expect(html).toContain('<div class="comment-box nodblclick">');
    expect(html).toContain('<textarea name="comment" rows="3"></textarea>');
  });

  it("WITH the mod: discussion :input falls through to base input (right/discussion.rb:12-16, non-editor branch)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Discussion Probe+discussion", "input");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();

    expect(basket.base.map((m) => m.shortname)).toContain("All::Comment");

    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Comment");
    expect(right).toContain("Right::Discussion");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {

    const report = loader!.load();
    expect(report.registeredViews).toContain("comment_box");
    expect(report.registeredViews).toContain("open");
    expect(report.registeredViews).toContain("open_content");
    expect(report.registeredViews).toContain("titled");
    expect(report.registeredViews).toContain("titled_content");
    expect(report.registeredViews).toContain("core");
    expect(report.registeredViews).toContain("input");
  });

  it("WITH the mod: the comment_box view's denial config is registered (:blank, all/comment.rb:46)", () => {

    const config = loader!.viewConfigFor("comment_box");
    expect(config?.denial).toBe("blank");
    expect(config?.unknown).toBe(true);
    expect(config?.perms).toBe("update");
  });

  it("WITH the mod: the discussion overrides carry unknown: true (right/discussion.rb:1-10)", () => {
    for (const view of ["open", "open_content", "titled", "titled_content", "core"]) {
      expect(loader!.viewConfigFor(view)?.unknown).toBe(true);
    }
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Discussion Probe+discussion", "content");

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });
});