# set-pattern-oracle-probe2.rb - second read-only probe: module_key values,
# per-instance safe keys, set-card labels/short labels, type-assigning module
# keys. Output cited in tests/card/set-patterns comments.
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner C:/localProjects/decko-ts/tests/card/set-patterns/set-pattern-oracle-probe2.rb

require "json"

OUT = {}

OUT["pattern_cards"] = Card::Set::Pattern.concrete.map do |k|
  { "code" => k.pattern_code.to_s, "pattern_card" => k.pattern.to_s }
end

probe_card = lambda do |name|
  c = Card.fetch(name) || Card.new(name: name)
  {
    "name" => name,
    "module_keys" => c.patterns.map(&:module_key),
    "safe_keys" => c.patterns.map(&:safe_key),
    "assigns_type_module_keys" => c.patterns.select(&:assigns_type)
                                             .map(&:module_key)
  }
end

OUT["cards"] = [
  "Oracle Junction",
  "Oracle Junction+child_one",
  "*read",
  "Zz Probe Two+field"
].map { |n| probe_card.call(n) }

rich_tpr = Card.fetch("RichText+child_one+*type plus right")
tpr_klass = Card::Set::Pattern.find(:type_plus_right)
OUT["tpr_set_labels"] = rich_tpr && {
  "label" => rich_tpr.label,
  "short_label" => tpr_klass.short_label(rich_tpr.anchor_name.to_s),
  "uncapitalized_label" => rich_tpr.uncapitalized_label,
  "rule_cache_key_base" => rich_tpr.rule_cache_key_base
}
all_set = Card.fetch("*all")
OUT["all_set"] = {
  "rule_cache_key_base" => all_set.rule_cache_key_base,
  "uncapitalized_label" => all_set.uncapitalized_label
}
rt_set = Card.fetch("RichText+*type")
OUT["type_set"] = { "rule_cache_key_base" => rt_set.rule_cache_key_base }

puts JSON.pretty_generate(OUT)
$stdout.flush
