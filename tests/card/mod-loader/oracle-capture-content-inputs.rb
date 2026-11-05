
require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "content-inputs.json")

PROBE_FILE_CODE  = "Oracle Content File Probe"
PROBE_HAML       = "Oracle Content Haml Probe"
PROBE_READ_ONLY  = "Oracle Content ReadOnly Probe"

SEEDS = [
  { name: PROBE_FILE_CODE, type: "RichText", content: "file content probe body" },
  { name: PROBE_HAML,      type: "RichText", content: "haml content probe body" },
  { name: PROBE_READ_ONLY, type: "RichText", content: "read-only content probe body" }
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

payload["mods"] = Cardio::Mod.dirs.mods.map do |mod|
  { "name" => mod.name, "group" => mod.group.to_s, "index" => mod.index }
end

abstract_code_content_html = Card::Set::Abstract::CodeContent.const_get(:HtmlFormat)
abstract_haml_file_html    = Card::Set::Abstract::HamlFile.const_get(:HtmlFormat)
abstract_read_only_html    = Card::Set::Abstract::ReadOnly.const_get(:HtmlFormat)

payload["registered_views"] = {
  "abstract_code_content_view_input" => {
    "defined" => abstract_code_content_html.method_defined?(:_view_input),
    "source_location" => source_location_of(abstract_code_content_html, :_view_input)
  },
  "abstract_haml_file_view_input" => {
    "defined" => abstract_haml_file_html.method_defined?(:_view_input),
    "source_location" => source_location_of(abstract_haml_file_html, :_view_input)
  },
  "abstract_read_only_view_input" => {
    "defined" => abstract_read_only_html.method_defined?(:_view_input),
    "source_location" => source_location_of(abstract_read_only_html, :_view_input)
  }
}

def per_module_input_literal(mod)
  proc = mod.views[mod][:input]
  proc.call
end

per_module_input = {
  "Abstract::CodeContent::HtmlFormat" => per_module_input_literal(abstract_code_content_html),
  "Abstract::HamlFile::HtmlFormat"    => per_module_input_literal(abstract_haml_file_html),
  "Abstract::ReadOnly::HtmlFormat"    => per_module_input_literal(abstract_read_only_html)
}
payload["per_module_input"] = per_module_input

views = {}
[PROBE_FILE_CODE, PROBE_HAML, PROBE_READ_ONLY].each do |name|
  card = Card.fetch(name)
  format = card.format
  begin
    views["#{name}#input"] = normalize(format.render(:input))
  rescue StandardError => e
    views["#{name}#input"] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
  end
end
payload["rendered"] = views

Card::Auth.as_bot do
  [PROBE_FILE_CODE, PROBE_HAML, PROBE_READ_ONLY].each do |name|
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
