# oracle-capture-layout-one-line.rb - oracle capture for the card-mod-layout
# :one_line_content view (set/right/head.rb:12-14).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner \
#     C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-layout-one-line.rb
#
# Records to fixtures/captured/layout-one-line.json:
# 1. The :one_line_content view registration on the Right::Head set
#    (card-mod-format set/all/content.rb:43-45 + card-mod-layout
#    set/right/head.rb:12-14: `raw_one_line_content` -> `truncate
#    strip_tags(render_raw), length: one_line_character_limit` where
#    one_line_character_limit = `voo.size || ONE_LINE_CHARACTER_LIMIT` (60))
# 2. The :head_content view registration on the same set (sibling view, same
#    scope - confirms the set's surface)
# 3. The ONELINE_CHARACTER_LIMIT constant value from card-mod-format's
#    set/all/content.rb:1
# 4. Rendered bytes for probe right-of-head rule cards:
#    - "Oracle One Line Long Probe+*head" with 70 raw chars (strip_tags
#      leaves them intact; truncate length 60 yields first 57 chars + "...")
#    - "Oracle One Line Short Probe+*head" with 12 raw chars (under 60 ->
#      unchanged)
#    - "Oracle One Line Html Probe+*head" carrying a `<meta>` tag (strip_tags
#      reduces the tag to ""; truncate length 60 leaves "")
#    - "Oracle One Line Mixed Probe+*head" with a wrapped long string -
#      strip_tags collapses the wrap; the long body inside is truncated
# 5. Rendered bytes with `size: <n>` option - confirms `voo.size` overrides
#    the 60-char default
# 6. Rendered bytes for the unsupported-card probe (Plain probe without
#    *head right part) - confirms Ruby's dispatch raises the
#    unsupported-view UserError
#
# Determinism contract (mirrors tools/oracle/capture.rb): output JSON is
# pretty-printed with deeply sorted keys + trailing newline; the random
# data-slot-id attribute is normalized to a placeholder; the probe cards are
# created-if-missing and DELETED (trashed) after capture so the shared oracle
# DB returns to its prior state (a re-run of capture.rb stays byte-stable).
#
# Probe cards (rule cards live at "<left>+*head" - their right part is the
# *head card, the Right::Head set anchor):
#   PROBE_LONG    = "Oracle One Line Long Probe"  + dbContent of 70 raw chars
#   PROBE_SHORT   = "Oracle One Line Short Probe" + dbContent "plain text"
#   PROBE_HTML    = "Oracle One Line Html Probe"  + dbContent "<meta ...>"
#   PROBE_MIXED   = "Oracle One Line Mixed Probe" + dbContent "<span>a*70</span>"
#   PROBE_PLAIN   = "Oracle One Line Plain Probe" (NOT a right-of-head rule -
#                    for the unsupported-view error path)

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "layout-one-line.json")

PROBE_LONG  = "Oracle One Line Long Probe"
PROBE_SHORT = "Oracle One Line Short Probe"
PROBE_HTML  = "Oracle One Line Html Probe"
PROBE_MIXED = "Oracle One Line Mixed Probe"
PROBE_PLAIN = "Oracle One Line Plain Probe"

# 70 ASCII chars: after strip_tags the wrap leaves the body unchanged
# (strip_tags removes the <span>...</span> shell, yielding 70 chars); the
# truncate length 60 yields the first 57 chars + "..." (= 60 chars total).
LONG_TEXT = "abcdefghij" * 7 # 70 chars
SHORT_TEXT = "plain text"    # 11 chars, under 60
HTML_TEXT = '<meta name="layout-probe" content="head-rule">' # strip_tags -> ""
MIXED_TEXT = "<span class=\"x\">#{LONG_TEXT}</span>" # strip_tags -> LONG_TEXT

SEEDS = [
  { name: PROBE_LONG,  type: "RichText", content: LONG_TEXT },
  { name: PROBE_SHORT, type: "RichText", content: SHORT_TEXT },
  { name: PROBE_HTML,  type: "RichText", content: HTML_TEXT },
  { name: PROBE_MIXED, type: "RichText", content: MIXED_TEXT },
  { name: PROBE_PLAIN, type: "RichText", content: "plain probe body" },
  # The five right-of-head rule cards. Their names auto-compose via
  # Card.create! - the right *head is a junction with the *head card, the
  # left is the probe card; the rule's dbContent is the raw content the
  # :one_line_content view will truncate.
  { name: "#{PROBE_LONG}+*head",  type: "Basic", content: LONG_TEXT },
  { name: "#{PROBE_SHORT}+*head", type: "Basic", content: SHORT_TEXT },
  { name: "#{PROBE_HTML}+*head",  type: "Basic", content: HTML_TEXT },
  { name: "#{PROBE_MIXED}+*head", type: "Basic", content: MIXED_TEXT }
].freeze

# Render targets: list of (name, view) pairs - the simplest shape, the
# one the byte oracle pins. The :one_line_content view's `voo.size` option
# (content.rb:51-53) is exercised in the TS-side test (card-mod-layout
# test.ts) only; the oracle is the base behavior (60-char limit, no opts).
RENDER_TARGETS = [
  ["#{PROBE_LONG}+*head",  :one_line_content],
  ["#{PROBE_SHORT}+*head", :one_line_content],
  ["#{PROBE_HTML}+*head",  :one_line_content],
  ["#{PROBE_MIXED}+*head", :one_line_content]
].freeze

# Plain (non-right-of-head) probe - the dispatch error path
PLAIN_RENDER = [
  [PROBE_PLAIN, :one_line_content]
].freeze

SLOT_ID_RE = /data-slot-id=(["'])\h+\1/.freeze
# Probe card row ids advance every run (the rule card's left_id is created
# fresh by the seed block). The :one_line_content view emits no
# data-card-id by default - it returns just the stripped+truncated raw
# text - but normalize regardless for symmetry with the help-mod capture.
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

# The :one_line_content view is on the Right::Head set only (set/right/
# head.rb:12-14). Card::Set::Right::Head.const_get(:HtmlFormat) is the
# format module the registration rides.
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

# ---- registry evidence: the view lives on Right::Head::HtmlFormat -----------
right_head_html = Card::Set::Right::Head.const_get(:HtmlFormat)
payload["view_registry"] = {
  "right_head_html_view_one_line_content" => {
    "defined" => right_head_html.method_defined?(:_view_one_line_content),
    "source_location" => source_location_of(right_head_html, :_view_one_line_content)
  },
  "right_head_html_view_head_content" => {
    "defined" => right_head_html.method_defined?(:_view_head_content),
    "source_location" => source_location_of(right_head_html, :_view_head_content)
  },
  "right_head_html_view_raw_one_line_content" => {
    # The body of the right/head.rb :one_line_content view calls
    # `raw_one_line_content` (a CARD-level helper on Card::Set::All::Format
    # via content.rb:43-45). Presence proves the chain.
    "defined" => right_head_html.method_defined?(:_view_raw_one_line_content)
  }
}

# ---- the ONE_LINE_CHARACTER_LIMIT constant ----------------------------------
payload["constants"] = {
  "ONE_LINE_CHARACTER_LIMIT" => Card::Set::All::Content::ONE_LINE_CHARACTER_LIMIT
}

# ---- rendered probe views ---------------------------------------------------
views = {}
RENDER_TARGETS.each do |name, view_name|
  card = Card.fetch(name)
  format = card.format
  key = "#{name}##{view_name}"
  views[key] = normalize(format.render(view_name))
rescue StandardError => e
  views[key] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
end

# plain probe -> dispatch error path
PLAIN_RENDER.each do |name, view_name|
  card = Card.fetch(name)
  format = card.format
  key = "#{name}##{view_name}"
  views[key] = normalize(format.render(view_name))
rescue StandardError => e
  views[key] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
end
payload["rendered"] = views

# ---- cleanup: trash the probe cards so the shared DB stays untouched --------
# A compound name like "X+*head" carries a junction with the *head card; we
# must trash the rule first (which auto-deletes the junction), then the
# probe. Card.delete! trashes; each probe's junction (if any) is cleaned
# up automatically.
Card::Auth.as_bot do
  [
    "#{PROBE_LONG}+*head",
    "#{PROBE_SHORT}+*head",
    "#{PROBE_HTML}+*head",
    "#{PROBE_MIXED}+*head",
    PROBE_LONG,
    PROBE_SHORT,
    PROBE_HTML,
    PROBE_MIXED,
    PROBE_PLAIN
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
# oracle data. Everything this fixture records is order/registry/render
# state the mod loader must reproduce.

# ---- write ------------------------------------------------------------------
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
