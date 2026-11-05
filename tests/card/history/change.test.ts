// Unit tests for the Card::Change write-side port (src/card/history/change.ts).
// Every expectation cites the Ruby file it derives from.

import { describe, expect, it } from "vitest";
import {
  TRACKED_FIELDS,
  changeValueForField,
  diffTrackedFields,
  serializeChangeValue,
  trackedFieldByIndex,
  trackedFieldIndex,
  type CardFieldState,
} from "../../../src/card/history/change.js";

describe("TRACKED_FIELDS", () => {
  // card-mod-history-0.20.0/lib/card/change.rb:25
  // TRACKED_FIELDS = %w[name type_id db_content trash left_id right_id]
  it("lists the six tracked fields in Ruby order", () => {
    expect([...TRACKED_FIELDS]).toEqual([
      "name",
      "type_id",
      "db_content",
      "trash",
      "left_id",
      "right_id",
    ]);
  });

  it("maps field names to the 0-based index stored in card_changes.field", () => {
    // change.rb:47-49 field_index / :60-63 field=
    expect(trackedFieldIndex("name")).toBe(0);
    expect(trackedFieldIndex("type_id")).toBe(1);
    expect(trackedFieldIndex("db_content")).toBe(2);
    expect(trackedFieldIndex("trash")).toBe(3);
    expect(trackedFieldIndex("left_id")).toBe(4);
    expect(trackedFieldIndex("right_id")).toBe(5);
  });

  it("round-trips index -> name (change.rb:67-69 field reader)", () => {
    for (let i = 0; i < TRACKED_FIELDS.length; i++) {
      expect(trackedFieldByIndex(i)).toBe(TRACKED_FIELDS[i]);
    }
    expect(trackedFieldByIndex(6)).toBeUndefined();
  });
});

describe("serializeChangeValue", () => {
  // ActiveRecord serializes into the mediumtext value column via
  // ActiveRecord::Type::Text < ActiveModel::Type::String
  // (activemodel-7.2.3.2/lib/active_model/type/immutable_string.rb:48-56):
  // Numeric -> to_s, true -> "t", false -> "f", String -> as-is, nil -> NULL.
  it("serializes booleans the way AR's string type does: t / f", () => {
    expect(serializeChangeValue(true)).toBe("t");
    expect(serializeChangeValue(false)).toBe("f");
  });

  it("serializes integers with to_s", () => {
    expect(serializeChangeValue(0)).toBe("0");
    expect(serializeChangeValue(123)).toBe("123");
    expect(serializeChangeValue(-7)).toBe("-7");
  });

  it("passes strings through untouched and preserves NULL", () => {
    expect(serializeChangeValue("Hello World")).toBe("Hello World");
    expect(serializeChangeValue("")).toBe("");
    expect(serializeChangeValue(null)).toBeNull();
  });
});

describe("changeValueForField", () => {
  // cards.trash is tinyint(1); ActiveRecord casts it to true/false before the
  // change value serializes (ActiveModel::Type::Boolean#cast_value — 0 is in
  // FALSE_VALUES, boolean.rb:15-45 — then Type::Text#serialize -> "t"/"f").
  it("casts the raw trash 0/1 to the boolean serialization t/f", () => {
    expect(changeValueForField("trash", 0)).toBe("f");
    expect(changeValueForField("trash", 1)).toBe("t");
  });

  it("leaves every other tracked field's raw value to plain serialization", () => {
    expect(changeValueForField("name", "Hello")).toBe("Hello");
    expect(changeValueForField("type_id", 3)).toBe("3");
    expect(changeValueForField("db_content", null)).toBeNull();
    expect(changeValueForField("left_id", 12)).toBe("12");
  });
});

describe("diffTrackedFields", () => {
  const full = (over: Partial<CardFieldState>): CardFieldState => ({
    name: "Test",
    type_id: 1,
    db_content: "content",
    trash: 0,
    left_id: null,
    right_id: null,
    ...over,
  });

  it("returns changed fields in TRACKED_FIELDS order (Ruby & preserves receiver order)", () => {
    // set/all/history.rb:51-53: TRACKED_FIELDS & (changed | saved)
    const changed = diffTrackedFields(
      full({ db_content: "a", name: "Old", trash: 0 }),
      full({ db_content: "b", name: "New", trash: 1 }),
    );
    expect(changed).toEqual(["name", "db_content", "trash"]);
  });

  it("returns an empty list for identical states", () => {
    const state = full({});
    expect(diffTrackedFields(state, state)).toEqual([]);
  });

  it("treats NULL as a value: NULL -> string and string -> NULL both count", () => {
    expect(diffTrackedFields(full({ db_content: null }), full({ db_content: "x" }))).toEqual([
      "db_content",
    ]);
    expect(diffTrackedFields(full({ db_content: "x" }), full({ db_content: null }))).toEqual([
      "db_content",
    ]);
  });

  it("detects compound-card side id changes", () => {
    const changed = diffTrackedFields(
      full({ name: null, left_id: 10, right_id: 11 }),
      full({ name: null, left_id: 10, right_id: 12 }),
    );
    expect(changed).toEqual(["right_id"]);
  });
});
