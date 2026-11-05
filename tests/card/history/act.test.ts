

import { describe, expect, it } from "vitest";
import { assignActor, sqlDateTime } from "../../../src/card/history/act.js";

describe("assignActor", () => {

  it("keeps an explicitly assigned actor (the ||= keeps existing values)", () => {
    expect(assignActor(42, 1)).toBe(42);
  });

  it("fills a blank actor from the current user", () => {
    expect(assignActor(null, 1)).toBe(1);
    expect(assignActor(undefined, 1)).toBe(1);
  });
});

describe("sqlDateTime", () => {

  it("formats UTC datetimes as fixed-width TEXT", () => {
    expect(sqlDateTime(new Date("2026-09-19T12:34:56.789Z"))).toBe("2026-09-19 12:34:56.789");
    expect(sqlDateTime(new Date("2022-04-01T14:38:11.000Z"))).toBe("2022-04-01 14:38:11.000");
  });

  it("keeps millisecond width for single-digit milliseconds", () => {

    expect(sqlDateTime(new Date("2026-01-02T03:04:05.006Z"))).toBe("2026-01-02 03:04:05.006");
  });
});
