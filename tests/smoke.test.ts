import { describe, it, expect } from "vitest";
import type { SQLDatabaseDriver } from "../src/server/driver.js";

describe("scaffold", () => {
  it("driver interface is importable and type-checks", async () => {
    const stub: SQLDatabaseDriver = {
      query: async <T>() => ({ rows: [{ ok: 1 }] as T[], rowsAffected: 0 }),
      batch: async () => [],
    };
    expect((await stub.query<{ ok: number }>("select 1", [])).rows[0]).toEqual({ ok: 1 });
  });
});
