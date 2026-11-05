// Unit tests for the Card::Act write-side port (src/card/history/act.ts).
// Every expectation cites the Ruby file it derives from.

import { describe, expect, it } from "vitest";
import { assignActor, sqlDateTime } from "../../../src/card/history/act.js";

describe("assignActor", () => {
  // card-mod-history-0.20.0/lib/card/act.rb:131-134
  //   def assign_actor
  //     self.actor_id ||= Auth.current_id
  //   end
  it("keeps an explicitly assigned actor (the ||= keeps existing values)", () => {
    expect(assignActor(42, 1)).toBe(42);
  });

  it("fills a blank actor from the current user", () => {
    expect(assignActor(null, 1)).toBe(1);
    expect(assignActor(undefined, 1)).toBe(1);
  });
});

describe("sqlDateTime", () => {
  // db/schema.sqlite.sql mapping decision: UTC "YYYY-MM-DD HH:MM:SS.mmm",
  // space separator, fixed width, lexicographic == chronological.
  it("formats UTC datetimes as fixed-width TEXT", () => {
    expect(sqlDateTime(new Date("2026-09-19T12:34:56.789Z"))).toBe("2026-09-19 12:34:56.789");
    expect(sqlDateTime(new Date("2022-04-01T14:38:11.000Z"))).toBe("2022-04-01 14:38:11.000");
  });

  it("keeps millisecond width for single-digit milliseconds", () => {
    // toISOString always emits 3 digits; the slice is a no-op guard
    expect(sqlDateTime(new Date("2026-01-02T03:04:05.006Z"))).toBe("2026-01-02 03:04:05.006");
  });
});
