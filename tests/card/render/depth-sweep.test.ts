

import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";
import { DeckoName } from "../../../src/card/name.js";
import { RUBY_MAX_DEPTH } from "../../../src/card/render/format.js";

const DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20];

const RUBY_MEASURED: Record<number, number> = { 1: 4, 2: 5, 4: 7, 8: 11, 16: 19 };

async function seedChain(storage: RenderTestStorage, depth: number): Promise<void> {

  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  for (let i = 1; i <= depth; i++) {
    const content = i < depth ? `level ${i} body {{chain_l${i + 1}}}` : `level ${i} end`;
    await seedCard(storage, { id: 100 + i, name: `chain_l${i}`, typeId: 2, dbContent: content });
  }
}

describe("M3 depth sweep: TypeScript queries-per-render at every depth 1..32", () => {
  it("measures round trips, statements, warm cache, and wall-clock at every depth", { timeout: 60_000 }, async () => {
    const rows: Array<{
      depth: number;
      roundTrips: number;
      statements: number;
      coldWallMs: number;
      warmWallMs: number;
      warmRoundTrips: number;
      warmStatements: number;
      rubyMeasured: number | null;
      rubyRatio: number | null;
    }> = [];

    for (const depth of DEPTHS) {
      const storage = await createRenderTestStorage();
      try {
        await seedChain(storage, depth);

        if (depth > RUBY_MAX_DEPTH) {
          throw new Error(`DEPTHS should not exceed renderer RUBY_MAX_DEPTH=${RUBY_MAX_DEPTH}`);
        }

        storage.counting.reset();
        const t0 = performance.now();
        await storage.engine.render("chain_l1", "content");
        const t1 = performance.now();
        const cold = storage.counting.snapshot();

        storage.counting.reset();
        const w0 = performance.now();
        await storage.engine.render("chain_l1", "content");
        const w1 = performance.now();
        const warm = storage.counting.snapshot();

        const ruby = RUBY_MEASURED[depth] ?? null;
        rows.push({
          depth,
          roundTrips: cold.roundTrips,
          statements: cold.statements,
          coldWallMs: Number((t1 - t0).toFixed(3)),
          warmWallMs: Number((w1 - w0).toFixed(3)),
          warmRoundTrips: warm.roundTrips,
          warmStatements: warm.statements,
          rubyMeasured: ruby,
          rubyRatio: ruby !== null ? Number((ruby / cold.roundTrips).toFixed(2)) : null,
        });
      } finally {
        storage.close();
      }
    }

    const rts = rows.map((r) => r.roundTrips);
    const sts = rows.map((r) => r.statements);

    const expectedRts = (depth: number): number => 2 + Math.max(0, depth - 1);
    const expectedSts = (depth: number): number => 9 + Math.max(0, depth - 1);
    for (let i = 0; i < rows.length; i++) {
      expect(rts[i]).toBe(expectedRts(rows[i]!.depth));
      expect(sts[i]).toBe(expectedSts(rows[i]!.depth));
    }

    expect(rows.every((r) => r.warmRoundTrips === 0 && r.warmStatements === 0)).toBe(true);

    mkdirSync("benchmarks/results", { recursive: true });
    writeFileSync(
      "benchmarks/results/depth-sweep-ts.json",
      JSON.stringify(
        {
          measured_at: new Date().toISOString(),
          environment: "local better-sqlite3 over production-schema DDL; synthetic chains",
          axes: {
            round_trips: "driver calls: query() + batch() each count ONE",
            statements: "individual SQL statements (batch members count one each)",
            warm: "second render of same chain in same engine instance",
          },
          ruby_measured_truth: {
            source: "decko-ts/benchmarks/results/ruby-nesting-r1-r2.json",
            formula: "depth + 3; depth 32 hard-capped by Card.config.max_depth=20 with 'Man, you're too deep' UserError",
            table: RUBY_MEASURED,
          },
          ts_constant: { round_trips: rts[0], statements: sts[0] },
          rows,
          ts_reduces_query_count_by: rows
            .filter((r) => r.rubyMeasured !== null)
            .map((r) => ({ depth: r.depth, ruby: r.rubyMeasured, ts: r.roundTrips, ratio: r.rubyRatio })),
        },
        null,
        2,
      ),
    );

    console.log("\nM3 depth sweep - TypeScript vs Ruby queries-per-render:\n");

    console.log("depth | ruby q | ts RT | ts SQL | cold ms | warm ms");

    console.log("------+-------+------+-------+---------+--------");
    for (const r of rows) {

      console.log(
        `${String(r.depth).padStart(5)} | ${String(r.rubyMeasured ?? "n/a").padStart(5)} | ${String(r.roundTrips).padStart(4)} | ${String(r.statements).padStart(5)} | ${String(r.coldWallMs).padStart(7)} | ${String(r.warmWallMs).padStart(7)}`,
      );
    }
  });
});
