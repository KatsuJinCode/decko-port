# oracle-capture-api-key-views.rb - oracle capture for the card-mod-api_key
# superView trio (set/right/api_key.rb:73-75).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner \
#     C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-api-key-views.rb
#
# Records to fixtures/captured/api-key-views.json:
# 1. The three superView-trio views (:titled, :titled_content, :content)
#    rendered on a probe card with the +*api_key right - the byte proof
#    that set/right/api_key.rb:73-75's super() chain dispatch equals the
#    parent set's SAME view (Ruby's super() walks MRO; the api_key set's
#    body just delegates). The probe must carry the +*api_key right so
#    Right::ApiKey is in its set_keys chain.
# 2. The set-module view registrations Right::ApiKey contributed
#    (Card::Set::Right::ApiKey::HtmlFormat#_view_titled et al., with
#    source locations proving which gem file defined them) - the
#    registration evidence the byte render relies on.
# 3. The probe card's REAL format-class view-config methods
#    (_view_titled__unknown etc.) - the dispatch chain the renders
#    actually resolve through.
#
# Determinism contract (mirrors oracle-capture-help-mod.rb): output JSON
# is pretty-printed with deeply sorted keys + trailing newline; the
# random data-slot-id attribute is normalized to a placeholder; the
# probe seed cards are created-if-missing and DELETED (trashed) after
# capture so the shared oracle DB returns to its prior state.

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "api-key-views.json")

# The probe is an account card with a +*api_key right. The Right::ApiKey
# set applies to cards whose right_id is the *api_key card's id; the
# api_key set's superView trio therefore dispatches when this card is
# rendered through the +*api_key right. The probe is given non-empty
# content so the slot wrapper has something to wrap (slot wrap is
# conditional on wrap config; all::Base's :titled/:titled_content/:
# content are wrap: :slot per card-mod-format set/all/base.rb).
PROBE_ACCOUNT    = "Oracle ApiKey Account"
PROBE_APIKEY_JN  = "#{PROBE_ACCOUNT}+*api key"  # junction: account + *api_key

SEEDS = [
  # The account (left side of the +*api_key junction). Plain Basic
  # card; only the name + key + set_keys derivation matters for the
  # Right::ApiKey inclusion.
  { name: PROBE_ACCOUNT, type: "Basic", content: "account body" },
  # The api_key child (the actual probe the trio renders on). Content
  # must pass Right::ApiKey's validate_api_key event (set/right/api_key.
  # rb:8-11) which requires 20+ word characters (\w+).
  { name: PROBE_APIKEY_JN, type: "Basic", content: "probeapikeybody0123456789" }
].freeze

# The three views set/right/api_key.rb:73-75 declares:
#   %i[titled titled_content content].each do |viewname|
#     view(viewname, unknown: true) { super() }
#   end
# Each calls super() - the body is the parent's same view (All::Base's
# :titled/:titled_content/:content on this probe).
RENDER_TARGETS = {
  PROBE_APIKEY_JN => %i[titled titled_content content]
}.freeze

SLOT_ID_RE = /data-slot-id=(["'])\h+\1/.freeze
# The probe cards are created fresh and trashed after each capture, so
# their row ids (and with them data-card-id) advance every run - seed
# state, not mod semantics. Normalized like the slot id; the TS test
# applies the same normalization to its own renders before comparing.
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

# ---- set-module view registrations (Right::ApiKey::HtmlFormat) ---------------
right_api_key_html = Card::Set::Right::ApiKey.const_get(:HtmlFormat)
payload["registered_views"] = {
  "right_api_key_html_view_titled" => {
    "defined" => right_api_key_html.method_defined?(:_view_titled),
    "source_location" => source_location_of(right_api_key_html, :_view_titled)
  },
  "right_api_key_html_view_titled_content" => {
    "defined" => right_api_key_html.method_defined?(:_view_titled_content),
    "source_location" => source_location_of(right_api_key_html, :_view_titled_content)
  },
  "right_api_key_html_view_content" => {
    "defined" => right_api_key_html.method_defined?(:_view_content),
    "source_location" => source_location_of(right_api_key_html, :_view_content)
  }
}

# view-config methods (`_view_<view>__<setting>`, view_opts.rb:59-64)
# checked on the PROBE CARD'S REAL FORMAT CLASS - the dispatch chain
# the renders actually resolve through (the api_key mod's settings are
# only visible on formats whose set includes Right::ApiKey).
probe_format_class = Card.fetch(PROBE_APIKEY_JN).format.class
payload["probe_format_configs"] = %w[
  _view_titled__unknown
  _view_titled_content__unknown
  _view_content__unknown
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
# (deleting the junction first so Card::Set's deletion order doesn't try
# to invalidate referential rows; the left card can be deleted safely
# after the junction is gone)
Card::Auth.as_bot do
  [
    PROBE_APIKEY_JN,
    PROBE_ACCOUNT
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
# benchmarks, so a card count is racy harness telemetry, not mod-
# mechanism oracle data.

# ---- write ------------------------------------------------------------------
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush