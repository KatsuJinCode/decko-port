/**
 * Oracle parity: assert the TS registry reproduces the captured live-decko
 * output byte-for-byte where the capture has a port-level answer.
 *
 * Captures were produced by set-pattern-oracle-probe.rb (capture1) and
 * set-pattern-oracle-probe2.rb (capture2) - read-only `decko runner` scripts
 - against tools/oracle/decko-oracle-app (card-1.110.0 / decko-0.20.0,
 * local SQLite deck). Ids are deck-specific; they enter this test through
 * oracle-environment.ts (captured facts), not through hardcoded tables here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findPattern,
  groupedCodes,
  patternCodes,
  patternIds,
} from "../../../src/card/set-patterns/registry.js";
import {
  patternsForCard,
  ruleLookupKeysForCard,
  safeSetKeysForCard,
  setNamesForCard,
  typeAssigningModuleKeys,
} from "../../../src/card/set-patterns/card-patterns.js";
import {
  compoundOnlyForParsedSet,
  labelForParsedSet,
  parseSetName,
  ruleCacheKeyBaseForParsedSet,
} from "../../../src/card/set-patterns/set-name.js";
import { ruleNamesForCard } from "../../../src/card/set-patterns/rule-names.js";
import type { PatternCardInput } from "../../../src/card/set-patterns/types.js";
import { ORACLE_ENV } from "./oracle-environment.js";

interface Capture1 {
  concrete: Array<{
    pattern_code: string; pattern_id: number; pattern_card_name: string;
    compound_only: boolean; assigns_type: boolean; anchorless: boolean;
  }>;
  ids: number[];
  codes: string[];
  grouped_codes: string[][];
  cards: Array<{
    name: string; missing?: boolean;
    patterns?: string[]; set_names?: string[];
    rule_lookup_keys?: string[]; safe_set_keys?: string;
  }>;
  new_cards: Record<string, { patterns: string[]; rule_lookup_keys: string[] }>;
  rule_name_check: {
    candidate_rule_names: string[]; rule_card_read: string; rule_card_read_id: number;
    rule_lookup_key_sample: Record<string, number>;
  };
  set_cards: Array<{
    set_name: string; missing?: boolean; anchor_name: string | null;
    pattern_name: string | null; label: string; compound_only: boolean | null;
  }>;
  labels: Array<{ code: string; label: string; short_label: string; generic_label: string }>;
}

interface Capture2 {
  pattern_cards: Array<{ code: string; pattern_card: string }>;
  cards: Array<{
    name: string;
    module_keys: (string | null)[];
    safe_keys: string[];
    assigns_type_module_keys: (string | null)[];
  }>;
  tpr_set_labels: {
    label: string; short_label: string; uncapitalized_label: string;
    rule_cache_key_base: string;
  };
  all_set: { rule_cache_key_base: string; uncapitalized_label: string };
  type_set: { rule_cache_key_base: string };
}

const here = (import.meta.dirname ?? new URL(".", import.meta.url).pathname);
const capture1 = JSON.parse(
  readFileSync(join(here, "set-pattern-oracle-capture.json"), "utf8"),
) as Capture1;
const capture2 = JSON.parse(
  readFileSync(join(here, "set-pattern-oracle-capture2.json"), "utf8"),
) as Capture2;

/** Captured card facts -> pattern input (see oracle-environment.ts). */
function cardInputFor(name: string): PatternCardInput {
  const facts: Record<string, PatternCardInput> = {
    "Oracle Basics": { name, id: 605, typeId: 2, typeName: "RichText" },
    "Oracle Junction": { name, id: 606, typeId: 2, typeName: "RichText" },
    "Oracle Junction+child_one": {
      name, id: 608, typeId: 2, typeName: "RichText", leftTypeName: "RichText",
    },
    "*read": { name, id: 9, typeId: 6, typeName: "Setting" },
    "*all+*read": {
      name, id: 10, typeId: 4, typeName: "List", isRule: true,
      // superleft "*all" is a Set card -> tpr anchor "Set+*read"
      leftTypeName: "Set",
    },
  };
  const input = facts[name];
  if (!input) throw new Error(`no captured facts for card "${name}"`);
  return input;
}

/** New-card inputs from capture1's new_cards section. */
const NEW_SIMPLE: PatternCardInput = {
  name: "Zz Probe New Simple", isNew: true, typeId: 2, typeName: "RichText",
};
const NEW_FIELD: PatternCardInput = {
  name: "Zz Probe New+field", isNew: true, typeId: 2, typeName: "RichText",
};

describe("oracle parity: the pattern table", () => {
  it("reproduces the concrete table row by row", () => {
    // capture1 "concrete" - the authoritative ordered table.
    expect(patternCodes()).toEqual(capture1.codes);
    capture1.concrete.forEach((row, index) => {
      const spec = findPattern(row.pattern_code);
      expect(spec, row.pattern_code).toBeDefined();
      expect(spec?.patternCardName, row.pattern_code).toBe(row.pattern_card_name);
      expect(spec?.compoundOnly, row.pattern_code).toBe(row.compound_only);
      expect(spec?.assignsType, row.pattern_code).toBe(row.assigns_type);
      expect(spec?.anchorName === undefined, row.pattern_code).toBe(row.anchorless);
      expect(patternCodes()[index], row.pattern_code).toBe(row.pattern_code);
    });
  });

  it("reproduces Pattern.ids through the captured codename registry", () => {
    expect(patternIds((code) => ORACLE_ENV.codename?.id(code))).toEqual(capture1.ids);
  });

  it("reproduces grouped_codes", () => {
    expect(groupedCodes()).toEqual(capture1.grouped_codes);
  });

  it("reproduces the pattern card names (capture2 pattern_cards)", () => {
    for (const row of capture2.pattern_cards) {
      expect(findPattern(row.code)?.patternCardName).toBe(row.pattern_card);
    }
  });
});

describe("oracle parity: per-card patterns", () => {
  for (const captured of capture1.cards) {
    if (captured.missing) continue;
    it(`reproduces set names, lookup keys and safe keys for "${captured.name}"`, () => {
      const card = cardInputFor(captured.name);
      expect(setNamesForCard(card)).toEqual(captured.set_names ?? captured.patterns);
      expect(ruleLookupKeysForCard(card)).toEqual(captured.rule_lookup_keys);
      expect(safeSetKeysForCard(card)).toBe(captured.safe_set_keys);
    });
  }

  it("reproduces the new-card pattern lists", () => {
    expect(setNamesForCard(NEW_SIMPLE)).toEqual(capture1.new_cards.simple.patterns);
    expect(ruleLookupKeysForCard(NEW_SIMPLE)).toEqual(capture1.new_cards.simple.rule_lookup_keys);
    expect(setNamesForCard(NEW_FIELD)).toEqual(capture1.new_cards.field.patterns);
    expect(ruleLookupKeysForCard(NEW_FIELD)).toEqual(capture1.new_cards.field.rule_lookup_keys);
  });

  it("reproduces capture2 module keys, safe keys and type-assigning keys", () => {
    const inputs: Record<string, PatternCardInput> = {
      "Oracle Junction": cardInputFor("Oracle Junction"),
      "Oracle Junction+child_one": cardInputFor("Oracle Junction+child_one"),
      "*read": cardInputFor("*read"),
      "Zz Probe Two+field": NEW_FIELD,
    };
    for (const captured of capture2.cards) {
      const card = inputs[captured.name];
      expect(card, captured.name).toBeDefined();
      if (!card) continue;
      const patterns = patternsForCard(card);
      expect(patterns.map((p) => p.moduleKey), `${captured.name} module_keys`)
        .toEqual(captured.module_keys);
      expect(patterns.map((p) => p.safeKey), `${captured.name} safe_keys`)
        .toEqual(captured.safe_keys);
      // each_type_assigning_module_key yields only non-nil keys.
      expect(typeAssigningModuleKeys(card), `${captured.name} assigns_type keys`).toEqual(
        captured.assigns_type_module_keys.filter((key): key is string => key !== null),
      );
    }
  });
});

describe("oracle parity: rule names", () => {
  it("reproduces the candidate rule names for Oracle Junction + *read", () => {
    expect(ruleNamesForCard(cardInputFor("Oracle Junction"), "*read")).toEqual(
      capture1.rule_name_check.candidate_rule_names,
    );
  });

  it("reproduces cache-key shapes from the captured rule cache sample", () => {
    // "all+read" -> 10 is the *all+*read rule card (id 10); the port builds
    // the same keys (values are the storage walk's business, next stream).
    expect(capture1.rule_name_check.rule_lookup_key_sample["all+read"]).toBe(10);
    expect(capture1.rule_name_check.rule_lookup_key_sample["606+self+read"]).toBeUndefined();
    for (const key of Object.keys(capture1.rule_name_check.rule_lookup_key_sample)) {
      // key shape: [anchorId]? + patternCode + settingCode, no stars
      expect(key, key).toMatch(/^(?:\d+\+)?(?:self|right|type|type_plus_right|rule|rstar|star|all_plus|all)\+(?:\d+\+)?[a-z_]+$/);
    }
  });
});

describe("oracle parity: set card parsing", () => {
  for (const captured of capture1.set_cards) {
    if (captured.missing) continue;
    it(`parses "${captured.set_name}" like the oracle`, () => {
      const parsed = parseSetName(captured.set_name);
      expect(parsed.anchorName?.s ?? null).toBe(captured.anchor_name);
      expect(parsed.patternCardName.s).toBe(captured.pattern_name);
      expect(labelForParsedSet(parsed)).toBe(captured.label);
      // Ruby nil compound_only (option unset) -> falsy -> false.
      expect(compoundOnlyForParsedSet(parsed)).toBe(captured.compound_only ?? false);
    });
  }
});

describe("oracle parity: labels", () => {
  for (const row of capture1.labels) {
    it(`labels for ${row.code} match class-level label/short_label/generic_label`, () => {
      const spec = findPattern(row.code);
      expect(spec?.label("Book")).toBe(row.label);
      expect(spec?.shortLabel("Book")).toBe(row.short_label);
      expect(spec?.genericLabel()).toBe(row.generic_label);
    });
  }

  it("matches capture2's type-plus-right set labels", () => {
    const parsed = parseSetName("RichText+child_one+*type plus right");
    expect(labelForParsedSet(parsed)).toBe(capture2.tpr_set_labels.label);
    const spec = findPattern("type_plus_right");
    expect(
      spec?.shortLabel(parsed.anchorName?.s),
    ).toBe(capture2.tpr_set_labels.short_label);
  });

  it("matches capture2's rule_cache_key_base values", () => {
    expect(ruleCacheKeyBaseForParsedSet(parseSetName("*all"))).toBe(
      capture2.all_set.rule_cache_key_base,
    );
    expect(ruleCacheKeyBaseForParsedSet(parseSetName("RichText+*type"))).toBe(
      capture2.type_set.rule_cache_key_base,
    );
  });
});
