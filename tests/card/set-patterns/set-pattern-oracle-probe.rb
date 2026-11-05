# set-pattern-oracle-probe.rb - read-only probe of the set-pattern registry
# for the decko-ts set-patterns port (wave 2 stream 9). No writes, no saves:
# fetches and in-memory Card.new only. Its output is committed verbatim as
# set-pattern-oracle-capture.json next to this file.
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner C:/localProjects/decko-ts/tests/card/set-patterns/set-pattern-oracle-probe.rb

require "json"

OUT = {}

# 1. The ordered concrete pattern table (registration-order claim:
#    insert-at-0 makes lookup order the REVERSE of file load order 01..09).
OUT["concrete"] = Card::Set::Pattern.concrete.map do |k|
  {
    "pattern_code"        => k.pattern_code.to_s,
    "pattern_id"          => k.pattern_id,
    "pattern_card_name"   => k.pattern.to_s,
    "compound_only"       => k.compound_only?,
    "assigns_type"        => k.assigns_type || false,
    "anchorless"          => k.anchorless?,
    "anchor_parts_count"  => (k.anchor_parts_count rescue "dynamic/err"),
    "responds_anchor_name" => k.method_defined?(:anchor_name) || k.respond_to?(:anchor_name)
  }
end

OUT["ids"] = Card::Set::Pattern.ids
OUT["codes"] = Card::Set::Pattern.codes.to_a.map(&:to_s)
OUT["grouped_codes"] = Card::Set::Pattern.grouped_codes.map { |g| g.map(&:to_s) }
OUT["grouped_codes_no_all"] = Card::Set::Pattern.grouped_codes(with_all: false).map { |g| g.map(&:to_s) }

# 2. Pattern card ids via codename, for cross-check with ids
OUT["pattern_card_ids_by_codename"] = %w[self type_plus_right right rule rstar star type all_plus all]
  .map { |c| [c, Card::Codename[c]&.to_s] }.to_h

# 3. Per-card pattern instances: set names + rule lookup keys
card_name = lambda do |name|
  c = Card.fetch(name)
  next { "name" => name, "missing" => true } unless c
  {
    "name"             => name,
    "patterns"         => c.patterns.map(&:to_s),
    "rule_lookup_keys" => c.rule_lookup_keys,
    "safe_set_keys"    => c.safe_set_keys,
    "set_names"        => c.set_names
  }
end

OUT["cards"] = [
  "Oracle Basics",
  "Oracle Junction",
  "Oracle Junction+child_one",
  "*read",
  "*all+*read"
].map { |n| card_name.call(n) }

# 4. New-card behavior (patterns skips concrete_patterns[0] when new_card?)
new_simple = Card.new(name: "Zz Probe New Simple")
new_field  = Card.new(name: "Zz Probe New+field")
OUT["new_cards"] = {
  "simple" => { "patterns" => new_simple.patterns.map(&:to_s),
                "rule_lookup_keys" => new_simple.rule_lookup_keys },
  "field"  => { "patterns" => new_field.patterns.map(&:to_s),
                "rule_lookup_keys" => new_field.rule_lookup_keys }
}

# 5. Rule-name algebra: rule names a card+setting consults, and the rule
#    card the cache lookup actually returns.
oj = Card.fetch("Oracle Junction")
OUT["rule_name_check"] = {
  "candidate_rule_names" => oj.patterns.map { |p| "#{p}+*read" },
  "rule_card_read"       => oj.rule_card(:read)&.name,
  "rule_card_read_id"    => oj.rule_card_id(:read),
  "rule_lookup_key_sample" => Card::Rule.rule_cache.select { |k, _| k.match?(/read\z/) }
                                             .first(12).to_h
}

# 6. Set-name reverse parsing (Set card -> pattern + anchor)
set_probe = lambda do |name|
  s = Card.fetch(name)
  next { "set_name" => name, "missing" => true } unless s
  {
    "set_name"     => name,
    "type"         => s.type_name,
    "anchor_name"  => s.anchor_name&.to_name&.to_s,
    "pattern_name" => s.pattern_name&.to_s,
    "label"        => s.label,
    "compound_only" => (s.compound_only? rescue "err"),
    "prototype_name" => (s.prototype.name rescue "err: #{$!.class}"),
    "prototype_type"  => (s.prototype.type_name rescue nil)
  }
end

OUT["set_cards"] = [
  "*all",
  "*all plus",
  "RichText+*type",
  "*star",
  "*rstar",
  "*rule",
  "child_one+*right",
  "RichText+child_one+*type plus right",
  "Oracle Junction+*self"
].map { |n| set_probe.call(n) }

# 7. Labels (class-level, no card needed)
OUT["labels"] = Card::Set::Pattern.concrete.map do |k|
  {
    "code" => k.pattern_code.to_s,
    "label" => (k.label("Book") rescue nil),
    "short_label" => (k.short_label("Book") rescue nil),
    "generic_label" => (k.generic_label rescue nil)
  }
end

# 8. Pattern find + module_key behaviors
OUT["find"] = {
  "type"   => Card::Set::Pattern.find(:type)&.to_s,
  "bogus"  => Card::Set::Pattern.find(:nope).inspect
}

# 9. rule_class_name derivation (read_rule_class column source)
type_read_card = (Card["RichText+*type+*read"] rescue nil)
OUT["rule_class_name"] = {
  "all_read"   => Card.fetch("*all+*read").rule_class_name,
  "type_read"  => (type_read_card&.rule_class_name if type_read_card),
  "self_read"  => Card.fetch("Oracle Restricted+*self+*read").rule_class_name
}

puts JSON.pretty_generate(OUT)
$stdout.flush
