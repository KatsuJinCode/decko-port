# oracle-capture-tabs-mod.rb - oracle capture for the card-mod-tabs loader
# port (decko-ts mod-port stream, card-mod-tabs-0.20.0).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development RUBY_DLL_PATH=C:/localProjects/decko-ts/tools/oracle/mysql-client-scratch/lib \
#     bundle exec decko runner C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-tabs-mod.rb
#
# Records to fixtures/captured/tabs-mod-loader.json:
# 1. the set-module view registrations card-mod-tabs contributed
#    (Card::Set::All::Tabs::HtmlFormat#_view_tabs et al. + the abstract
#    module's _view_tabs/_view_tabs__cache, with source locations proving
#    which gem file defined them)
# 2. the probe card's REAL format-class view-config methods (_view_tabs__cache
#    etc.) - the dispatch chain the renders actually resolve through
# 3. rendered bytes for probe cards' :tabs / :pills / :tabs_static /
#    :pills_static views - the byte oracle for the TS-side A/B test. A
#    content probe (nest chunks in db_content -> construct_tabs lazy tabs),
#    a no-options content probe, a pointer probe (item_cards -> the static
#    variants; ALSO pins what construct_tabs does with nest-free content),
#    and a nest-free rich-text probe (the empty tab panel shape).
#
# Determinism contract (mirrors oracle-capture-list-mod.rb): output JSON is
# pretty-printed with deeply sorted keys + trailing newline; the random
# data-slot-id attribute is normalized to a placeholder; probe seed cards are
# created-if-missing and DELETED (trashed) after capture so the shared oracle
# DB returns to its prior state.

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "tabs-mod-loader.json")

CHILD = "Oracle Probe Child"

PROBE_TABS  = "Oracle Tabs Probe"       # RichText, nests with options
PROBE_PLAIN = "Oracle Tabs Plain Probe" # RichText, plain nests
PROBE_PONTER = "Oracle Tabs Pointer Probe" # Pointer, items for the static views
PROBE_EMPTY = "Oracle Tabs Empty Probe" # RichText, no nests at all

SEEDS = [
  { name: CHILD, type: "RichText", content: "probe item body" },
  { name: PROBE_TABS, type: "RichText",
    content: "{{#{CHILD}|title:First}}\n{{Second Item|open}}" },
  { name: PROBE_PLAIN, type: "RichText",
    content: "{{#{CHILD}}}\n{{Second Item}}" },
  { name: PROBE_PONTER, type: "Pointer",
    content: "#{CHILD}\nSecond Item" },
  { name: PROBE_EMPTY, type: "RichText", content: "no nests here" }
].freeze

RENDER_TARGETS = {
  PROBE_TABS   => %i[tabs pills tabs_static pills_static],
  PROBE_PLAIN  => %i[tabs pills],
  PROBE_PONTER => %i[tabs tabs_static pills_static],
  PROBE_EMPTY  => %i[tabs pills]
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

# ---- set-module view registrations ------------------------------------------
all_tabs_html = Card::Set::All::Tabs.const_get(:HtmlFormat)
abstract_tabs_html = Card::Set::Abstract::Tabs.const_get(:HtmlFormat)
payload["registered_views"] = {
  "all_html_view_tabs" => {
    "defined" => all_tabs_html.method_defined?(:_view_tabs),
    "source_location" => source_location_of(all_tabs_html, :_view_tabs)
  },
  "all_html_view_pills" => {
    "defined" => all_tabs_html.method_defined?(:_view_pills),
    "source_location" => source_location_of(all_tabs_html, :_view_pills)
  },
  "all_html_view_tabs_static" => {
    "defined" => all_tabs_html.method_defined?(:_view_tabs_static),
    "source_location" => source_location_of(all_tabs_html, :_view_tabs_static)
  },
  "all_html_view_pills_static" => {
    "defined" => all_tabs_html.method_defined?(:_view_pills_static),
    "source_location" => source_location_of(all_tabs_html, :_view_pills_static)
  },
  "abstract_html_view_tabs" => {
    "defined" => abstract_tabs_html.method_defined?(:_view_tabs),
    "source_location" => source_location_of(abstract_tabs_html, :_view_tabs)
  },
  "abstract_html_view_tabs_cache_setting" => {
    "defined" => abstract_tabs_html.method_defined?(:_view_tabs__cache),
    "source_location" => source_location_of(abstract_tabs_html, :_view_tabs__cache)
  }
}

# view-config methods checked on the PROBE CARD'S REAL FORMAT CLASS - the
# dispatch chain the renders actually resolve through (the abstract module's
# settings are only visible on formats whose set includes Abstract::Tabs).
probe_format_class = Card.fetch(PROBE_TABS).format.class
payload["probe_format_configs"] = %w[
  _view_tabs__cache
  _view_pills__cache
  _view_tabs_static__cache
  _view_pills_static__cache
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
Card::Auth.as_bot do
  [
    PROBE_TABS,
    PROBE_PLAIN,
    PROBE_PONTER,
    PROBE_EMPTY,
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

# ---- write ------------------------------------------------------------------
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
