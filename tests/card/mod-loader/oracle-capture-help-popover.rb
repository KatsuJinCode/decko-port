# oracle-capture-help-popover.rb - oracle capture for the card-mod-help
# set/right/help.rb:4-6 view :popover (the popover_link helper dispatched
# against _render_core for a real card).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner \
#     C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-help-popover.rb
#
# Records to fixtures/captured/help-popover.json:
# 1. the set-module view registration Card::Set::Right::Help::HtmlFormat
#    contributes for :popover (with source location proving set/right/help.rb
#    defined it - the byte oracle pin links the live render to the gem file)
# 2. rendered bytes for two compound probe cards' :popover views - one WITH a
#    *help rule (Oracle Help Popover Probe+*help, with a *help rule card
#    "Oracle Help Popover Probe+*self+*help" carrying help text) and one
#    WITHOUT (Oracle Bare Popover Probe+*help, no rule). Right pattern is
#    compound_only (mod/core/set_pattern/07_right.rb:2), so the popover view
#    only fires on compound names - the simple probe names from the help
#    fixture would raise "view not supported". The byte oracle for the TS-side
#    A/B test pinning card-mod-help.ts#popoverView.
#
# Determinism contract (mirrors oracle-capture-help-mod.rb): output JSON is
# pretty-printed with deeply sorted keys + trailing newline; the random
# data-slot-id attribute is normalized to a placeholder; probe seed cards are
# created-if-missing and DELETED (trashed) after capture so the shared oracle
# DB returns to its prior state (a re-run stays byte-stable).

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "help-popover.json")

PROBE_WITH_RULE    = "Oracle Help Popover Probe+*help"
PROBE_WITHOUT_RULE = "Oracle Bare Popover Probe+*help"
PROBE_LEFT_NAME    = "Oracle Help Popover Probe"
HELP_RULE_TEXT     = "Moderator-approved help text for the popover probe card."

SEEDS = [
  # the left plain-card (will auto-create one if missing when *self+*help rule
  # is seeded; we seed it explicitly so the rule card's left side is RichText-
  # typed and the populated dbContent stays clean)
  { name: PROBE_LEFT_NAME, type: "RichText", content: "popover probe card body" },
  # the ruled right probe - compound, Right pattern matches, body text
  { name: PROBE_WITH_RULE, type: "RichText", content: "popover probe card body" },
  # the bare right probe - compound, no rule
  { name: PROBE_WITHOUT_RULE, type: "RichText", content: "bare popover probe body" },
  # the rule card "Oracle Help Popover Probe+*self+*help"
  { name: "#{PROBE_LEFT_NAME}+*self+*help", content: HELP_RULE_TEXT }
].freeze

RENDER_TARGETS = {
  PROBE_WITH_RULE    => %i[popover],
  PROBE_WITHOUT_RULE => %i[popover]
}.freeze

SLOT_ID_RE = /data-slot-id=(["'])\h+\1/.freeze
# The probe cards are created fresh and trashed after each capture, so their
# row ids (and with them data-card-id) advance every run - seed state, not
# mod semantics. Normalized like the slot id; the TS test applies the same
# normalization to its own renders before comparing.
CARD_ID_RE = /data-card-id=(["'])\d+\1/.freeze

def normalize(html)
  html.gsub(SLOT_ID_RE, 'data-slot-id="RANDOMIZED"')
      .gsub(CARD_ID_RE, 'data-card-id="RANDOMIZED"')
end

def deep_sort(obj)
  case obj
  when Hash  then obj.sort.to_h.transform_values { |v| deep_sort(v) }
  when Array then obj.map { |v| deep_sort(v) }
  else obj
  end
end

def seed_card(attrs)
  existing = Card.fetch(attrs[:name], new: {})
  if existing.new_card?
    Card.create! attrs
    "created"
  else
    "present"
  end
end

def source_location_of(format_mod, method)
  return nil unless format_mod.respond_to?(:instance_method)

  format_mod.instance_method(method).source_location
rescue StandardError
  nil
end

payload = {}
seed_log = {}

# ---- seed (create-if-missing; removed again after capture) ------------------
Card::Auth.as_bot do
  SEEDS.each { |attrs| seed_log[attrs[:name]] = seed_card(attrs) }
end

# ---- set-module view registration -------------------------------------------
# set/right/help.rb:4-6 - the :popover view dispatched through card-mod-help
# right/help set module. Defined on Card::Set::Right::Help::HtmlFormat.
right_help_html = Card::Set::Right::Help.const_get(:HtmlFormat)
payload["registered_views"] = {
  "right_help_html_view_popover" => {
    "defined" => right_help_html.method_defined?(:_view_popover),
    "source_location" => source_location_of(right_help_html, :_view_popover)
  }
}

# ---- rendered probe views ---------------------------------------------------
# :popover view is in set/right/help.rb (no `unknown:`, no `cache: :never`,
# no `wrap:` config - the byte shape is whatever the default slot wrap is).
# Calling render(:popover) for the ruled probe exercises the same dispatch
# chain the TS-side render("Oracle Help Popover Probe+*help", "popover")
# exercises; calling it for the bare probe proves the view renders a no-rule
# card too (the :popover view body has no rule check - it just wraps
# _render_core inside the popover_link helper).
views = {}
RENDER_TARGETS.each do |name, view_list|
  card = Card.fetch(name)
  format = card.format
  view_list.each do |view|
    views["#{name}##{view}"] = normalize(format.render(view))
  rescue StandardError => e
    views["#{name}##{view}"] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
  end
end
payload["rendered"] = views

# ---- cleanup: trash the probe cards so the shared DB stays untouched --------
# (creating the rule card auto-creates its set card "X+*self" and its left
# card "X"; trashing order matters: rule first, then set card, then probe.)
Card::Auth.as_bot do
  [
    "#{PROBE_LEFT_NAME}+*self+*help",
    "#{PROBE_LEFT_NAME}+*self",
    PROBE_LEFT_NAME,
    PROBE_WITH_RULE,
    PROBE_WITHOUT_RULE
  ].each do |name|
    card = Card.fetch(name)
    next if card.nil? || card.new_card?

    begin
      card.delete!
      seed_log["deleted:#{name}"] = "deleted"
    rescue StandardError => e
      seed_log["deleted:#{name}"] = "DELETE_FAILED: #{e.class}: #{e.message}"
    end
  end
end
# NO card_count field: the oracle DB is shared with other streams'
# benchmarks, so a card count is racy harness telemetry, not mod-mechanism
# oracle data.

# ---- write ------------------------------------------------------------------
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
