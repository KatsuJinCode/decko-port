

import { describe, expect, it } from "vitest";
import {
  preferenceCacheKeys,
  ruleCacheKey,
  ruleCacheKeyFromRow,
  ruleClassName,
  ruleName,
  ruleNamesForCard,
  ruleSetCardName,
  ruleSettingCardName,
  settingCardNameForCode,
} from "../../../src/card/set-patterns/rule-names.js";

import "./oracle-environment.js";

const ORACLE_JUNCTION = {
  name: "Oracle Junction", id: 606, typeId: 2, typeName: "RichText",
};

describe("rule name construction (naming algebra only)", () => {
  it("joins a set name and a setting name (rule card storage shape: SET+*SETTING)", () => {

    expect(ruleName("*all", "*read")).toBe("*all+*read");
    expect(ruleName("RichText+*type", "*read")).toBe("RichText+*type+*read");
    expect(ruleName("Oracle Junction+*self", "*read")).toBe("Oracle Junction+*self+*read");
  });

  it("lists a card's candidate rule names in pattern precedence order", () => {

    expect(ruleNamesForCard(ORACLE_JUNCTION, "*read")).toEqual([
      "Oracle Junction+*self+*read",
      "RichText+*type+*read",
      "*all+*read",
    ]);
  });

  it("builds setting card names from setting codes", () => {

    expect(settingCardNameForCode("read")).toBe("*read");
    expect(settingCardNameForCode("create")).toBe("*create");
  });
});

describe("rule cache key algebra (lib/card/rule/cache.rb#lookup_key)", () => {
  it("joins lookup key + setting code with no stars", () => {

    expect(ruleCacheKey("all", "read")).toBe("all+read");
    expect(ruleCacheKey("606+self", "read")).toBe("606+self+read");
    expect(ruleCacheKey("2+type", "read")).toBe("2+type+read");
  });

  it("builds storage-side keys from the rule card's row parts", () => {

    expect(ruleCacheKeyFromRow(null, "all", "read")).toBe("all+read");
    expect(ruleCacheKeyFromRow(undefined, "all", "read")).toBe("all+read");
    expect(ruleCacheKeyFromRow(606, "self", "read")).toBe("606+self+read");
    expect(ruleCacheKeyFromRow(2, "type", "read")).toBe("2+type+read");
    expect(ruleCacheKeyFromRow(608, "type_plus_right", "read")).toBe(
      "608+type_plus_right+read",
    );
  });

  it("preference keys fall back from user to *all (Rule::All#preference_card_id)", () => {

    expect(preferenceCacheKeys("follow", 5, 7)).toEqual(["follow+5", "follow+7"]);
    expect(preferenceCacheKeys("follow", undefined, 7)).toEqual(["follow+7"]);
  });
});

describe("read_rule_class derivation (permissions.rb#rule_class_name)", () => {
  it("is the rule card's trunk tag when the trunk is a Set card", () => {

    expect(ruleClassName("*all+*read", true)).toBe("*all");
    expect(ruleClassName("Oracle Restricted+*self+*read", true)).toBe("*self");
    expect(ruleClassName("RichText+*type+*read", true)).toBe("*type");
  });

  it("is nil when the trunk is not a Set card", () => {
    expect(ruleClassName("Some Card+*read", false)).toBeNull();
  });
});

describe("rule card decomposition (card-mod-rules set/rule/rules.rb)", () => {
  it("splits a rule card into set name (trunk) and setting name (tag)", () => {

    expect(ruleSetCardName("*all+*read")).toBe("*all");
    expect(ruleSettingCardName("*all+*read")).toBe("*read");
    expect(ruleSetCardName("RichText+*type+*read")).toBe("RichText+*type");
    expect(ruleSettingCardName("RichText+*type+*read")).toBe("*read");
  });

  it("preference cards drop the user part from the set name", () => {

    expect(ruleSetCardName("*read+Joe Admin+*follow", true)).toBe("*read");
    expect(ruleSetCardName("*read+Joe Admin+*follow", false)).toBe("*read+Joe Admin");
    expect(ruleSettingCardName("*read+Joe Admin+*follow")).toBe("*follow");
  });
});
