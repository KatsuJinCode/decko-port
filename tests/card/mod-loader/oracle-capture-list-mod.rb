# oracle-capture-list-mod.rb - oracle capture for the card-mod-list loader
# port (decko-ts mod-port stream, card-mod-list-0.20.0).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development RUBY_DLL_PATH=C:/localProjects/decko-ts/tools/oracle/mysql-client-scratch/lib \
#     bundle exec decko runner C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-list-mod.rb
#
# Records to fixtures/captured/list-mod-loader.json:
# 1. mod load order / pattern codes / grouped codes (same bookkeeping oracle
#    as oracle-capture-help-mod.rb, for cross-checking loader parity)
# 2. the Card::Setting registry state card-mod-list's setting_opts files
#    contribute (self/content_options.rb, self/content_option_view.rb):
#    the full editing-group slot array (positions 5/6) + per-setting state
#    (rule_type_editable, help_text, restricted_to_type)
# 3. the set-module view registrations card-mod-list contributed
#    (Card::Set::Abstract::List::HtmlFormat#_view_list et al., with source
#    locations proving which gem file defined them)
# 4. the list_input_options basket state (set/all/supports_content_options.rb
#    + card-mod-edit editor.rb both write it)
# 5. rendered bytes for probe cards' :one_line_content / :view_list / :input /
#    :list / :nest_list_input / :content / :core views - the byte oracle for
#    the TS-side A/B test
#
# Determinism contract (mirrors oracle-capture-help-mod.rb): output JSON is
# pretty-printed with deeply sorted keys + trailing newline; the random
# data-slot-id attribute is normalized to a placeholder; probe seed cards are
# created-if-missing and DELETED (trashed) after capture so the shared oracle
# DB returns to its prior state.

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "list-mod-loader.json")

CHILD = "Oracle Probe Child"

PROBE_LIST    = "Oracle List Probe"      # type List
PROBE_POINTER = "Oracle Pointer Probe"   # type Pointer
PROBE_RADIO   = "Oracle Radio Probe"     # type Pointer + *input_type rule + *content_options rule
PROBE_NEST    = "Oracle Nest List Probe" # type Nest list
PROBE_LINK    = "Oracle Link List Probe" # type Link list

SEEDS = [
  { name: CHILD, type: "RichText", content: "probe item body" },
  { name: PROBE_LIST, type: "List",
    content: "#{CHILD}\nOracle Probe Wanted" },
  { name: PROBE_POINTER, type: "Pointer",
    content: "#{CHILD}\nSecond Item" },
  # NOTE the probe card is seeded BEFORE its rules: creating a rule card
  # auto-creates its set card AND the set's left card, so a later probe seed
  # would find the card "present" with default type/content.
  { name: PROBE_RADIO, type: "Pointer", content: "Option One" },
  { name: "#{PROBE_RADIO}+*self+*input_type", content: "radio" },
  { name: "#{PROBE_RADIO}+*self+*content_options", type: "List",
    content: "Option One\nOption Two" },
  { name: PROBE_NEST, type: "Nest list",
    # first nest pins the raw-options branch of the title input
    # (Chunk::Nest#raw_options = the raw "key:value" string between the
    # pipes, lib/card/content/chunk/nest.rb:16-18, 108-109); second pins
    # the no-options branch (no value attribute)
    content: "{{#{CHILD}|title:nested title}}\n{{Second Item}}" },
  { name: PROBE_LINK, type: "Link list",
    content: "[[#{CHILD}|link title]]\n[[Second Item]]" }
].freeze

RENDER_TARGETS = {
  PROBE_LIST    => %i[one_line_content view_list input list content core],
  PROBE_POINTER => %i[one_line_content view_list input list content core],
  PROBE_RADIO   => %i[input one_line_content],
  PROBE_NEST    => %i[nest_list_input input list one_line_content],
  PROBE_LINK    => %i[input list one_line_content]
}.freeze

SLOT_ID_RE = /data-slot-id=(["'])\h+\1/.freeze
# Probe cards are created fresh and trashed after each capture, so their row
# ids (and with them data-card-id) advance every run - seed state, not mod
# semantics. Normalized like the slot id; the TS test applies the same masks.
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

# ---- mod load order ---------------------------------------------------------
payload["mods"] = Cardio::Mod.dirs.mods.map do |mod|
  { "name" => mod.name, "group" => mod.group.to_s, "index" => mod.index }
end

payload["pattern_codes"] = Card::Set::Pattern.concrete.map { |p| p.pattern_code.to_s }
payload["grouped_codes"] = Card::Set::Pattern.grouped_codes.map { |g| g.map(&:to_s) }

# ---- Card::Setting registry (setting_opts registrations) --------------------
payload["setting_groups"] = Card::Setting.groups.transform_values do |sets|
  sets.map { |s| s.codename&.to_s }
end
payload["setting_preferences"] = Card::Setting.preferences.map(&:to_s).sort

def setting_state(setting_mod)
  {
    "codename" => setting_mod.codename.to_s,
    "group" => Card::Setting.groups.find { |_, sets| sets.include?(setting_mod) }&.first.to_s,
    "rule_type_editable" => setting_mod.rule_type_editable,
    "short_help_text" => (setting_mod.short_help_text if setting_mod.respond_to?(:short_help_text)),
    "raw_help_text" => (setting_mod.raw_help_text if setting_mod.respond_to?(:raw_help_text)),
    "restricted_to_type" =>
      (setting_mod.restricted_to_type.map(&:to_s) if setting_mod.respond_to?(:restricted_to_type))
  }.compact
end

payload["setting_opts_content_options"] =
  setting_state(Card::Set::Self::ContentOptions)
payload["setting_opts_content_option_view"] =
  setting_state(Card::Set::Self::ContentOptionView)

# ---- the list_input_options basket (supports_content_options.rb + editor.rb) -
payload["list_input_options_basket"] =
  begin
    Card::Set.basket[:list_input_options]&.map(&:to_s)
  rescue StandardError => e
    "CAPTURE_ERROR: #{e.class}: #{e.message}"
  end

# ---- set-module view registrations ------------------------------------------
abstract_list_html = Card::Set::Abstract::List.const_get(:HtmlFormat)
nest_list_html = Card::Set::Type::NestList.const_get(:HtmlFormat)
payload["registered_views"] = {
  "abstract_list_html_view_view_list" => {
    "defined" => abstract_list_html.method_defined?(:_view_view_list),
    "source_location" => source_location_of(abstract_list_html, :_view_view_list)
  },
  "nest_list_html_view_nest_list_input" => {
    "defined" => nest_list_html.method_defined?(:_view_nest_list_input),
    "source_location" => source_location_of(nest_list_html, :_view_nest_list_input)
  }
}

# view-config methods (`_view_<view>__<setting>`, view_opts.rb:59-64) checked
# on the PROBE CARD'S REAL FORMAT CLASS - the dispatch chain the renders
# actually resolve through (my set-module const probes above can miss
# definitions that load through the chain).
probe_format_class = Card.fetch(PROBE_POINTER).format.class
payload["probe_format_configs"] = %w[
  _view_input__unknown
  _view_input__cache
  _view_list__cache
  _view_one_line_content__unknown
  _view_one_line_content__wrap
  _view_view_list__unknown
  _view_core__unknown
].to_h do |method|
  [method, probe_format_class.method_defined?(method)]
end

# ---- rendered probe views ---------------------------------------------------
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
# (creating a rule card auto-creates its set card "X+*self" - those must be
# trashed too, or every run leaves one more counted card and the count drifts)
Card::Auth.as_bot do
  [
    "#{PROBE_RADIO}+*self+*input_type",
    "#{PROBE_RADIO}+*self+*content_options",
    "#{PROBE_RADIO}+*self",
    "#{PROBE_LIST}+*self",
    "#{PROBE_POINTER}+*self",
    "#{PROBE_NEST}+*self",
    "#{PROBE_LINK}+*self",
    PROBE_RADIO,
    PROBE_LIST,
    PROBE_POINTER,
    PROBE_NEST,
    PROBE_LINK,
    CHILD
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
