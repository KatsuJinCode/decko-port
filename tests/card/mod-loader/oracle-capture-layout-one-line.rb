
require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "layout-one-line.json")

PROBE_LONG  = "Oracle One Line Long Probe"
PROBE_SHORT = "Oracle One Line Short Probe"
PROBE_HTML  = "Oracle One Line Html Probe"
PROBE_MIXED = "Oracle One Line Mixed Probe"
PROBE_PLAIN = "Oracle One Line Plain Probe"

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
  { name: "#{PROBE_LONG}+*head",  type: "Basic", content: LONG_TEXT },
  { name: "#{PROBE_SHORT}+*head", type: "Basic", content: SHORT_TEXT },
  { name: "#{PROBE_HTML}+*head",  type: "Basic", content: HTML_TEXT },
  { name: "#{PROBE_MIXED}+*head", type: "Basic", content: MIXED_TEXT }
].freeze

RENDER_TARGETS = [
  ["#{PROBE_LONG}+*head",  :one_line_content],
  ["#{PROBE_SHORT}+*head", :one_line_content],
  ["#{PROBE_HTML}+*head",  :one_line_content],
  ["#{PROBE_MIXED}+*head", :one_line_content]
].freeze

PLAIN_RENDER = [
  [PROBE_PLAIN, :one_line_content]
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
    "defined" => right_head_html.method_defined?(:_view_raw_one_line_content)
  }
}

payload["constants"] = {
  "ONE_LINE_CHARACTER_LIMIT" => Card::Set::All::Content::ONE_LINE_CHARACTER_LIMIT
}

views = {}
RENDER_TARGETS.each do |name, view_name|
  card = Card.fetch(name)
  format = card.format
  key = "#{name}##{view_name}"
  views[key] = normalize(format.render(view_name))
rescue StandardError => e
  views[key] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
end

PLAIN_RENDER.each do |name, view_name|
  card = Card.fetch(name)
  format = card.format
  key = "#{name}##{view_name}"
  views[key] = normalize(format.render(view_name))
rescue StandardError => e
  views[key] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
end
payload["rendered"] = views

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

File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
