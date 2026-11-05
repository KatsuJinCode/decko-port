import { LocalSqliteToolDriver } from "./import.mjs";
import { FetchEngine } from "../../src/card/fetch.ts";
import { RenderEngine } from "../../src/card/render.ts";
import { applyDeckInflections } from "../../src/card/name/inflect.ts";
import { CARD_GEM_INITIALIZER_INFLECTIONS } from "../../src/card/name/oracle-deck-inflections.ts";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: render-every-card.mjs <staging.sqlite>");
  process.exit(2);
}
applyDeckInflections(CARD_GEM_INITIALIZER_INFLECTIONS);

const driver = new LocalSqliteToolDriver(dbPath, { readonly: true });
const fetcher = new FetchEngine(driver);
const renderer = new RenderEngine(fetcher);
const ids = (await driver.query("SELECT id FROM cards WHERE trash = 0 ORDER BY id", [])).rows.map((r) => Number(r.id));
const limit = process.env.RENDER_EVERY_CARD_LIMIT ? Number(process.env.RENDER_EVERY_CARD_LIMIT) : ids.length;

const VIEWS = ["page", "core"];
const out = { attempted: 0, fetchMisses: 0, views: {}, ms: 0 };
for (const v of VIEWS) out.views[v] = { rendered: 0, renderErrors: 0, errorClasses: {}, bytes: 0, ms: 0 };
const stackShown = new Set();
const t0 = Date.now();
for (const id of ids.slice(0, limit)) {
  out.attempted += 1;
  const record = await fetcher.fetchById(id);
  if (record === undefined || record.name === undefined || record.name.s === "") {
    out.fetchMisses += 1;
    continue;
  }
  for (const view of VIEWS) {
    const v = out.views[view];
    const tv = Date.now();
    try {
      const html = view === "page" ? await renderer.renderPage(record.name.s) : await renderer.render(record.name.s, view);
      v.rendered += 1;
      v.bytes += Buffer.byteLength(html, "utf8");
    } catch (err) {
      v.renderErrors += 1;
      const cls = err?.constructor?.name ?? "unknown";
      v.errorClasses[cls] = (v.errorClasses[cls] ?? 0) + 1;
      if (process.env.RENDER_EVERY_CARD_STACKS === "1" && !stackShown.has(`${view}:${cls}`)) {
        stackShown.add(`${view}:${cls}`);
        process.stderr.write(`first ${view} ${cls}: ${err?.stack ?? err}\n`);
      }
    }
    v.ms += Date.now() - tv;
  }
  if (out.attempted % 2000 === 0) {
    process.stderr.write(`render: ${out.attempted}/${ids.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    renderer.resetCaches();
    fetcher.resetCaches();
  }
}
out.ms = Date.now() - t0;
console.log(JSON.stringify(out));
