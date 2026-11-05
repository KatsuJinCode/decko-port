

import { describe, expect, it } from "vitest";
import {
  ACTION_TYPE_CODES,
  actionTypeCode,
  actionTypeFromCode,
  identifyAction,
} from "../../../src/card/history/action.js";

describe("action type codes", () => {

  it("stores create=0, update=1, delete=2 (action.rb:90-92)", () => {
    expect(ACTION_TYPE_CODES).toEqual({ create: 0, update: 1, delete: 2 });
    expect(actionTypeCode("create")).toBe(0);
    expect(actionTypeCode("update")).toBe(1);
    expect(actionTypeCode("delete")).toBe(2);
  });

  it("reads codes back (action.rb:95-100 TYPE_OPTIONS[read_attribute])", () => {
    expect(actionTypeFromCode(0)).toBe("create");
    expect(actionTypeFromCode(1)).toBe("update");
    expect(actionTypeFromCode(2)).toBe("delete");
    expect(actionTypeFromCode(3)).toBeUndefined();
  });
});

describe("identifyAction", () => {

  it("maps a trash flip 0 -> 1 to :delete", () => {
    expect(identifyAction({ trashBefore: 0, trashAfter: 1, isNewCard: false })).toBe("delete");
  });

  it("maps trash revival 1 -> 0 to :update (trash is falsy after)", () => {
    expect(identifyAction({ trashBefore: 1, trashAfter: 0, isNewCard: false })).toBe("update");
  });

  it("maps a new card to :create", () => {
    expect(identifyAction({ trashBefore: 0, trashAfter: 0, isNewCard: true })).toBe("create");
  });

  it("keeps the Ruby check order: the delete check outranks the create check", () => {

    expect(identifyAction({ trashBefore: 0, trashAfter: 1, isNewCard: true })).toBe("delete");
  });

  it("maps an unchanged trash state to :update", () => {
    expect(identifyAction({ trashBefore: 1, trashAfter: 1, isNewCard: false })).toBe("update");
  });
});
