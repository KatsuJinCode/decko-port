# oracle-capture-date-overrides.rb - oracle capture for the card-mod-date
# set-module def content overrides (set/right/when_created.rb:7-11,
# set/right/when_last_edited.rb:7-11, set/self/now.rb:1-3).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner \
#     C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-date-overrides.rb
#
# Records to fixtures/captured/date-overrides.json:
# 1. The I18n.t('time.formats.card_dayofwk_min_tz') format string from
#    card-1.110.0 config/locales/en.yml:29 - the exact strftime spec the
#    mod's three def content overrides apply via I18n.localize
# 2. The oracle app's timezone state - Time.zone.name (Rails app zone,
#    which governs left.created_at / left.updated_at's ActiveSupport::
#    TimeWithZone), ENV['TZ'], and Time.now.zone (the system local zone
#    that I18n.localize(Time.now, ...) reads) - the TS test reads these
#    to decide how to normalize the captured bytes for comparison
# 3. Rendered :core bytes for two junction cards whose left has a known
#    created_at / updated_at set via update_columns:
#      - "Oracle Date Probe A+*when created"  (created_at = UTC midnight)
#      - "Oracle Date Probe A+*when last edited" (updated_at = UTC 14:30)
#      - "Oracle Date Probe B+*when created"  (created_at = UTC noon)
#    These are the byte oracle for the TS-side A/B test (the right set
#    modules' def content - when_created.rb:7-11, when_last_edited.rb:7-11)
# 4. The raw :raw bytes for "*now" - the self/now.rb:1-3 def content
#    output (the localized Time.now at capture-time; non-deterministic
#    by nature - the TS test asserts the format's SHAPE, not bytes)
# 5. Direct I18n.localize bytes for the seed timestamps via three routes -
#    the mod's actual line `I18n.localize(left.created_at, format:
#    :card_dayofwk_min_tz)` for when_created / when_last_edited, plus
#    `I18n.localize(Time.now, format: :card_dayofwk_min_tz)` for now.
#    The TS pin (formatDayofwkMinTz) is proved equivalent to these bytes
#    by the helper's unit tests in card-mod-date.test.ts.
#
# Determinism contract (mirrors tools/oracle/capture.rb): output JSON is
# pretty-printed with deeply sorted keys + trailing newline; the probe
# seed cards are created-if-missing and DELETED (trashed) after capture
# so the shared oracle DB returns to its prior state (a re-run stays
# byte-stable for the rule-card bytes; the *now bytes are non-
# deterministic by nature - the TS test asserts the shape regex).

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "date-overrides.json")

PROBE_A = "Oracle Date Probe A"
PROBE_B = "Oracle Date Probe B"

# Two junction rule cards per probe. The Right set module anchors are the
# *when created / *when last edited codename setting cards (data/real.yml
# of card-mod-date declares them with codenames when_created /
# when_last_edited); the right rule pattern is "right+<codename>". The
# rule card name is "<LEFT>+*<setting name>" - i.e., "<LEFT>+*when created".
RULE_PROBES = [
  { left: PROBE_A, suffix: "*when created",     created_at: "2026-09-19 00:00:00 UTC", updated_at: "2026-09-19 00:00:00 UTC" },
  { left: PROBE_A, suffix: "*when last edited", created_at: "2026-09-19 00:00:00 UTC", updated_at: "2026-09-19 14:30:00 UTC" },
  { left: PROBE_B, suffix: "*when created",     created_at: "2026-06-15 12:00:00 UTC", updated_at: "2026-06-15 12:00:00 UTC" }
].freeze

SEEDS = [
  { name: PROBE_A, type: "RichText", content: "probe A body" },
  { name: PROBE_B, type: "RichText", content: "probe B body" }
].freeze

SLOT_ID_RE = /data-slot-id=(["'])\h+\1/.freeze
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

def trash_card(name)
  card = Card.fetch(name)
  return "missing" if card.nil? || card.new_card?

  card.delete!
  "deleted"
end

# Apply a known UTC timestamp via update_columns so the column reads back
# the exact value (Card.update! would re-stamp with Time.now).
def set_card_timestamps(name, created_at, updated_at)
  card = Card.fetch(name)
  card.update_columns(
    created_at: created_at,
    updated_at: updated_at
  )
end

payload = {}
seed_log = {}

# ---- timezone state (record BEFORE seeding so the values are stable) ------
payload["timezone"] = {
  "time_zone_name"       => Time.zone.name,        # "UTC" — governs left.created_at / updated_at as AS::TimeWithZone
  "env_tz"               => ENV["TZ"],             # nil on this Windows runner; Rails sets Time.zone directly
  "time_now_zone"        => Time.now.zone,         # the system local zone that I18n.localize(Time.now, ...) reads
  "time_now_inspect"     => Time.now.inspect       # e.g. "2026-09-22 20:35:51 -0700" — the %Z rendering source
}

# ---- I18n format string (the strftime spec card-1.110.0 en.yml:29 declares) -
payload["i18n_format_string"] = I18n.t("time.formats.card_dayofwk_min_tz")

# ---- seed the two probe cards (create-if-missing) ---------------------------
Card::Auth.as_bot do
  SEEDS.each { |attrs| seed_log[attrs[:name]] = seed_card(attrs) }
end

# ---- set KNOWN UTC timestamps on the probes (bypasses Card's auto-stamp) ----
set_card_timestamps(PROBE_A, Time.utc(2026, 9, 19, 0, 0, 0), Time.utc(2026, 9, 19, 14, 30, 0))
set_card_timestamps(PROBE_B, Time.utc(2026, 6, 15, 12, 0, 0), Time.utc(2026, 6, 15, 12, 0, 0))

# ---- create the junction rule cards -----------------------------------------
Card::Auth.as_bot do
  RULE_PROBES.each do |rp|
    rule_name = "#{rp[:left]}+#{rp[:suffix]}"
    if Card.fetch(rule_name, new: {}).new_card?
      Card.create!(name: rule_name)
      seed_log[rule_name] = "created"
    else
      seed_log[rule_name] = "present"
    end
  end
end

# ---- direct I18n.localize bytes (the mod's actual line) ---------------------
# This proves formatDayofwkMinTz's output against the LIVE I18n bytes for
# the SAME input timestamps, for the three known timestamps.
payload["direct_i18n_localize"] = {
  "left_created_at_utc_midnight" => I18n.localize(
    Card.fetch(PROBE_A).created_at, format: :card_dayofwk_min_tz
  ),
  "left_updated_at_utc_1430"     => I18n.localize(
    Card.fetch(PROBE_A).updated_at, format: :card_dayofwk_min_tz
  ),
  "left_created_at_utc_noon"     => I18n.localize(
    Card.fetch(PROBE_B).created_at, format: :card_dayofwk_min_tz
  ),
  "time_now_at_capture"          => I18n.localize(Time.now, format: :card_dayofwk_min_tz)
}

# ---- rendered :core bytes for the junction rule cards (the byte oracle) -----
views = {}
RULE_PROBES.each do |rp|
  rule_name = "#{rp[:left]}+#{rp[:suffix]}"
  card = Card.fetch(rule_name)
  format = card.format
  # The rule cards are phrase-typed virtual cards with no dbContent;
  # format.render(:core) returns the def content's bytes (the I18n.localize
  # output for the left's created_at or updated_at). Capture both :core and
  # :raw so the test can compare either path.
  [:core, :raw].each do |view_name|
    key = "#{rule_name}##{view_name}"
    begin
      views[key] = normalize(format.render(view_name))
    rescue StandardError => e
      views[key] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
    end
  end
end
payload["rendered"] = views

# ---- the *now card (self/now.rb:1-3 def content fires here) ----------------
# *now is a seed card declared in card-mod-date-0.20.0/data/real.yml with
# codename :now. The Self::Now set module's def content returns
# I18n.localize(Time.now, ...) — non-deterministic (the wall-clock instant
# at render time). The TS test asserts the format's SHAPE via a regex,
# not exact bytes (the existing card-mod-date.test.ts:436-438 pin).
now_card = Card.fetch("*now")
begin
  payload["now_card"] = {
    "name"              => now_card.name,
    "type_code"         => now_card.type_code.to_s,
    "format_render_raw" => normalize(now_card.format.render(:raw)),
    "format_render_core"=> normalize(now_card.format.render(:core)),
    "content"           => now_card.content
  }
rescue StandardError => e
  payload["now_card"] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
end

# ---- cleanup: trash the rule cards (and their auto-set cards) then probes ---
# Order matters: trash rule junctions first (they hold the set module's
# virtual state), then probes. Card.delete! trashes; the rule junction's
# deletion also drops its +*self card.
Card::Auth.as_bot do
  RULE_PROBES.each do |rp|
    rule_name = "#{rp[:left]}+#{rp[:suffix]}"
    seed_log["deleted:#{rule_name}"] = trash_card(rule_name)
  end
  SEEDS.each do |attrs|
    seed_log["deleted:#{attrs[:name]}"] = trash_card(attrs[:name])
  end
end

# ---- write ------------------------------------------------------------------
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
