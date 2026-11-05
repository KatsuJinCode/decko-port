/**
 * Rule-name algebra tests. Sources: lib/card/rule/all.rb,
 * lib/card/rule/cache.rb, card-mod-rules-0.20.0 set/rule/rules.rb,
 * card-mod-permissions-0.20.0 set/all/permissions.rb. ORACLE-marked
 * expectations cite set-pattern-oracle-capture.json (probe 1).
 */

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
// installs the captured-facts name environment (beforeEach/afterEach side effect)
import "./oracle-environment.js";

const ORACLE_JUNCTION = {
  name: "Oracle Junction", id: 606, typeId: 2, typeName: "RichText",
};

describe("rule name construction (naming algebra only)", () => {
  it("joins a set name and a setting name (rule card storage shape: SET+*SETTING)", () => {
    // Rule cards live at "<set name>+<setting card name>" - the rule cache
    // SQL (lib/card/rule/cache.rb#sql) joins rules to sets via
    // rules.left_id = sets.id and to settings via rules.right_id, i.e. the
    // rule card name is set-name + setting-name.
    expect(ruleName("*all", "*read")).toBe("*all+*read");
    expect(ruleName("RichText+*type", "*read")).toBe("RichText+*type+*read");
    expect(ruleName("Oracle Junction+*self", "*read")).toBe("Oracle Junction+*self+*read");
  });

  it("lists a card's candidate rule names in pattern precedence order", () => {
    // Rule::All#rule_id_lookup walks rule_lookup_keys in
    // Set::Pattern::All#rule_lookup_keys order - the NAME-level view of that
    // walk is set name + setting, first existing rule card wins.
    // ORACLE capture1 rule_name_check.candidate_rule_names for
    // "Oracle Junction" + *read:
    expect(ruleNamesForCard(ORACLE_JUNCTION, "*read")).toEqual([
      "Oracle Junction+*self+*read",
      "RichText+*type+*read",
      "*all+*read",
    ]);
  });

  it("builds setting card names from setting codes", () => {
    // Setting cards are named "*"+codename; the codename registry maps
    // "read" -> "*read" (card-mod-rules set/rule/rules.rb#rule_setting_name
    // reads the same name back off a rule card's tag).
    expect(settingCardNameForCode("read")).toBe("*read");
    expect(settingCardNameForCode("create")).toBe("*create");
  });
});

describe("rule cache key algebra (lib/card/rule/cache.rb#lookup_key)", () => {
  it("joins lookup key + setting code with no stars", () => {
    // Rule::All#rule_id_lookup: lookup_hash["#{lookup_key}+#{cache_suffix}"]
    // where cache_suffix is the setting CODE ("read", not "*read").
    expect(ruleCacheKey("all", "read")).toBe("all+read");
    expect(ruleCacheKey("606+self", "read")).toBe("606+self+read");
    expect(ruleCacheKey("2+type", "read")).toBe("2+type+read");
  });

  it("builds storage-side keys from the rule card's row parts", () => {
    // Cache#lookup_key: [anchor_id, pattern_code, setting_code].compact.
    // ORACLE capture1 rule_lookup_key_sample: "all+read" => 10 (the *all
    // read rule, id 10), "46+self+read" => 48, "205+right+read" => 208.
    expect(ruleCacheKeyFromRow(null, "all", "read")).toBe("all+read");
    expect(ruleCacheKeyFromRow(undefined, "all", "read")).toBe("all+read");
    expect(ruleCacheKeyFromRow(606, "self", "read")).toBe("606+self+read");
    expect(ruleCacheKeyFromRow(2, "type", "read")).toBe("2+type+read");
    expect(ruleCacheKeyFromRow(608, "type_plus_right", "read")).toBe(
      "608+type_plus_right+read",
    );
  });

  it("preference keys fall back from user to *all (Rule::All#preference_card_id)", () => {
    // rule_id_lookup(preference_cache, "#{setting_code}+#{user_id}",
    // "#{setting_code}+#{AllID}").
    expect(preferenceCacheKeys("follow", 5, 7)).toEqual(["follow+5", "follow+7"]);
    expect(preferenceCacheKeys("follow", undefined, 7)).toEqual(["follow+7"]);
  });
});

describe("read_rule_class derivation (permissions.rb#rule_class_name)", () => {
  it("is the rule card's trunk tag when the trunk is a Set card", () => {
    // card-mod-permissions set/all/permissions.rb#rule_class_name:
    // `trunk.type_id == SetID ? name.trunk_name.tag : nil`. The value stored
    // in cards.read_rule_class is the PATTERN CARD NAME with star.
    // ORACLE capture1 rule_class_name: "*all+*read" -> "*all",
    // "Oracle Restricted+*self+*read" -> "*self".
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
    // #rule_set_name: name.trunk_name; #rule_setting_name: name.tag.
    // ORACLE-adjacent: the read machinery consults set-then-setting, e.g.
    // "*all+*read" -> set "*all", setting "*read".
    expect(ruleSetCardName("*all+*read")).toBe("*all");
    expect(ruleSettingCardName("*all+*read")).toBe("*read");
    expect(ruleSetCardName("RichText+*type+*read")).toBe("RichText+*type");
    expect(ruleSettingCardName("RichText+*type+*read")).toBe("*read");
  });

  it("preference cards drop the user part from the set name", () => {
    // #rule_set_name: preference? -> name.trunk_name.trunk_name
    // (SET+USER+SETTING shape; Rule::All#preference? decides, storage-side).
    expect(ruleSetCardName("*read+Joe Admin+*follow", true)).toBe("*read");
    expect(ruleSetCardName("*read+Joe Admin+*follow", false)).toBe("*read+Joe Admin");
    expect(ruleSettingCardName("*read+Joe Admin+*follow")).toBe("*follow");
  });
});
