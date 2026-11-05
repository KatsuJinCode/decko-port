

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard, type RenderTestStorage } from "./render-test-storage.js";

async function seedAikido2Shape(storage: RenderTestStorage): Promise<void> {

  await seedCard(storage, {
    id: 97200,
    name: "Aikido 2",
    typeId: 2,
    dbContent: "<p>{{+overview|titled}}</p>\n<p>{{+management|closed}}</p>",
  });
  await seedCard(storage, { id: 97201, name: "overview", typeId: 2 });
  await seedCard(storage, {
    id: 97202,
    name: "Aikido 2+overview",
    leftId: 97200,
    rightId: 97201,
    typeId: 2,
    dbContent: "<p>the overview body</p>",
  });
}

describe("title_in_context: relative slot titles under the page context", () => {
  it("renders +overview/+management titles relative and the main title full (live /Aikido_2 shape)", async () => {
    const storage = await createRenderTestStorage();
    await seedAikido2Shape(storage);
    const html = await storage.engine.render("Aikido 2", "titled");

    expect(html).toContain('<span class="card-title" title="Aikido 2">');

    expect(html).toContain('<span class="card-title" title="+overview">');
    expect(html).not.toContain('title="Aikido 2+overview"');

    expect(html).toContain("&quot;home_view&quot;:&quot;titled&quot;,&quot;name_context&quot;:&quot;aikido_2&quot;}");

    expect(html).toContain('<span class="card-title" title="+management">');
    expect(html).not.toContain('title="Aikido 2+management"');
    const managementSlot = html.slice(html.indexOf("aikido_2-management-"));
    expect(managementSlot).not.toContain("name_context");
  });

  it("keeps the full junction title when the same card renders OUT of context", async () => {
    const storage = await createRenderTestStorage();
    await seedAikido2Shape(storage);

    const direct = await storage.engine.render("Aikido 2+overview", "titled");
    expect(direct).toContain('<span class="card-title" title="Aikido 2+overview">');

    expect(direct).not.toContain("name_context");
  });

  it("emits name_context on a known pointer/list item bar (live +Gallery shape)", async () => {
    const storage = await createRenderTestStorage();

    await seedCard(storage, { id: 10, name: "List", codename: "list", typeId: 2 });
    await seedCard(storage, {
      id: 97210,
      name: "Aikido Oak Cliff",
      typeId: 2,
      dbContent: "<p>{{+Pages|content}}</p>",
    });
    await seedCard(storage, { id: 97211, name: "Pages", typeId: 2 });
    await seedCard(storage, {
      id: 97212,
      name: "Aikido Oak Cliff+Pages",
      leftId: 97210,
      rightId: 97211,
      typeId: 10,
      dbContent: "Aikido Oak Cliff+Gallery\n",
    });
    await seedCard(storage, { id: 97213, name: "Gallery", typeId: 2 });
    await seedCard(storage, {
      id: 97214,
      name: "Aikido Oak Cliff+Gallery",
      leftId: 97210,
      rightId: 97213,
      typeId: 10,
      dbContent: "AOC_Dojo_01\n",
    });
    await seedCard(storage, { id: 97215, name: "AOC_Dojo_01", typeId: 2 });

    const html = await storage.engine.render("Aikido Oak Cliff", "titled");

    expect(html).toContain("&quot;nest_name&quot;:&quot;Aikido Oak Cliff+Gallery&quot;");
    expect(html).toContain("&quot;name_context&quot;:&quot;aikido_oak_cliff&quot;}");

    expect(html).toContain("&quot;nest_name&quot;:&quot;+Pages&quot;");
  });
});
