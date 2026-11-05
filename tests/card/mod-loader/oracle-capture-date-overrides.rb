
require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "date-overrides.json")

PROBE_A = "Oracle Date Probe A"
PROBE_B = "Oracle Date Probe B"

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

def set_card_timestamps(name, created_at, updated_at)
  card = Card.fetch(name)
  card.update_columns(
    created_at: created_at,
    updated_at: updated_at
  )
end

payload = {}
seed_log = {}

payload["timezone"] = {
  "time_zone_name"       => Time.zone.name,        # "UTC" — governs left.created_at / updated_at as AS::TimeWithZone
  "env_tz"               => ENV["TZ"],             # nil on this Windows runner; Rails sets Time.zone directly
  "time_now_zone"        => Time.now.zone,         # the system local zone that I18n.localize(Time.now, ...) reads
  "time_now_inspect"     => Time.now.inspect       # e.g. "2026-09-22 20:35:51 -0700" — the %Z rendering source
}

payload["i18n_format_string"] = I18n.t("time.formats.card_dayofwk_min_tz")

Card::Auth.as_bot do
  SEEDS.each { |attrs| seed_log[attrs[:name]] = seed_card(attrs) }
end

set_card_timestamps(PROBE_A, Time.utc(2026, 9, 19, 0, 0, 0), Time.utc(2026, 9, 19, 14, 30, 0))
set_card_timestamps(PROBE_B, Time.utc(2026, 6, 15, 12, 0, 0), Time.utc(2026, 6, 15, 12, 0, 0))

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

views = {}
RULE_PROBES.each do |rp|
  rule_name = "#{rp[:left]}+#{rp[:suffix]}"
  card = Card.fetch(rule_name)
  format = card.format
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

Card::Auth.as_bot do
  RULE_PROBES.each do |rp|
    rule_name = "#{rp[:left]}+#{rp[:suffix]}"
    seed_log["deleted:#{rule_name}"] = trash_card(rule_name)
  end
  SEEDS.each do |attrs|
    seed_log["deleted:#{attrs[:name]}"] = trash_card(attrs[:name])
  end
end

File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
