
require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "api-key-views.json")

PROBE_ACCOUNT    = "Oracle ApiKey Account"
PROBE_APIKEY_JN  = "#{PROBE_ACCOUNT}+*api key"  # junction: account + *api_key

SEEDS = [
  { name: PROBE_ACCOUNT, type: "Basic", content: "account body" },
  { name: PROBE_APIKEY_JN, type: "Basic", content: "probeapikeybody0123456789" }
].freeze

RENDER_TARGETS = {
  PROBE_APIKEY_JN => %i[titled titled_content content]
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

probe_format_class = Card.fetch(PROBE_APIKEY_JN).format.class
payload["probe_format_configs"] = %w[
  _view_titled__unknown
  _view_titled_content__unknown
  _view_content__unknown
].to_h do |method|
  [method, probe_format_class.method_defined?(method)]
end

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

File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush