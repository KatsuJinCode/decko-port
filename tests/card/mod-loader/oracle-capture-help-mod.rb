# oracle-capture-help-mod.rb - oracle capture for the card-mod-help loader
# port (decko-ts stream S3, mod loading).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner \
#     C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-help-mod.rb
#
# Records to fixtures/captured/help-mod-loader.json:
# 1. mod load order as Cardio::Mod::Dirs assembled it (core mods, gem mods,
#    deck dirs) - the load-order oracle for src/card/mod-loader.ts
# 2. the pattern registration table + grouped_codes (SetLoader's load groups)
# 3. the Card::Setting registry state (setting_opts registrations from
#    card-mod-help's set/self files: *help, *guide)
# 4. the set-module view registrations card-mod-help contributed
#    (Card::Set::All::Help::HtmlFormat#_view_help et al., with source
#    locations proving which file defined them)
# 5. rendered bytes for two probe cards' :help / :help_text / :lead / :content
#    views - the byte oracle for the TS-side A/B test
#
# Determinism contract (mirrors tools/oracle/capture.rb): output JSON is
# pretty-printed with deeply sorted keys + trailing newline; the random
# data-slot-id attribute is normalized to a placeholder; probe seed cards are
# created-if-missing and DELETED (trashed) after capture so the shared oracle
# DB returns to its prior state (a re-run of capture.rb stays byte-stable).

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "help-mod-loader.json")

PROBE_WITH_RULE = "Oracle Help Probe"
PROBE_WITHOUT_RULE = "Oracle Bare Probe"
HELP_RULE_TEXT = "Moderator-approved help text for the probe card."

SEEDS = [
  { name: PROBE_WITH_RULE, type: "RichText", content: "probe card body" },
  { name: PROBE_WITHOUT_RULE, type: "RichText", content: "bare probe body" },
  { name: "#{PROBE_WITH_RULE}+*self+*help", content: HELP_RULE_TEXT }
].freeze

RENDER_TARGETS = {
  PROBE_WITH_RULE => %i[help help_text lead content],
  PROBE_WITHOUT_RULE => %i[help help_text lead content]
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

# ---- mod load order ---------------------------------------------------------
payload["mods"] = Cardio::Mod.dirs.mods.map do |mod|
  { "name" => mod.name, "group" => mod.group.to_s, "index" => mod.index }
end

# ---- pattern registration + load groups -------------------------------------
payload["pattern_codes"] = Card::Set::Pattern.concrete.map { |p| p.pattern_code.to_s }
payload["grouped_codes"] = Card::Set::Pattern.grouped_codes.map { |g| g.map(&:to_s) }

# ---- Card::Setting registry (setting_opts registrations) --------------------
payload["setting_groups"] = Card::Setting.groups.transform_values do |sets|
  sets.map { |s| s.codename&.to_s }
end
payload["setting_preferences"] = Card::Setting.preferences.map(&:to_s).sort

payload["setting_opts_help"] = begin
  help_setting = Card::Set::Self::Help
  {
    "codename" => help_setting.codename.to_s,
    "group" => Card::Setting.groups.find { |_, sets| sets.include?(help_setting) }&.first.to_s,
    "rule_type_editable" => help_setting.rule_type_editable,
    "short_help_text" => help_setting.short_help_text,
    "raw_help_text" => help_setting.raw_help_text,
    "right_set_raw_help_text" => help_setting.right_set.raw_help_text
  }
end

payload["setting_opts_guide"] = begin
  guide_setting = Card::Set::Self::Guide
  {
    "codename" => guide_setting.codename.to_s,
    "group" => Card::Setting.groups.find { |_, sets| sets.include?(guide_setting) }&.first.to_s,
    "rule_type_editable" => guide_setting.rule_type_editable,
    "short_help_text" => guide_setting.short_help_text
  }
end

# ---- set-module view registrations ------------------------------------------
all_help_html = Card::Set::All::Help.const_get(:HtmlFormat)
payload["registered_views"] = {
  "all_help_html_view_help" => {
    "defined" => all_help_html.method_defined?(:_view_help),
    "source_location" => source_location_of(all_help_html, :_view_help)
  },
  "all_help_html_view_help_text" => {
    "defined" => all_help_html.method_defined?(:_view_help_text),
    "source_location" => source_location_of(all_help_html, :_view_help_text)
  },
  "all_help_html_view_lead" => {
    "defined" => all_help_html.method_defined?(:_view_lead),
    "source_location" => source_location_of(all_help_html, :_view_lead)
  },
  "right_help_html_view_popover" => begin
    right_help_html = Card::Set::Right::Help.const_get(:HtmlFormat)
    { "defined" => right_help_html.method_defined?(:_view_popover),
      "source_location" => source_location_of(right_help_html, :_view_popover) }
  end,
  # view configs register `_view_<view>__<setting>` methods on the format
  # module (lib/card/set/format/abstract_format/view_opts.rb:59-64); presence
  # of those methods is the registry evidence
  "unknown_config_help" => all_help_html.method_defined?(:_view_help__unknown),
  "wrap_config_help" => all_help_html.method_defined?(:_view_help__wrap),
  "cache_config_help" => all_help_html.method_defined?(:_view_help__cache),
  "unknown_config_help_text" => all_help_html.method_defined?(:_view_help_text__unknown),
  "unknown_config_lead" => all_help_html.method_defined?(:_view_lead__unknown)
}

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
# (creating the rule card auto-creates its set card "X+*self" - that must be
# trashed too, or every run leaves one more counted card and the count drifts)
Card::Auth.as_bot do
  [
    "#{PROBE_WITH_RULE}+*self+*help",
    "#{PROBE_WITH_RULE}+*self",
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
# oracle data. Everything this fixture records is order/registry/render
# state the mod loader must reproduce.

# ---- write ------------------------------------------------------------------
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
