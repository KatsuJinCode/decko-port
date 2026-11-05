
require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "help-popover.json")

PROBE_WITH_RULE    = "Oracle Help Popover Probe+*help"
PROBE_WITHOUT_RULE = "Oracle Bare Popover Probe+*help"
PROBE_LEFT_NAME    = "Oracle Help Popover Probe"
HELP_RULE_TEXT     = "Moderator-approved help text for the popover probe card."

SEEDS = [
  { name: PROBE_LEFT_NAME, type: "RichText", content: "popover probe card body" },
  { name: PROBE_WITH_RULE, type: "RichText", content: "popover probe card body" },
  { name: PROBE_WITHOUT_RULE, type: "RichText", content: "bare popover probe body" },
  { name: "#{PROBE_LEFT_NAME}+*self+*help", content: HELP_RULE_TEXT }
].freeze

RENDER_TARGETS = {
  PROBE_WITH_RULE    => %i[popover],
  PROBE_WITHOUT_RULE => %i[popover]
}.freeze

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

def source_location_of(format_mod, method)
  return nil unless format_mod.respond_to?(:instance_method)

  format_mod.instance_method(method).source_location
rescue StandardError
  nil
end

payload = {}
seed_log = {}

Card::Auth.as_bot do
  SEEDS.each { |attrs| seed_log[attrs[:name]] = seed_card(attrs) }
end

right_help_html = Card::Set::Right::Help.const_get(:HtmlFormat)
payload["registered_views"] = {
  "right_help_html_view_popover" => {
    "defined" => right_help_html.method_defined?(:_view_popover),
    "source_location" => source_location_of(right_help_html, :_view_popover)
  }
}

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

File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
